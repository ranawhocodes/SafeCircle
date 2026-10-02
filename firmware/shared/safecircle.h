/*
 * SafeCircle firmware — shared behaviour for the Home button and the Go pendant.
 *
 * The firmware is deliberately dumb. It measures a press, signs a payload, sends
 * it, and plays whatever pattern the server hands back. Every decision — which
 * stage to show, how a feedback profile changes it, whether a cancel ends the
 * alert — lives on the server, so changing a person's profile never means
 * reflashing their button.
 *
 * Build: PlatformIO or the Arduino IDE with the ESP32 board package.
 * See docs/02-architecture.md and master document section 18.
 */

#ifndef SAFECIRCLE_H
#define SAFECIRCLE_H

#include <Arduino.h>

// ---------------------------------------------------------------------------
// Press timing (master document section 6.1). These are also served by
// GET /api/device/{id}/config so a team decision does not need a reflash.
// ---------------------------------------------------------------------------

#define SOS_HOLD_MS 2000UL     // hold this long to raise an alert
#define CANCEL_HOLD_MS 4000UL  // hold longer to request a cancel
#define DEBOUNCE_MS 40UL       // mechanical switch settle time
#define SILENT_PRESS_COUNT 3   // triple press = silent SOS on discreet profiles
#define SILENT_PRESS_WINDOW_MS 1200UL

// ---------------------------------------------------------------------------
// Polling and retry (sections 7.3, 18.7)
// ---------------------------------------------------------------------------

#define POLL_FAST_MS 3000UL    // while an incident is open
#define POLL_SLOW_MS 15000UL   // between incidents
#define HEARTBEAT_INTERVAL_S (6UL * 3600UL)
#define RETRY_BASE_MS 1000UL
#define RETRY_MAX_MS 60000UL
#define QUEUE_DEPTH 8          // store-and-forward while offline

// ---------------------------------------------------------------------------
// Pins. Adjust for your board; these match the breadboard build in 18.9.
// ---------------------------------------------------------------------------

#define PIN_BUTTON 15          // momentary switch to ground, INPUT_PULLUP
#define PIN_LED_R 25
#define PIN_LED_G 26
#define PIN_LED_B 27
#define PIN_BUZZER 14          // passive buzzer, driven with ledc tones
#define PIN_VIBRATION 12       // coin motor via transistor + flyback diode
#define PIN_GPS_RX 16          // Go pendant only
#define PIN_GPS_TX 17

// ---------------------------------------------------------------------------
// Device stages (section 7.1). The server names the stage; we only play it.
// ---------------------------------------------------------------------------

enum Stage {
  STAGE_IDLE,
  STAGE_HOLDING,
  STAGE_SENDING,
  STAGE_RECEIVED,
  STAGE_ACCEPTED,
  STAGE_ARRIVING,
  STAGE_ARRIVED,
  STAGE_ESCALATED,
  STAGE_STILL_WORKING,
  STAGE_CANCEL_VERIFYING,
  STAGE_FAILED,
  STAGE_LOW_BATTERY
};

enum LightColour { C_NONE, C_WHITE, C_BLUE, C_GREEN, C_PURPLE, C_RED };
enum LightMotion { M_OFF, M_FILL, M_FAST_BLINK, M_SOLID, M_SLOW_PULSE,
                   M_FAST_PULSE, M_BRIGHTEN, M_SINGLE_FLASH };

/*
 * A pattern exactly as the server sends it. The server has ALREADY applied the
 * person's feedback profile, so a stealth pattern arrives here with volume 0 and
 * zero vibration pulses. The firmware must never "helpfully" add a beep.
 */
struct Pattern {
  LightColour colour;
  LightMotion motion;
  uint8_t brightness;   // 1..5
  char tone[24];        // "none" means silence
  uint16_t repeatEveryMs;
  uint8_t volume;       // 0..3, 0 means silent
  uint8_t pulses;       // 0..3, 0 means no vibration
  char length[8];       // none | short | long | gentle
  char meaning[64];
};

struct DeviceConfig {
  char deviceId[16];
  char hmacKey[64];
  char apiBase[96];
  bool hasGps;
  uint32_t sosHoldMs;
  uint32_t cancelHoldMs;
  uint8_t preSendCountdownS;
};

// ---------------------------------------------------------------------------
// Press detection
// ---------------------------------------------------------------------------

enum PressResult { PRESS_NONE, PRESS_IGNORED, PRESS_SOS, PRESS_CANCEL, PRESS_SILENT_SOS };

/*
 * Non-blocking press tracker.
 *
 * A brush under SOS_HOLD_MS is IGNORED rather than sent: that is the whole
 * reason for a hold instead of a tap. The cancel hold is deliberately longer
 * than the trigger hold so the two can never be confused by someone in a panic.
 */
class PressTracker {
 public:
  void begin(uint8_t pin) {
    pin_ = pin;
    pinMode(pin_, INPUT_PULLUP);
    lastLevel_ = digitalRead(pin_);
    pressStartMs_ = 0;
    tapCount_ = 0;
    tapWindowStartMs_ = 0;
  }

  /* Call every loop. Returns a result only on release. */
  PressResult update(uint32_t nowMs) {
    int level = digitalRead(pin_);
    if (level != lastLevel_) {
      if (nowMs - lastChangeMs_ < DEBOUNCE_MS) return PRESS_NONE;
      lastChangeMs_ = nowMs;
      lastLevel_ = level;

      if (level == LOW) {  // pressed (pull-up)
        pressStartMs_ = nowMs;
        return PRESS_NONE;
      }

      // released
      uint32_t held = nowMs - pressStartMs_;
      pressStartMs_ = 0;

      if (held >= CANCEL_HOLD_MS) {
        tapCount_ = 0;
        return PRESS_CANCEL;
      }
      if (held >= SOS_HOLD_MS) {
        tapCount_ = 0;
        return PRESS_SOS;
      }

      // Short taps: three inside the window is a silent SOS on a discreet or
      // stealth profile. The server decides whether that profile allows it.
      if (tapCount_ == 0 || nowMs - tapWindowStartMs_ > SILENT_PRESS_WINDOW_MS) {
        tapWindowStartMs_ = nowMs;
        tapCount_ = 1;
      } else {
        tapCount_++;
      }
      if (tapCount_ >= SILENT_PRESS_COUNT) {
        tapCount_ = 0;
        return PRESS_SILENT_SOS;
      }
      return PRESS_IGNORED;
    }
    return PRESS_NONE;
  }

  /* How long the button has been held right now, for the "fill" light. */
  uint32_t heldMs(uint32_t nowMs) const {
    return pressStartMs_ == 0 ? 0 : nowMs - pressStartMs_;
  }

  bool isHeld() const { return pressStartMs_ != 0; }

 private:
  uint8_t pin_ = PIN_BUTTON;
  int lastLevel_ = HIGH;
  uint32_t lastChangeMs_ = 0;
  uint32_t pressStartMs_ = 0;
  uint8_t tapCount_ = 0;
  uint32_t tapWindowStartMs_ = 0;
};

// ---------------------------------------------------------------------------
// Pattern player
// ---------------------------------------------------------------------------

/*
 * Plays a Pattern on the LED, buzzer and vibration motor.
 *
 * Non-blocking: every effect is driven from millis() in tick(), because the
 * device must keep polling and keep reading the button while a pattern plays.
 */
class PatternPlayer {
 public:
  void begin() {
    pinMode(PIN_LED_R, OUTPUT);
    pinMode(PIN_LED_G, OUTPUT);
    pinMode(PIN_LED_B, OUTPUT);
    pinMode(PIN_VIBRATION, OUTPUT);
    ledcSetup(kBuzzerChannel, 2000, 8);
    ledcAttachPin(PIN_BUZZER, kBuzzerChannel);
    clear();
  }

  void play(const Pattern& p, uint32_t nowMs) {
    pattern_ = p;
    startedMs_ = nowMs;
    lastRepeatMs_ = nowMs;
    pulsesLeft_ = p.pulses;
    vibrationUntilMs_ = 0;
    playTone(nowMs);
  }

  void tick(uint32_t nowMs) {
    renderLight(nowMs);
    renderVibration(nowMs);

    if (pattern_.repeatEveryMs > 0 && nowMs - lastRepeatMs_ >= pattern_.repeatEveryMs) {
      lastRepeatMs_ = nowMs;
      pulsesLeft_ = pattern_.pulses;
      playTone(nowMs);
    }
  }

  /* The "fill while holding" effect, driven by how long the button is held. */
  void renderHold(uint32_t heldMs, uint32_t holdTargetMs) {
    uint8_t level = (uint8_t)min((uint32_t)255, (heldMs * 255UL) / holdTargetMs);
    analogWrite(PIN_LED_R, level);
    analogWrite(PIN_LED_G, level);
    analogWrite(PIN_LED_B, level);
  }

  void clear() {
    analogWrite(PIN_LED_R, 0);
    analogWrite(PIN_LED_G, 0);
    analogWrite(PIN_LED_B, 0);
    digitalWrite(PIN_VIBRATION, LOW);
    ledcWriteTone(kBuzzerChannel, 0);
  }

 private:
  static const uint8_t kBuzzerChannel = 0;

  void renderLight(uint32_t nowMs) {
    uint8_t r = 0, g = 0, b = 0;
    switch (pattern_.colour) {
      case C_WHITE:  r = g = b = 255; break;
      case C_BLUE:   b = 255; break;
      case C_GREEN:  g = 255; break;
      case C_PURPLE: r = 160; b = 255; break;
      case C_RED:    r = 255; break;
      case C_NONE:   break;
    }

    // Brightness 1..5 from the profile. Stealth arrives here as 1.
    float scale = pattern_.brightness / 5.0f;
    uint32_t elapsed = nowMs - startedMs_;
    float envelope = 1.0f;

    switch (pattern_.motion) {
      case M_FAST_BLINK:   envelope = ((elapsed / 200) % 2) ? 0.0f : 1.0f; break;
      case M_SLOW_PULSE:   envelope = 0.35f + 0.65f * (0.5f * (1 + sinf(elapsed / 400.0f))); break;
      case M_FAST_PULSE:   envelope = 0.35f + 0.65f * (0.5f * (1 + sinf(elapsed / 150.0f))); break;
      case M_SINGLE_FLASH: envelope = elapsed < 250 ? 1.0f : 0.0f; break;
      case M_BRIGHTEN:     envelope = elapsed < 600 ? 1.0f : 0.6f; break;
      case M_OFF:          envelope = 0.0f; break;
      case M_SOLID:
      case M_FILL:
      default:             envelope = 1.0f; break;
    }

    analogWrite(PIN_LED_R, (uint8_t)(r * scale * envelope));
    analogWrite(PIN_LED_G, (uint8_t)(g * scale * envelope));
    analogWrite(PIN_LED_B, (uint8_t)(b * scale * envelope));
  }

  void renderVibration(uint32_t nowMs) {
    if (vibrationUntilMs_ > 0 && nowMs < vibrationUntilMs_) {
      digitalWrite(PIN_VIBRATION, HIGH);
      return;
    }
    digitalWrite(PIN_VIBRATION, LOW);

    if (pulsesLeft_ > 0 && nowMs - lastPulseMs_ > 260) {
      lastPulseMs_ = nowMs;
      pulsesLeft_--;
      uint32_t duration = 120;
      if (strcmp(pattern_.length, "long") == 0) duration = 420;
      else if (strcmp(pattern_.length, "gentle") == 0) duration = 70;
      vibrationUntilMs_ = nowMs + duration;
    }
  }

  /*
   * Tones. A volume of 0 means SILENCE and must be honoured exactly: a stealth
   * profile depends on it, and a buzz at the wrong moment could put someone in
   * danger. There is no "minimum audible" fallback here on purpose.
   */
  void playTone(uint32_t nowMs) {
    (void)nowMs;
    if (pattern_.volume == 0 || strcmp(pattern_.tone, "none") == 0) {
      ledcWriteTone(kBuzzerChannel, 0);
      return;
    }
    uint16_t freq = 1200;
    if (strcmp(pattern_.tone, "two_tone_chime") == 0) freq = 880;
    else if (strcmp(pattern_.tone, "three_rising_notes") == 0) freq = 660;
    else if (strcmp(pattern_.tone, "fast_chime") == 0) freq = 1046;
    else if (strcmp(pattern_.tone, "long_soft_tone") == 0) freq = 523;
    else if (strcmp(pattern_.tone, "two_note_distinct") == 0) freq = 440;
    else if (strcmp(pattern_.tone, "triple_beep") == 0) freq = 1800;
    else if (strcmp(pattern_.tone, "rising_ticks") == 0) freq = 1400;
    ledcWriteTone(kBuzzerChannel, freq);
    toneOffAtMs_ = millis() + 180;
  }

  Pattern pattern_ = {};
  uint32_t startedMs_ = 0;
  uint32_t lastRepeatMs_ = 0;
  uint32_t lastPulseMs_ = 0;
  uint32_t vibrationUntilMs_ = 0;
  uint32_t toneOffAtMs_ = 0;
  uint8_t pulsesLeft_ = 0;
};

#endif  // SAFECIRCLE_H
