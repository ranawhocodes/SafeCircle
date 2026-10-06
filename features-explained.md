# SafeCircle — Features Explained: In-Depth Technical & Operational Guide

> **Document Scope:** Detailed breakdown of core system features (**F5, F6, F9, F12, F14, F15, F16/F17, F19, F25, F34, F37, F41**) covering trigger pipelines, volunteer ranking, trust levels, hardware telemetry, security mechanisms, and privacy architectures.
>
> **Reference Architecture:** SafeCircle Monorepo (`apps/api`, `apps/web`, `packages/shared`, `tools/sim`, `firmware/`).

---

## Table of Contents
1. [F16 & F17: Two-Priority Dispatching & Rolling Promotion](#1-f16--f17-two-priority-dispatching--rolling-promotion)
2. [F25: Volunteer Trust Levels & Alarm Categorization](#2-f25-volunteer-trust-levels--alarm-categorization)
3. [F5: Zero-Disclosure Bystander QR Sticker](#3-f5-zero-disclosure-bystander-qr-sticker)
4. [F6: Silent SOS, Stealth Mode & Default Configuration](#4-f6-silent-sos-stealth-mode--default-configuration)
5. [F9: Browser Wi-Fi Provisioning & BLE Improv](#5-f9-browser-wi-fi-provisioning--ble-improv)
6. [F12: Severity Rules (P1–P3) & Vehicle Speed Detection](#6-f12-severity-rules-p1p3--vehicle-speed-detection)
7. [F14: Cryptographic HMAC Signatures & Anti-Replay](#7-f14-cryptographic-hmac-signatures--anti-replay)
8. [F15: Start-of-Alert Check-in IVR Call & DTMF Routing](#8-f15-start-of-alert-check-in-ivr-call--dtmf-routing)
9. [F19: Incident Ingestion, Team Capping & Continuous Search](#9-f19-incident-ingestion-team-capping--continuous-search)
10. [F34: Tailored Feedback Profiles (All 8 Behaviors)](#10-f34-tailored-feedback-profiles-all-8-behaviors)
11. [F37: Proactive Device Heartbeat & Battery Telemetry](#11-f37-proactive-device-heartbeat--battery-telemetry)
12. [F41: Wi-Fi Scan Positioning & Location Fusion](#12-f41-wi-fi-scan-positioning--location-fusion)

---

## 1. F16 & F17: Two-Priority Dispatching & Rolling Promotion

### How Volunteers Are Selected for Tier 1
In an emergency, every second counts, but so does trust. Feature 16 executes a **Two-Priority Sequential Selection** for the initial top 3 responders:

```
Incident Triggered
       │
       ▼
Filter candidates within close proximity (750 m / coarse-cell neighborhood)
       │
       ├─► Priority 1: Pick nearest VERIFIED volunteers (up to 3)
       │
       └─► Priority 2: If fewer than 3 verified volunteers are found,
                       backfill remaining slots with nearest UNVERIFIED volunteers
                               │
                               ▼
                   Top 3 Responders Assigned Tier 1 (Siren Alarm)
                   All other eligible volunteers assigned Tier 2 (Silent Notification)
                               │
                   ┌───────────┴───────────┐
            After 30 Seconds        Volunteer Declines
                   │                       │
                   ▼                       ▼
         Escalate to ALL           F17: Rolling Auto-Promotion
      volunteers within 1 km         (Verified first, then
          to Tier 1 Alarm            Unverified from Tier 2)
```

1. **Priority 1 (Nearest Verified Responders):**
   The ranking engine evaluates candidates within the close-proximity boundary (`DISPATCH.closeProximityM = 750m`, encompassing the ~707m coarse-cell grid resolution). The highest-ranked **verified** volunteers (Trust Level $\ge 2$) fill the top 3 slots (`tier1Size: 3`).
2. **Priority 2 (Unverified Backfill):**
   If only 1 or 2 verified volunteers are in close proximity, the incident does not wait. The system immediately fills the remaining slots (up to 3) with the nearest **unverified** volunteers (Trust Level 0 or 1). This guarantees that 3 people always receive high-priority full-screen alarms instantly.
3. **Tier 2 Notification for Others:**
   All other eligible volunteers beyond the top 3 (both within and outside close proximity up to the search radius) receive a normal, non-intrusive Tier 2 notification at the exact same moment.
4. **30-Second Escalation to 1 km:**
   If none of the initial responders accept within 30 seconds, the 30-second escalation timer (`upgradeAll`) triggers. **All** volunteers within a 1 km radius (`DISPATCH.escalationRadiusM = 1000m`) are upgraded to Tier 1 siren alarms.
5. **F17 Rolling Top 3 Auto-Promotion:**
   If any Tier 1 volunteer explicitly clicks **"Decline"** (e.g. "Too far away" or "Busy"), the system immediately promotes the next best volunteer from Tier 2 to Tier 1 without waiting for the 30-second timer. It respects the same two-priority logic: nearest verified volunteer first; if none remain in Tier 2, it promotes an unverified volunteer.

---

## 2. F25: Volunteer Trust Levels & Alarm Categorization

### How Volunteer Trust Levels Are Determined
Trust levels (`0` to `3`) represent a volunteer's vetting status, background verification, and medical training:

| Trust Level | Designation | How It Is Earned / Verified | Dispatch Permissions |
| :--- | :--- | :--- | :--- |
| **Level 0 (L0)** | **New Applicant** | User has registered their phone number and name, but has not completed training. | Alerted at Tier 2 only; barred from going "Available Now" until tutorial is complete. |
| **Level 1 (L1)** | **Trained Community Volunteer** | Completed all 6 modules of the Interactive Safety Tutorial (**F28**) and scored $\ge 80\%$ on the quiz. | Can toggle "Available Now"; eligible for Tier 2 and Priority 2 Tier 1 backfill. |
| **Level 2 (L2)** | **Community Verified Volunteer** | Underwent Community Vouching Round (**F26**): received $\ge 3$ vouches from existing verified neighbors with 0 concerns and $\ge 66\%$ approval within 7 days; or verified via DigiLocker Government ID (**F27**). | Eligible for Priority 1 Tier 1 alarms; receives "Verified" checkmark badge. |
| **Level 3 (L3)** | **Credentialed Medical Professional** | Submitted active medical council registration (Doctor, Nurse, Paramedic) or certified First Aider with dated review. | Priority 1 Tier 1; receives skill bonus ETA score reduction (30–60s) for medical incidents; badge displayed in app. |

### Categorization of Alarms: Tier 1 vs Tier 2
The system distinguishes urgency, not timing:
- **Tier 1 (High-Priority Emergency Siren):** Triggers a full-screen, screen-waking alert that overrides Do Not Disturb / silent mode on Android/iOS (via critical alert channels) and emits an audible siren. Targeted at the immediate top 3 responders.
- **Tier 2 (Standard Notification):** Standard quiet push notification delivered to all other active volunteers in the geofence. Volunteers see the alert in their feed, can view general distance, and can accept if Tier 1 responders decline.

### Special Safeguard: Protected Profiles at Risk (`FR-ALT-7`)
For high-vulnerability profiles—such as young children, individuals with dementia/cognitive disabilities, or victims under domestic distress (`protected: true`)—an unverified volunteer (L0/L1) **may never be the sole responder**. If no verified (L2+) volunteer is nearby, the engine flags `protectedProfileAtRisk: true`, triggering immediate escalation to on-duty society security guards and the central dashboard.

---

## 3. F5: Zero-Disclosure Bystander QR Sticker

### Placement on the Person
The Bystander QR code is physically deployed in multiple tamper-resistant, weatherproof formats:
1. **Back of the Go Pendant:** Laser-etched directly onto the rear plastic/polycarbonate casing of the wearable pendant.
2. **Adhesive Silicone Sticker:** Affixed to personal belongings (walking stick, wheelchair frame, school backpack, or phone case).
3. **Emergency Wristband / Lanyard Card:** Worn by children or adults with Alzheimer’s or non-verbal autism when outdoors.

### What Happens After Scanning (Step-by-Step)
When a bystander encounters someone lost, fallen, or confused, they point any smartphone camera at the QR code. The URL format is `https://safecircle.app/bystander?code=GO-042`.

```
Bystander Scans QR Code
         │
         ▼
Opens /bystander?code=GO-042 (Mobile Web)
         │
         ├─► Zero-Disclosure Check: NO personal data rendered
         │   (No name, no photo, no flat number, no health conditions)
         │
         ├─► Browser requests navigator.geolocation (GPS coords)
         │
         ▼
Bystander sees two buttons:
┌───────────────────────────────────────┐
│ [  I Found Someone Who Needs Help  ]  │ ──► Sends bystander GPS to /api/bystander/report
│ [             Call 112             ]  │ ──► Opens phone dialer: tel:112
└───────────────────────────────────────┘
```

1. **Zero-Disclosure Privacy (`FR-TRG-8`):**
   The browser displays **zero** personal data. An attacker, stalker, or stranger scanning the code learns nothing about the person's identity, gender, home address, medical history, or family contacts.
2. **GPS Capture & Incident Linkage:**
   When the bystander taps *"I Found Someone Who Needs Help"*, the web app queries the phone's high-accuracy browser geolocation. It sends this coordinate to `/api/bystander/report`. If an incident is already open for this pendant, the new bystander fix is fused into the incident trajectory; if no incident exists, an emergency incident is opened instantly.
3. **Anti-Probing Security:**
   If a malicious actor inputs random or sequential codes (e.g. `GO-999`), the server returns the **exact same HTTP 200 response and UI layout** as a real code. The system does not leak whether a device code is valid, preventing code harvesting or enumeration attacks.

---

## 4. F6: Silent SOS, Stealth Mode & Default Configuration

### Triple-Tap Dynamic Override
On any SafeCircle hardware device (both the **Home Button** and the **Go Pendant**), pressing the SOS button 3 times in rapid succession (within 1.5 seconds) triggers a **Silent SOS / Discreet Panic**:
- Even if the device is assigned a standard loud profile, the local buzzer and high-intensity LEDs are **completely suppressed**.
- The hardware emits only subtle, muted vibration pulses that cannot be heard by a perpetrator standing 1 meter away.
- The server receives `event: "silent_panic"`, marks `flags.silentRequested: true`, elevates severity to P1, and briefings instruct volunteers: *"Arrive quietly. Do not mention SafeCircle or the alert out loud."*

### Can Stealth Mode Be Configured as the Permanent Default?
**Yes, absolutely.**
In the Caregiver Portal (**F8 / F34**), the user's `feedback_profile` can be permanently set to `stealth`:

```json
{
  "id": "per_shanti",
  "feedback_profile": "stealth",
  "protected": true
}
```

When a device belongs to a person with `stealth` as their default profile:
1. **Zero Device Output on Every Press:** Whether pressed once, held down, or pressed three times, the device **never** beeps, chirps, speaks, or lights up.
2. **Suppression of Outbound Victim Phone Calls (`FR-CAN-6`):**
   Under normal profiles, an SOS triggers a check-in call (**F15**) or cancellation verification to the person's phone. In `stealth` mode, calling the victim's phone could endanger them if a hostile individual is present. Therefore, **the victim's phone is never rung**. All verification and cancellation checks are routed silently to the primary caregiver's phone.
3. **Immediate P1 Escalation:** Any activation from a stealth profile is automatically scored as **P1**, immediately informing authorities and dispatching responders without delay.

---

## 5. F9: Browser Wi-Fi Provisioning & BLE Improv

### Why Feature 9 Exists
Headless IoT safety buttons have no screens or keypads. Elderly users and caregivers cannot be expected to install esoteric native apps, install USB serial drivers, or configure terminal scripts. Feature 9 enables **100% web-browser-based Wi-Fi setup** directly from Chrome or Edge via the Caregiver Portal.

### Two Provisioning Modes

#### 1. SoftAP Captive Portal Hotspot
- The device boots into access-point mode and broadcasts a temporary SSID: `SafeCircle-Setup-XXXX`.
- The caregiver joins this Wi-Fi network from their laptop or phone.
- The browser captive portal opens automatically at `192.168.4.1`, where the caregiver selects the home Wi-Fi network, enters the password, and clicks "Connect".

#### 2. Improv Wi-Fi over Web Bluetooth (BLE Improv)
- **What is BLE Improv doing here?**
  [Improv Wi-Fi](https://www.improv-wifi.com/) is an open standard for configuring Wi-Fi over Bluetooth Low Energy.
  Using the modern **Web Bluetooth API**, the caregiver clicks *"Connect Button via Bluetooth"* in the web browser.
- The browser pairs directly with the ESP32 chip over BLE GATT services:
  - Service UUID: `00467641-0728-4074-9071-7cb46e7f8664`
  - Sends Wi-Fi SSID and passphrase over the RPC characteristic.
  - Receives real-time state notifications (`0x02 = Authorized`, `0x03 = Provisioning`, `0x04 = Provisioned`).
  - Reads back the device's local IP address and connected BSSID (router MAC).

### Automatic Binding to "Known Places"
When Wi-Fi is configured through the portal, the system associates the router's SSID and BSSID with the apartment's physical address in the database (`known_places` table):
```sql
INSERT INTO known_places (society_id, person_id, name, bssid, lat, lng, flat)
VALUES ('soc_besant', 'per_lakshmi', 'Home Wi-Fi', '18:e8:29:43:a1:10', 13.0002, 80.2668, 'B-204');
```
The moment an SOS arrives over that Wi-Fi connection, the server matches the BSSID and resolves the location to **"Flat B-204, 12 Gandhi Street"** with zero GPS delay.

---

## 6. F12: Severity Rules (P1–P3) & Vehicle Speed Detection

### Severity Tiers
Every incident is triaged by `shared/severity.ts` into three severity levels:

| Level | Severity | Behavior & Timers | Typical Triggers |
| :---: | :--- | :--- | :--- |
| **P1** | **Critical Emergency** | Immediate siren alarm to top volunteers; **immediate** alert to 112 / police; no 90s delay timer. | Child moving at vehicle speed (abduction); stealth trigger; unconsciousness reported; duress PIN entered. |
| **P2** | **Urgent Assistance** | Top 3 volunteers alerted at Tier 1; 30s upgrade timer armed; 60s family notification armed; 90s escalation to 112 armed. | Standard hardware SOS button press; WhatsApp "HELP"; elderly fall with no response to check-in call. |
| **P3** | **Advisory / Low** | Dispatched to guards/caregivers; never escalates to 112 automatically. | "Pressed by mistake" DTMF response on check-in call; practice drill; minor non-injury assist. |

### How Vehicle Speed Is Measured
The Go Pendant includes an onboard GNSS (GPS) receiver that transmits timestamped coordinates:
$$\text{fix}_1 = (\text{lat}_1, \text{lng}_1, t_1), \quad \text{fix}_2 = (\text{lat}_2, \text{lng}_2, t_2)$$

1. **Calculating Velocity:**
   The backend calculates the Haversine distance $\Delta d$ in meters between consecutive valid GPS fixes, divided by elapsed time $\Delta t = t_2 - t_1$:
   $$v = \frac{\Delta d}{\Delta t} \quad (\text{m/s})$$
2. **Speed Thresholds (`FUSION` & `TRIAGE`):**
   - Walking Speed: $\le 1.4\text{ m/s}$ (~$5\text{ km/h}$)
   - Cycling / Running: $1.4\text{ m/s}$ to $4.5\text{ m/s}$ (~$16\text{ km/h}$)
   - **Vehicle Speed:** $> 6.9\text{ m/s}$ (~$25\text{ km/h}$) or rapid displacement across multiple city blocks.
3. **Child Abduction Detection Logic:**
   ```typescript
   if (person.isChild && speedMps > 6.9 && !caregiverAccompanying) {
     return { severity: 'P1', caseType: 'abduction', flags: { vehicleSpeed: true } };
   }
   ```
   If a child wearing the pendant is suddenly detected moving at vehicle speed without their registered caregiver's phone nearby, it is classified as a **P1 Child Abduction Alert**, dispatching police and society security guards immediately.

---

## 7. F14: Cryptographic HMAC Signatures & Anti-Replay

### Threat Model
Because SafeCircle uses HTTP/Wi-Fi/cellular endpoints to trigger life-safety alarms, malicious actors could attempt:
1. **Packet Tampering:** Intercepting an SOS payload and changing the GPS coordinates or person ID.
2. **Replay Attacks:** Recording a valid SOS radio transmission and replaying it hours or days later to create chaos or harassment.
3. **Ghost Ingestion:** Sending fabricated alerts from non-existent devices.

### HMAC-SHA256 Signing Implementation
During factory provisioning, every physical device is assigned a high-entropy 256-bit symmetric secret key (`hmac_key`). The key is flashed into the secure hardware partition and stored in the database `devices` table.

```
Firmware Constructs Payload
  { device_id: "HB-001", event: "panic", seq: 1042, battery: 85 }
                 │
                 ▼
Canonical String = "HB-001:panic:1042:85"
                 │
                 ▼
Signature = HMAC-SHA256(Canonical String, device_hmac_key)
                 │
                 ▼
Sent in POST /api/sos/device
                 │
                 ▼
Server Recomputes HMAC using stored key & timingSafeEqual()
```

### Monotonic Sequence Counter (`seq`)
To defeat replay attacks:
1. The hardware maintains a persistent sequence counter (`seq`) incremented on every transmission.
2. The server records `device.last_seq`.
3. If an incoming payload has $\text{seq} \le \text{last\_seq}$, the server identifies a duplicate/replayed packet and rejects it with `409 Conflict`.
4. Sequence numbers are strictly monotonic; a gap ($\text{seq} > \text{last\_seq} + 1$) is accepted to allow for devices that buffered events while offline.

---

## 8. F15: Start-of-Alert Check-in IVR Call & DTMF Routing

### Are We Assuming the Victim Has a Phone?
**No.** SafeCircle is explicitly built for people who cannot or do not use a smartphone.
- The person profile has two dedicated fields: `has_own_phone` (boolean) and `own_phone` (string or null).
- **If `has_own_phone === false`:** (e.g. young children, advanced dementia patients, non-verbal seniors), **no call is made to the victim**. The alert proceeds solely through button telemetry and volunteer dispatch.
- **If `has_own_phone === true`:** (e.g. an elderly person with a basic Nokia feature phone or landline in the room), the IVR check-in call triggers automatically.

### How the Call Works
When the button is pressed, the server triggers an automated outbound call via a telephony gateway:

```
SOS Pressed (Lakshmi's HB-001)
       │
       ▼
In parallel with volunteer dispatch,
Automated Call placed to Lakshmi's phone (+919999900011)
       │
       ▼
Phone rings. Automated voice plays:
"SafeCircle alert received.
 Press 1 if you cannot breathe.
 Press 2 if you had a fall.
 Press 3 if you are in danger.
 Press 4 if this was pressed by mistake."
       │
       ├─► Victim Presses 1 ──► Updates case to "collapse" / CPR Flashcards
       ├─► Victim Presses 2 ──► Updates case to "fall" / Fall Flashcards
       ├─► Victim Presses 3 ──► Escalates to P1 "harassment" / Police alert
       ├─► Victim Presses 4 ──► Starts verified cancel workflow (cancel_verifying)
       └─► No Answer (Timeout) ──► If cardiac history, auto-escalates to P1;
                                   otherwise continues P2 volunteer response
```

Volunteers already en route receive an instant live update on their screens: *"Lakshmi confirmed via phone: Fall reported"*, and the first-aid flashcard flips automatically to geriatric fall handling.

---

## 9. F19: Incident Ingestion, Team Capping & Continuous Search

### How Incident Information Is Captured Across Scenarios
SafeCircle standardizes diverse trigger channels into a uniform incident model:

```
Trigger Sources
 ├── Hardware Button / Go Pendant ──► Ingests device ID, battery, Wi-Fi BSSIDs, GPS
 ├── WhatsApp "HELP" Message     ──► Parses registered phone number, natural language text
 ├── Caregiver Web Portal        ──► Explicit manual trigger with dependent selection
 ├── Missed Call (F7)            ──► Caller ID lookup against registered emergency lines
 └── Bystander QR Scan (F5)      ──► Browser geolocation report from unknown stranger
                 │
                 ▼
      Unified Ingestion Pipeline (`apps/api/src/domain/engine.ts`)
                 │
                 ├─► Assigns Case Type & Severity (P1/P2/P3)
                 ├─► Evaluates Feedback Profile (F34)
                 ├─► Ranks & Dispatches Volunteers (F16/F17/F18)
                 └─► Refined on-scene by Volunteer Tap (F22)
```

### Why We Do NOT Stop Searching When Just One Person Says "I Am on the Way"
A single acceptance is never sufficient in a life-safety network:
1. **The Single Point of Failure (Dropouts):** A volunteer who taps "Accept" might get stuck in an elevator, find their motorcycle won't start, get caught at a locked security gate, or trip. If the system stopped searching, the victim would be left alone without backup.
2. **Physical Requirements of Emergencies:**
   - **CPR / Cardiac Collapse:** Effective CPR requires chest compressions rotated every 2 minutes to prevent rescuer exhaustion. A single rescuer cannot maintain compressions while opening doors for paramedics.
   - **Lifting a Heavy Adult:** A frail elderly person who has fallen in a tight bathroom often requires two people to safely lift without spinal injury.
   - **Harassment / Danger:** Approaching a hostile confrontation alone puts the volunteer at extreme risk. Multiple responders create a safe, visible community presence.

### How Team Caps Work (`teamCapFor`)
While multiple responders are necessary, sending 15 people into an elderly resident's bedroom causes panic and confusion. SafeCircle enforces **Team Caps**:

```typescript
const caps: Record<CaseType, number> = {
  child: 1,       // 1 person avoids scaring a lost child
  cognitive: 1,   // 1 familiar person avoids agitating a dementia patient
  fall: 2,        // 2 people to assist lifting safely
  medical: 2,     // 2 responders for vitals & coordination
  collapse: 3,    // 3 responders to rotate CPR compressions
  harassment: 3,  // 3 responders for mutual safety & deterrence
  fire: 3,        // 3 responders for evacuation assistance
  unknown: 2,
};
// Any P1 critical severity adds +1 extra responder
```

**The Stand-Down Workflow:**
Once the required number of responders have clicked **"Accept"**, the remaining volunteers who have not yet responded are automatically stood down:
- The alert disappears from their screen.
- A polite, appreciative notice appears: *"Team cap reached — situation is covered by nearby responders. Thank you for standing by!"*

---

## 10. F34: Tailored Feedback Profiles (All 8 Behaviors)

Different vulnerable populations require fundamentally different sensory feedback when an alarm is triggered:

```
                        FEEDBACK PROFILES
┌──────────────────┬────────────────────────────────────────────────────────┐
│ Profile          │ Sensory Behavior on Button & Pendant                   │
├──────────────────┼────────────────────────────────────────────────────────┤
│ 1. loud          │ High-decibel audible buzzer, rapid high-lumen LED.    │
│ 2. spoken        │ Audio voice prompts ("Help is on the way").            │
│ 3. calm          │ Soft harmonic chimes, slow breathing glow (Autism/AD). │
│ 4. visual_first  │ Intense distinct strobe sequences, strong vibration.   │
│ 5. stealth       │ 100% silent, zero lights, invisible haptics.           │
│ 6. discreet      │ Single gentle vibration confirmation, no buzzer.       │
│ 7. haptic_first  │ Multi-frequency tactile vibration patterns.           │
│ 8. child_friendly│ Friendly musical sequence, playful non-frightening LED.│
└──────────────────┴────────────────────────────────────────────────────────┘
```

The server automatically transforms device responses based on the individual's profile:
- A grandmother with hearing impairment (`visual_first`) gets powerful pulsing lights confirming the alert was received.
- A non-verbal autistic child (`calm`) gets a soothing warm glow rather than a terrifying 90dB siren.

---

## 11. F37: Proactive Device Heartbeat & Battery Telemetry

### Are All Devices Compelled to Send Battery Percentage?
**Yes.** Every single transmission sent by an ESP32 hardware button or Go pendant—including periodic heartbeats, SOS alarms, location updates, and cancel requests—must include the integer `battery` field (0–100%).

### Transmission Frequency & Deep Sleep Lifecycle
Battery-operated buttons spend 99.9% of their life in ESP32 **Deep Sleep** (drawing $<15\mu\text{A}$), allowing years of battery life on a small lithium cell:

```
Deep Sleep (<15 µA)
        │
        ├─► Woken by Button Press ──────► Immediate SOS Transmission
        │
        ├─► Woken by RTC Timer (6h) ────► Sends Heartbeat (battery, seq, RSSI)
        │                                 Server responds with nextHeartbeatMs (6h)
        │                                 Device re-enters Deep Sleep
        │
        └─► Hardware Fuel Gauge < 20% ──► Sends Out-of-Schedule "low_battery" Event
```

1. **Periodic Heartbeat:** Sent every **6 hours** (`6 * 3600 * 1000` ms).
2. **Proactive Low-Battery Alert:** If the internal battery drops below **20%**, the device immediately wakes up and transmits an urgent `low_battery` payload. The Caregiver Portal flags the device in yellow and alerts family members.
3. **Dead Device Detector (24-Hour Silence Rule):**
   If a device misses 4 consecutive heartbeats and remains completely silent for $>24\text{ hours}$, the server automatically flags:
   `"Silent for over 24 hours — please check device battery or Wi-Fi connection"`.
   An alert is dispatched to the caregiver's WhatsApp/SMS with an automatic 24-hour rate-limiting cooldown to avoid spam.

---

## 12. F41: Wi-Fi Scan Positioning & Location Fusion

### The Problem F41 Solves
GPS satellite signals cannot penetrate reinforced concrete ceilings, lift shafts, or underground basements. Furthermore, acquiring a cold GPS fix from satellites can take between 45 and 90 seconds—an eternity when someone is having a heart attack.

### How Wi-Fi Scan Positioning Operates
When the emergency button or pendant is pressed:
1. **150ms Promiscuous Scan:** Before or while turning on the power-hungry GNSS chip, the ESP32 Wi-Fi radio performs an ultra-fast promiscuous scan of surrounding 2.4GHz beacon frames.
2. **Capturing Nearby Access Points:** It records the BSSIDs (hardware MAC addresses) and signal strengths (RSSI) of up to 6 nearby routers:
   ```json
   {
     "wifi": [
       { "bssid": "18:e8:29:43:a1:10", "rssi": -55 },
       { "bssid": "24:a0:74:12:b3:05", "rssi": -72 },
       { "bssid": "00:11:22:33:44:55", "rssi": -85 }
     ]
   }
   ```
3. **Multi-Stage Location Resolution:**
   - **Level 1 — Exact Building/Flat Match (`known_places`):** If any scanned BSSID matches a registered router in the society compound, the location is immediately resolved with sub-15-meter accuracy to the exact flat.
   - **Level 2 — Wi-Fi Trilateration:** If outside the home, the BSSID array is resolved via local triangulation against mapped compound access points, providing indoor positioning without GPS.
4. **The Never-Degrade Rule (`FR-INC-9`):**
   SafeCircle's fusion engine (`packages/shared/src/fusion.ts`) continuously fuses GPS, Wi-Fi, and coarse cell tower fixes using strict confidence hierarchies:
   $$\text{Known Place (Flat)} > \text{Fresh GPS Fix} > \text{Wi-Fi Trilateration} > \text{Cell Tower Zone} > \text{Home Registry}$$
   A fresh, high-accuracy indoor Wi-Fi fix is **never** replaced by a stale or inaccurate satellite fix. Responders always see the most trustworthy location available.

---

*SafeCircle Architecture & Documentation Suite — 2026*
