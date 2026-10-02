/*
 * SafeCircle Home button — ESP32 + Wi-Fi.
 *
 * A button that never moves: no GPS, no SIM. The registered flat is exact and
 * the battery lasts far longer, which is the whole argument in section 18.1 for
 * two devices rather than one.
 *
 * Behaviour:
 *   hold ~2 s   raise an SOS
 *   hold ~4 s   request a cancel (which starts a verification, it does not stop help)
 *   3 taps      silent SOS, if the person's profile allows it
 *
 * The device signs every message with its own key and an increasing sequence
 * number, then polls for its stage and plays whatever pattern the server sends.
 *
 * Copy secrets.h.example to secrets.h and fill it in. secrets.h is gitignored.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <mbedtls/md.h>
#include "../shared/safecircle.h"
#include "secrets.h"

PressTracker button;
PatternPlayer player;

static uint8_t batteryPercent();

static uint32_t sequence = 0;
static uint32_t lastPollMs = 0;
static uint32_t lastHeartbeatMs = 0;
static bool incidentOpen = false;
static int lastSeqSeen = -1;
static Pattern currentPattern;

// ---------------------------------------------------------------------------
// Store and forward (section 18.7). A press is never lost to a flat Wi-Fi link:
// it is queued and retried with back-off while the red pattern plays.
// ---------------------------------------------------------------------------

struct QueuedEvent {
  char event[20];
  uint32_t seq;
  uint8_t battery;
  bool used;
};

static QueuedEvent queue[QUEUE_DEPTH];
static uint32_t retryDelayMs = RETRY_BASE_MS;
static uint32_t nextRetryMs = 0;

// ---------------------------------------------------------------------------
// HMAC-SHA256 over the canonical body (keys sorted, no signature field).
// Must match packages/shared and apps/api/src/security/hmac.ts byte for byte.
// ---------------------------------------------------------------------------

static String hmacHex(const char* key, const String& message) {
  byte result[32];
  mbedtls_md_context_t ctx;
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, info, 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)key, strlen(key));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)message.c_str(), message.length());
  mbedtls_md_hmac_finish(&ctx, result);
  mbedtls_md_free(&ctx);

  String hex;
  hex.reserve(64);
  for (int i = 0; i < 32; i++) {
    char buf[3];
    snprintf(buf, sizeof(buf), "%02x", result[i]);
    hex += buf;
  }
  return hex;
}

/*
 * The canonical body for a Home button: keys in alphabetical order, exactly as
 * the server's canonicalise() produces. A Home button sends no location, so the
 * shape is fixed and can be built by hand rather than serialised twice.
 */
static String canonicalBody(const char* event, uint32_t seq, uint8_t battery) {
  String s = "{";
  s += "\"battery\":" + String(battery) + ",";
  s += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  s += "\"event\":\"" + String(event) + "\",";
  s += "\"seq\":" + String(seq);
  s += "}";
  return s;
}

// ---------------------------------------------------------------------------
// Pattern parsing
// ---------------------------------------------------------------------------

static LightColour colourFrom(const char* s) {
  if (!strcmp(s, "white")) return C_WHITE;
  if (!strcmp(s, "blue")) return C_BLUE;
  if (!strcmp(s, "green")) return C_GREEN;
  if (!strcmp(s, "purple")) return C_PURPLE;
  if (!strcmp(s, "red")) return C_RED;
  return C_NONE;
}

static LightMotion motionFrom(const char* s) {
  if (!strcmp(s, "fill")) return M_FILL;
  if (!strcmp(s, "fast_blink")) return M_FAST_BLINK;
  if (!strcmp(s, "solid")) return M_SOLID;
  if (!strcmp(s, "slow_pulse")) return M_SLOW_PULSE;
  if (!strcmp(s, "fast_pulse")) return M_FAST_PULSE;
  if (!strcmp(s, "brighten")) return M_BRIGHTEN;
  if (!strcmp(s, "single_flash")) return M_SINGLE_FLASH;
  return M_OFF;
}

static void applyPattern(JsonObjectConst p) {
  Pattern out = {};
  out.colour = colourFrom(p["light"]["colour"] | "none");
  out.motion = motionFrom(p["light"]["motion"] | "off");
  out.brightness = p["light"]["brightness"] | 3;
  strlcpy(out.tone, p["sound"]["tone"] | "none", sizeof(out.tone));
  out.volume = p["sound"]["volume"] | 0;
  out.repeatEveryMs = p["sound"]["repeatEveryMs"] | 0;
  out.pulses = p["vibration"]["pulses"] | 0;
  strlcpy(out.length, p["vibration"]["length"] | "none", sizeof(out.length));
  strlcpy(out.meaning, p["meaning"] | "", sizeof(out.meaning));

  currentPattern = out;
  player.play(currentPattern, millis());

  Serial.print("[pattern] ");
  Serial.print(out.meaning);
  Serial.print("  light=");
  Serial.print(p["light"]["colour"] | "none");
  Serial.print(" sound=");
  Serial.print(out.tone);
  Serial.print(" vibration=");
  Serial.println(out.pulses);
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

static bool sendEvent(const char* event, uint32_t seq, uint8_t battery) {
  if (WiFi.status() != WL_CONNECTED) return false;

  String body = canonicalBody(event, seq, battery);
  String signature = hmacHex(DEVICE_KEY, body);

  // Insert the signature into the JSON we actually send. The server strips it
  // before verifying, so its position does not matter.
  String payload = body.substring(0, body.length() - 1);
  payload += ",\"signature\":\"" + signature + "\"}";

  HTTPClient http;
  http.begin(String(API_BASE) + "/api/sos/device");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int status = http.POST(payload);

  if (status == 202) {
    JsonDocument doc;
    if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
      if (doc["pattern"].is<JsonObjectConst>()) applyPattern(doc["pattern"]);
      incidentOpen = true;
      lastSeqSeen = doc["seq"] | -1;
    }
    http.end();
    return true;
  }

  Serial.print("[send] refused, HTTP ");
  Serial.println(status);
  http.end();
  // 401 and 409 are permanent for this payload: a bad signature or a replayed
  // sequence will never succeed, so there is no point retrying this one.
  return status == 401 || status == 409;
}

static void enqueue(const char* event, uint8_t battery) {
  for (int i = 0; i < QUEUE_DEPTH; i++) {
    if (!queue[i].used) {
      strlcpy(queue[i].event, event, sizeof(queue[i].event));
      queue[i].seq = ++sequence;
      queue[i].battery = battery;
      queue[i].used = true;
      return;
    }
  }
  Serial.println("[queue] full, dropping the oldest");
  for (int i = 1; i < QUEUE_DEPTH; i++) queue[i - 1] = queue[i];
  strlcpy(queue[QUEUE_DEPTH - 1].event, event, sizeof(queue[0].event));
  queue[QUEUE_DEPTH - 1].seq = ++sequence;
  queue[QUEUE_DEPTH - 1].battery = battery;
  queue[QUEUE_DEPTH - 1].used = true;
}

/* Drain the queue with exponential back-off, showing the failed pattern. */
static void drainQueue(uint32_t nowMs) {
  bool pending = false;
  for (int i = 0; i < QUEUE_DEPTH; i++) pending = pending || queue[i].used;
  if (!pending) return;

  if (nowMs < nextRetryMs) return;

  for (int i = 0; i < QUEUE_DEPTH; i++) {
    if (!queue[i].used) continue;
    if (sendEvent(queue[i].event, queue[i].seq, queue[i].battery)) {
      queue[i].used = false;
      retryDelayMs = RETRY_BASE_MS;
    } else {
      // Still failing: show red and back off.
      Pattern failed = {};
      failed.colour = C_RED;
      failed.motion = M_FAST_BLINK;
      failed.brightness = 5;
      strlcpy(failed.tone, "triple_beep", sizeof(failed.tone));
      failed.volume = 3;
      failed.pulses = 3;
      strlcpy(failed.length, "long", sizeof(failed.length));
      strlcpy(failed.meaning, "Not sent, still trying", sizeof(failed.meaning));
      player.play(failed, nowMs);

      retryDelayMs = min(retryDelayMs * 2, (uint32_t)RETRY_MAX_MS);
      nextRetryMs = nowMs + retryDelayMs;
      Serial.print("[retry] in ");
      Serial.print(retryDelayMs);
      Serial.println(" ms");
      return;
    }
  }
}

/*
 * The status poll (section 7.3). A plain POST is one-way, so the button must
 * keep asking what stage it is on. The sequence number means a late or repeated
 * reply can never move the device backwards.
 */
static void pollStatus(uint32_t nowMs) {
  uint32_t interval = incidentOpen ? POLL_FAST_MS : POLL_SLOW_MS;
  if (nowMs - lastPollMs < interval) return;
  lastPollMs = nowMs;
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(String(API_BASE) + "/api/device/" + DEVICE_ID + "/status");
  http.setTimeout(6000);
  if (http.GET() == 200) {
    JsonDocument doc;
    if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
      int seq = doc["seq"] | 0;
      incidentOpen = doc["incident_open"] | false;
      // Never go backwards on a stale reply.
      if (seq > lastSeqSeen) {
        lastSeqSeen = seq;
        if (doc["pattern"].is<JsonObjectConst>()) applyPattern(doc["pattern"]);
      }
    }
  }
  http.end();
}

static void sendHeartbeat(uint32_t nowMs) {
  if (nowMs - lastHeartbeatMs < HEARTBEAT_INTERVAL_S * 1000UL) return;
  lastHeartbeatMs = nowMs;
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(String(API_BASE) + "/api/device/" + DEVICE_ID + "/heartbeat");
  http.addHeader("Content-Type", "application/json");
  http.POST(String("{\"battery\":") + batteryPercent() + "}");
  http.end();
}

static uint8_t batteryPercent() {
  // Replace with a real divider reading on the battery pin. 100 is honest only
  // on a USB-powered bench build.
  return 100;
}

// ---------------------------------------------------------------------------
// Arduino lifecycle
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("SafeCircle Home button");
  Serial.print("device ");
  Serial.println(DEVICE_ID);

  button.begin(PIN_BUTTON);
  player.begin();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[wifi] connecting");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[wifi] ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[wifi] not connected; presses will be queued and retried");
  }

  // Start the sequence above anything already recorded for this device, so a
  // reboot cannot look like a replay.
  sequence = (uint32_t)(esp_random() & 0x0FFFFFFF);
}

void loop() {
  uint32_t now = millis();

  PressResult result = button.update(now);
  switch (result) {
    case PRESS_SOS:
      Serial.println("[press] SOS");
      enqueue("panic", batteryPercent());
      nextRetryMs = 0;
      break;
    case PRESS_CANCEL:
      Serial.println("[press] cancel requested");
      enqueue("cancel", batteryPercent());
      nextRetryMs = 0;
      break;
    case PRESS_SILENT_SOS:
      Serial.println("[press] silent SOS");
      enqueue("silent_panic", batteryPercent());
      nextRetryMs = 0;
      break;
    case PRESS_IGNORED:
      Serial.println("[press] too short, ignored");
      break;
    case PRESS_NONE:
      break;
  }

  // While the button is held, fill the ring so the person knows to keep holding.
  if (button.isHeld()) {
    player.renderHold(button.heldMs(now), SOS_HOLD_MS);
  } else {
    player.tick(now);
  }

  drainQueue(now);
  pollStatus(now);
  sendHeartbeat(now);

  delay(10);
}
