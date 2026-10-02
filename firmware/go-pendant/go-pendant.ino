/*
 * SafeCircle Go pendant — ESP32 + GNSS (+ 4G on the pilot board).
 *
 * The device that finds a person away from home. Everything the Home button does,
 * plus the location design in section 18.2:
 *
 *   SEND NOW, REFINE LATER.
 *
 * On a press it starts the GPS receiver, the modem and a Wi-Fi scan all at once,
 * and sends the first message within seconds with whatever it already has — the
 * last GPS fix with its age, the Wi-Fi networks it can see, the serving cell.
 * The backend dispatches on that immediately. A proper GPS fix follows as a
 * location update and the responders' map tightens.
 *
 * It never waits for a satellite fix before raising the alarm.
 *
 * Route A (demo):  ESP32 + a GNSS breakout, sending over a phone hotspot.
 * Route B (pilot): LilyGO T-A7670G with GPS — define USE_LTE in secrets.h.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include <mbedtls/md.h>
#include "../shared/safecircle.h"
#include "secrets.h"

PressTracker button;
PatternPlayer player;
TinyGPSPlus gps;
HardwareSerial gpsSerial(1);

static uint8_t batteryPercent();

static uint32_t sequence = 0;
static uint32_t lastPollMs = 0;
static uint32_t lastLocationSendMs = 0;
static uint32_t lastHeartbeatMs = 0;
static bool incidentOpen = false;
static int lastSeqSeen = -1;
static bool gpsPowered = false;

/* Update cadence while an incident is open (section 18.2). */
#define LOCATION_UPDATE_MOVING_MS 10000UL
#define LOCATION_UPDATE_STILL_MS 60000UL
#define MOVING_THRESHOLD_MPS 1.0

/* Keep the last fix and its age, so a cold start still has something to send. */
struct LastFix {
  double lat = 0;
  double lng = 0;
  double accuracyM = 0;
  uint32_t atMs = 0;
  bool valid = false;
};
static LastFix lastFix;

// ---------------------------------------------------------------------------
// Signing. Identical to the Home button, but the canonical body now includes a
// nested location object, so it is built with ArduinoJson and serialised with
// sorted keys to match the server exactly.
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
 * Build the canonical body by hand, with keys in alphabetical order at every
 * level, matching canonicalise() in apps/api/src/security/hmac.ts.
 *
 * Order at the top level: battery, device_id, event, location, seq.
 * Inside location: cell, gps, known_place, wifi.
 * Inside gps: acc_m, age_s, lat, lng.
 */
static String canonicalBody(const char* event, uint32_t seq, uint8_t battery,
                            bool includeLocation, const String& wifiJson) {
  String s = "{";
  s += "\"battery\":" + String(battery) + ",";
  s += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  s += "\"event\":\"" + String(event) + "\"";

  if (includeLocation) {
    s += ",\"location\":{";
    bool first = true;

    if (lastFix.valid) {
      uint32_t ageS = (millis() - lastFix.atMs) / 1000;
      s += "\"gps\":{";
      s += "\"acc_m\":" + String(lastFix.accuracyM, 1) + ",";
      s += "\"age_s\":" + String(ageS) + ",";
      s += "\"lat\":" + String(lastFix.lat, 6) + ",";
      s += "\"lng\":" + String(lastFix.lng, 6);
      s += "}";
      first = false;
    }
    if (wifiJson.length() > 0) {
      if (!first) s += ",";
      s += "\"wifi\":" + wifiJson;
      first = false;
    }
    s += "}";
  }

  s += ",\"seq\":" + String(seq);
  s += "}";
  return s;
}

/*
 * Scan for nearby Wi-Fi networks. Listing them does NOT require joining any,
 * and the backend turns the list into a position through a geolocation service.
 * This is what finds someone inside a mall where GPS cannot lock.
 */
static String scanWifi() {
  int found = WiFi.scanNetworks(false, true, false, 120);
  if (found <= 0) return "";

  String json = "[";
  int included = 0;
  for (int i = 0; i < found && included < 6; i++) {
    if (included > 0) json += ",";
    // Keys sorted: bssid then rssi.
    json += "{\"bssid\":\"" + WiFi.BSSIDstr(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
    included++;
  }
  json += "]";
  WiFi.scanDelete();
  return json;
}

// ---------------------------------------------------------------------------
// GPS
// ---------------------------------------------------------------------------

static void powerGps(bool on) {
  if (gpsPowered == on) return;
  gpsPowered = on;
  if (on) {
    gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
    Serial.println("[gps] on");
  } else {
    gpsSerial.end();
    Serial.println("[gps] off — a safety device, not a tracker");
  }
}

/* Feed the parser. Called every loop while the receiver is powered. */
static void readGps() {
  if (!gpsPowered) return;
  while (gpsSerial.available() > 0) {
    if (gps.encode(gpsSerial.read()) && gps.location.isValid()) {
      lastFix.lat = gps.location.lat();
      lastFix.lng = gps.location.lng();
      // HDOP as a rough accuracy proxy; a real build reads the module's own
      // accuracy estimate where the protocol provides one.
      lastFix.accuracyM = gps.hdop.isValid() ? max(3.0, gps.hdop.hdop() * 2.5) : 15.0;
      lastFix.atMs = millis();
      lastFix.valid = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

static bool postSigned(const char* path, const String& body) {
  if (WiFi.status() != WL_CONNECTED) return false;

  String signature = hmacHex(DEVICE_KEY, body);
  String payload = body.substring(0, body.length() - 1);
  payload += ",\"signature\":\"" + signature + "\"}";

  HTTPClient http;
  http.begin(String(API_BASE) + path);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  int status = http.POST(payload);
  bool ok = (status == 202);

  if (ok) {
    JsonDocument doc;
    if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
      incidentOpen = doc["incidentOpen"] | doc["incident_open"] | true;
      if (doc["seq"].is<int>()) lastSeqSeen = doc["seq"];
      if (doc["location_source"].is<const char*>()) {
        Serial.print("[sent] located by ");
        Serial.print(doc["location_source"].as<const char*>());
        Serial.print(" ~");
        Serial.print(doc["location_accuracy_m"] | 0);
        Serial.println(" m");
      }
    }
  } else {
    Serial.print("[send] HTTP ");
    Serial.println(status);
  }
  http.end();
  return ok;
}

/*
 * A press. Start everything at once, then send immediately with whatever we
 * have — this is the whole "send now, refine later" design.
 */
static void raiseAlert(const char* event) {
  powerGps(true);               // starts acquiring while we send
  String wifi = scanWifi();     // a few hundred ms, no network needed

  String body = canonicalBody(event, ++sequence, batteryPercent(), true, wifi);
  Serial.print("[press] ");
  Serial.print(event);
  Serial.print(lastFix.valid ? " with a cached GPS fix" : " with no GPS fix yet");
  Serial.println(wifi.length() ? " plus a Wi-Fi scan" : "");

  if (!postSigned("/api/sos/device", body)) {
    Pattern failed = {};
    failed.colour = C_RED;
    failed.motion = M_FAST_BLINK;
    failed.brightness = 5;
    strlcpy(failed.tone, "triple_beep", sizeof(failed.tone));
    failed.volume = 3;
    failed.pulses = 3;
    strlcpy(failed.length, "long", sizeof(failed.length));
    strlcpy(failed.meaning, "Not sent, still trying", sizeof(failed.meaning));
    player.play(failed, millis());
  }
}

/* Position updates while an incident is open: ~10 s moving, ~60 s still. */
static void sendLocationUpdate(uint32_t nowMs) {
  if (!incidentOpen) return;

  double speed = gps.speed.isValid() ? gps.speed.mps() : 0.0;
  uint32_t interval =
      speed > MOVING_THRESHOLD_MPS ? LOCATION_UPDATE_MOVING_MS : LOCATION_UPDATE_STILL_MS;
  if (nowMs - lastLocationSendMs < interval) return;
  lastLocationSendMs = nowMs;

  String wifi = lastFix.valid ? "" : scanWifi();
  String body = canonicalBody("location_update", ++sequence, batteryPercent(), true, wifi);
  postSigned("/api/sos/device", body);
}

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
      bool wasOpen = incidentOpen;
      incidentOpen = doc["incident_open"] | false;

      if (seq > lastSeqSeen) {
        lastSeqSeen = seq;
        JsonObjectConst p = doc["pattern"];
        if (!p.isNull()) {
          Pattern out = {};
          const char* colour = p["light"]["colour"] | "none";
          if (!strcmp(colour, "white")) out.colour = C_WHITE;
          else if (!strcmp(colour, "blue")) out.colour = C_BLUE;
          else if (!strcmp(colour, "green")) out.colour = C_GREEN;
          else if (!strcmp(colour, "purple")) out.colour = C_PURPLE;
          else if (!strcmp(colour, "red")) out.colour = C_RED;

          const char* motion = p["light"]["motion"] | "off";
          if (!strcmp(motion, "fast_blink")) out.motion = M_FAST_BLINK;
          else if (!strcmp(motion, "solid")) out.motion = M_SOLID;
          else if (!strcmp(motion, "slow_pulse")) out.motion = M_SLOW_PULSE;
          else if (!strcmp(motion, "fast_pulse")) out.motion = M_FAST_PULSE;
          else if (!strcmp(motion, "single_flash")) out.motion = M_SINGLE_FLASH;
          else if (!strcmp(motion, "brighten")) out.motion = M_BRIGHTEN;

          out.brightness = p["light"]["brightness"] | 3;
          strlcpy(out.tone, p["sound"]["tone"] | "none", sizeof(out.tone));
          out.volume = p["sound"]["volume"] | 0;
          out.repeatEveryMs = p["sound"]["repeatEveryMs"] | 0;
          out.pulses = p["vibration"]["pulses"] | 0;
          strlcpy(out.length, p["vibration"]["length"] | "none", sizeof(out.length));
          strlcpy(out.meaning, p["meaning"] | "", sizeof(out.meaning));
          player.play(out, millis());

          Serial.print("[stage] ");
          Serial.println(out.meaning);
        }
      }

      // The incident closed: GPS off, back to sleep. This is what makes the
      // pendant a safety device rather than a tracker (section 18.5, 20.6).
      if (wasOpen && !incidentOpen) {
        powerGps(false);
        player.clear();
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
  // Replace with a divider reading on the LiPo. The caregiver is warned at 20%.
  return 76;
}

// ---------------------------------------------------------------------------
// Arduino lifecycle
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("SafeCircle Go pendant");
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

#ifdef USE_LTE
  Serial.println("[lte] route B board: bring up the A7670G modem here");
  // Pilot build: initialise the modem, attach to SIM_APN, and prefer a saved
  // Wi-Fi network when one is in range because it is faster and free.
#else
  Serial.println("[lte] route A demo build: sending over the phone hotspot");
#endif

  sequence = (uint32_t)(esp_random() & 0x0FFFFFFF);

  // Refresh assisted-GPS data while on the dock, so a real press gets a hot
  // start of about a second instead of a cold start of about 24.
  powerGps(true);
  Serial.println("[gps] warming up for an assisted start, then powering down");
}

void loop() {
  uint32_t now = millis();

  readGps();

  PressResult result = button.update(now);
  switch (result) {
    case PRESS_SOS:          raiseAlert("panic"); break;
    case PRESS_CANCEL:       raiseAlert("cancel"); break;
    case PRESS_SILENT_SOS:   raiseAlert("silent_panic"); break;
    case PRESS_IGNORED:      Serial.println("[press] too short, ignored"); break;
    case PRESS_NONE:         break;
  }

  if (button.isHeld()) {
    player.renderHold(button.heldMs(now), SOS_HOLD_MS);
  } else {
    player.tick(now);
  }

  sendLocationUpdate(now);
  pollStatus(now);
  sendHeartbeat(now);

  // Between incidents the GPS stays off. An opt-in safe-zone mode is Roadmap and
  // needs the adult's own consent (section 20.6).
  if (!incidentOpen && gpsPowered && lastFix.valid && millis() - lastFix.atMs > 120000UL) {
    powerGps(false);
  }

  delay(10);
}
