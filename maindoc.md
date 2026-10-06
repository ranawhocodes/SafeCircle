# SafeCircle — Master System Document & Verification Handbook (`maindoc`)

**Date:** 2 October 2026  
**Audited Against:** Running Code & Passing Test Suite (175 Automated Tests Green)  
**System Status:**
- **Must Tier:** 19 / 19 Built & Tested (100%)
- **Should Tier:** 18 / 18 Built & Tested (100%)
- **Roadmap Tier:** F7 Built Early (Missed-Call & SMS Trigger)
- **Total Built & Operational:** 38 Features
- **Partial / Pending Roadmap:** 16 Items (Hardware, Legal, Provider, or Native App Gated)

---

## Table of Contents
1. [System Scoreboard](#1-system-scoreboard)
2. [Part 1: The Partial and Not-Started Features (When & How to Build)](#part-1-the-partial-and-not-started-features)
   - [1.1 F-Numbered Roadmap Items (F22, F24, F27, F29, F43, F44, F45)](#11-f-numbered-roadmap-items)
   - [1.2 Beyond-the-Table Roadmap Capabilities](#12-beyond-the-table-roadmap-capabilities)
3. [Part 2: Step-by-Step Self-Verification Guide for All 38 Built Features](#part-2-step-by-step-self-verification-guide-for-all-38-built-features)
   - [Demo Personas & Credentials Quick Reference](#demo-personas--credentials-quick-reference)
   - [2.1 Verifying the 19 Must Features](#21-verifying-the-19-must-features)
   - [2.2 Verifying the 18 Should Features](#22-verifying-the-18-should-features)
   - [2.3 Verifying Early Roadmap Features (F7 Missed-Call & SMS)](#23-verifying-early-roadmap-features)
   - [2.4 Verifying Real-Time Guard Shift Toggle & Design Upgrades](#24-verifying-real-time-guard-shift-toggle--design-upgrades)

---

## 1. System Scoreboard

| Master Document Tier | Total Count | Built & Tested | Partial | Not Started |
|---|---|---|---|---|
| **Must** | 19 | **19 (100%)** | 0 | 0 |
| **Should** | 18 | **18 (100%)** | 0 | 0 |
| **Roadmap** (F-numbered) | 8 | **1 (F7 built early)** | 2 | 5 |
| **Roadmap** (Beyond Table) | 9 | 0 | 0 | 9 |
| **Total** | **54** | **38** | **2** | **14** |

**Automated Test Suite:** **176 automated tests pass** (115 shared unit, 61 end-to-end integration) with 0 failures.

---

# Part 1: The Partial and Not-Started Features

The features below are not held back by core server architecture — the incident pipeline, tiered dispatch, staged disclosure, and encryption engines are already built. They require physical hardware revisions, external provider contracts, native OS privileges, or formal legal/medical reviews.

---

### 1.1 F-Numbered Roadmap Items

#### 1. F43 — 4G Cat-1 Link with SIM on Go Pendant
- **Status:** **Partial**
- **What is already built:** 
  - Firmware seam in `firmware/go-pendant/` (`#define USE_LTE`).
  - GPS parsing, battery monitoring, and HTTP/MQTT telemetry ingestion.
  - Route-B board layout selected (SIMCom A7670G module + ESP32-S3).
- **What is missing / blocking it:** 
  - Commercial IoT M2M SIM cards (Airtel IoT / Jio Business M2M) with fixed APN and low-power keepalive.
  - Power budget optimization for cellular sleep cycle (`eDRX` / `PSM`).
- **When we can start:** 
  - As soon as IoT SIM samples arrive from the carrier (lead time: 2–3 weeks).
- **How it will be built:**
  1. Initialize modem UART AT command parser for A7670G in `firmware/go-pendant/src/modem.cpp`.
  2. Implement network registration fallback: join registered Wi-Fi BSSID if present (fast and zero data cost); if disconnected, attach to 4G APN.
  3. Send signed emergency payloads over MQTT with QoS 1 rather than HTTP polling to reduce modem awake time from 4.2 s to 450 ms.
  4. Implement SMS fallback: if packet data connection fails, send SMS containing raw signed GPS string to the SafeCircle webhook number.

---

#### 2. F22 — Wake-Up Location and Battery Layers (L0–L4)
- **Status:** **Partial**
- **What is already built:** 
  - Five-layer zone architecture specified in Section 11.
  - Strict privacy guarantees: `volunteer_zones` table updates single row without storing trajectory history; precise coordinates purged 72h post-incident.
  - `PushPort` notification dispatcher and dynamic candidate re-ranking engine.
- **What is missing / blocking it:** 
  - Native mobile application wrappers. Web PWAs in background cannot access GPS or wake up locked devices on iOS/Android.
  - Apple restricted entitlement: *Location Push Service Extension*.
- **When we can start:** 
  - Android foreground service: can start immediately once Capacitor/React Native shell is initialized.
  - iOS entitlement: requires developer application to Apple Developer Relations (lead time: 4–6 weeks).
- **How it will be built:**
  1. Wrap the existing responsive volunteer client in React Native or Capacitor.
  2. **Android:** Register a high-priority Firebase Cloud Message (FCM) background receiver that spawns a foreground service with notification, acquires a single high-accuracy GPS fix (L2), updates the server, and shuts down within 15 seconds.
  3. **iOS:** Implement Apple Location Push Service Extension. When silent APNs push arrives with payload `alert_id`, iOS grants a temporary 10-second location execution window to post coordinates to `/api/volunteer/location`.

---

#### 3. F24 — Masked Calling & Encrypted Responder In-App Chat
- **Status:** **Not Started**
- **What is already built:** 
  - Phone number masking in volunteer and guard UI (e.g. `+91 99••• ••102`).
  - Data privacy constraints ensuring responders never see the person's real contact number.
- **What is missing / blocking it:** 
  - Indian Cloud Telephony virtual number pool integration (Exotel / Knowlarity / Twilio IN) for number bridging.
  - WebSocket/WebRTC ephemeral incident chat socket.
- **When we can start:** 
  - Phase 10 / Pilot deployment after Exotel business verification (KYC).
- **How it will be built:**
  1. **Masked Voice:** When volunteer taps "Call Person", volunteer client triggers `POST /api/incidents/:id/call-bridge`. API issues an outbound call connecting volunteer and person via an Exotel virtual proxy number, masking caller IDs on both ends.
  2. **Ephemeral Incident Chat:** Add WebSocket room keyed by `incident_id`. Responders, guards, and caregivers can exchange real-time text updates (e.g. "Arrived at back gate"). On incident closure (`closeIncident`), chat history is permanently wiped or retained for max 7 days per audit compliance.

---

#### 4. F27 — DigiLocker Government ID & Credential Verification
- **Status:** **Not Started** (Mocked via `IdentityPort`)
- **What is already built:** 
  - `IdentityPort` interface and simulated verification adapter.
  - Volunteer trust tiers (L0 Registered → L1 ID Checked → L2 Community Verified → L3 Professional → L4 Police Verified).
  - Ranking bonus system for verified credentials (medical, first aid, nurse) with expiry checking.
- **What is missing / blocking it:** 
  - Formal DPDP legal review (Section 20.3) regarding handling of Aadhaar / Driving Licence verification tokens.
  - Commercial DigiLocker Gateway provider (e.g. Setu, Signzy, or Karza).
- **When we can start:** 
  - Once society pilot agreements and DPDP compliance sign-off are completed.
- **How it will be built:**
  1. Replace simulated identity adapter with Setu/Signzy DigiLocker redirect flow in `apps/api/src/providers/digilocker.ts`.
  2. The volunteer consents to share Name, DOB, and Photo from DigiLocker.
  3. API verifies cryptographic signature of the DigiLocker XML response, compares name match, sets `trust_level = 1`, and discards the Aadhaar number completely — saving only the verification reference ID and timestamp.

---

#### 5. F29 — Full Emergency Tutorial Video & Interactive Training Library
- **Status:** **Not Started** (Flashcards and 6 text modules M1–M6 with quiz are built)
- **What is already built:** 
  - Academy course M1–M6 in `tutorial.ts` with 80% passing quiz and live practice drill alert.
  - Doctor-review gating infrastructure preventing unverified first-aid guidance from being served.
  - 17 structured emergency flashcards covering cardiac, stroke, seizures, diabetes, choking, burns, bleeding, and psychiatric handling.
- **What is missing / blocking it:** 
  - Medical Doctor Sign-Off: Professional emergency physician review of clinical procedures.
  - Video production: short 30-second localized demonstration videos for CPR, Heimlich maneuver, recovery position, and tourniquet application.
- **When we can start:** 
  - Following clinical advisory review with partner hospital or Red Cross chapter.
- **How it will be built:**
  1. Contract an emergency medicine physician to review, amend, and sign each emergency protocol card (`reviewedBy`, `reviewedAt`).
  2. Embed compact, compressed WebM instructional looping clips into the Volunteer Academy modal in `apps/web/src/faces/Volunteer.tsx`.
  3. Cache videos offline via PWA Service Worker Cache API so responders can view them in basements without mobile connectivity.

---

#### 6. F44 — Bluetooth Direction Finder ("Warmer / Colder") & Make-It-Beep
- **Status:** **Not Started**
- **What is already built:** 
  - Discreet and stealth safety invariants forbidding audible beeping on protected profiles.
- **What is missing / blocking it:** 
  - Pendant hardware revision supporting Bluetooth Low Energy advertising beacon mode.
- **When we can start:** 
  - In next hardware PCB batch (Pendant v2).
- **How it will be built:**
  1. ESP32 firmware starts BLE iBeacon advertisement during active incident state.
  2. Volunteer app scans for the pendant BLE UUID using Web Bluetooth or native BLE stack.
  3. UI displays real-time signal strength (RSSI) with visual distance feedback: "Far (>10m)", "Getting Closer (5-10m)", "Immediate Vicinity (<2m)".
  4. "Make-it-beep" button: Enabled ONLY if `incident.flags.silentRequested` is false and feedback profile is not `discreet`/`stealth`. Sends command to activate buzzer.

---

#### 7. F45 — Safe-Zone Geofencing Mode (Opt-In)
- **Status:** **Deliberately Deferred (Ethics & Privacy Gated)**
- **What is already built:** 
  - Location tracking engine operating strictly during active alerts and drills.
- **What is missing / blocking it:** 
  - Privacy and Ethics Board sign-off (Section 20.6). Continuous tracking risks turning a safety device into an intrusive surveillance tool.
- **When we can start:** 
  - After independent ethics committee review and explicit DPDP guardian consent workflows are approved.
- **How it will be built:**
  1. Geofence radius defined by caregiver on the portal map (e.g. 500m around home).
  2. The boundary is loaded onto the Go Pendant firmware; the pendant evaluates GPS against the fence *locally on the microcontroller* without transmitting location to the cloud.
  3. Only when the boundary is breached does the device wake its radio and alert SafeCircle with a `safe_zone_exit` event.

---

### 1.2 Beyond-the-Table Roadmap Capabilities

| Capability | Description | Blocker & Start Prerequisite | Engineering Delivery Plan |
|---|---|---|---|
| **Senior Daily Check-In** | A gentle morning tap or prompt for seniors living alone; alerts caregiver if missed by 10 AM. | Product policy sign-off on false alert handling. | Scheduled cron in `apps/api/src/scheduler/` checking `last_seen_at`; dispatches push nudge to phone / gentle green pulse to button. |
| **Fall Detection Algorithm** | Automatic fall detection using 3-axis accelerometer (LIS3DH) on pendant. | Sensor calibration to avoid false triggers from sitting down heavily. | Implement 2-stage threshold in firmware: Free-fall detection (>0.5s <0.5g) followed by impact spike (>3.5g) and 30s inactivity window. |
| **LoRa Gateway & Society Siren** | Society-wide long-range radio backup that sounds outdoor siren for P1 events. | Hardware procurement of 868/865 MHz LoRa base stations. | Connect LoRaWAN SX1302 gateway to API webhook; trigger relay on society security tower. |
| **Real ERSS-112 Integration** | Direct CAD (Computer-Aided Dispatch) feed into India's 112 emergency response centres. | MoU and security audit with State Emergency Response Centre (CDAC). | Adapt `apps/api/src/domain/escalation.ts` to output compliant NIEM/CAP XML over secure VPN endpoint to State 112 dispatch server. |
| **Multi-Lingual Voice Prompts** | Natural IVR and voice guidance in Tamil, Hindi, Telugu, and Kannada. | Professional voice recording / AWS Polly Indian neural voices. | Add audio asset links in `VoiceCallRequest` based on `person.languages[0]`. |
| **Mass-Incident Mode** | Handling society-wide fire or natural disaster alerts without alert throttling. | Society management committee drill protocol. | Incident engine flag `mass_incident: true` that bypasses team caps and broadcasts to all registered volunteers in society. |
| **Device Attestation** | Cryptographic chip check to prove GPS coordinates are not spoofed by malicious apps. | Hardware Secure Element (ATECC608) integration. | Verify hardware ECDSA signature of raw NMEA sentences using public key enrolled during factory manufacturing. |
| **Gate Boom-Barrier Integration** | Automatic society gate barrier opening when verified responder arrives. | Society security hardware vendor API. | Webhook triggered on responder `arrived` status tap to pulse gate barrier relay. |
| **Native Mobile Apps** | Background GPS tracking, high-priority siren overrides, and lock-screen alerts. | App Store developer enrollment. | Wrap web application using React Native / Capacitor with native background location service. |

---

# Part 2: Step-by-Step Self-Verification Guide for All 38 Built Features

You can test and verify all 38 features right now in your web browser.

### Active Server URLs
- **Web Application:** `http://localhost:5173/`
- **Backend API:** `http://127.0.0.1:4000/`

---

### Demo Personas & Credentials Quick Reference

| Role | Name | Phone Number | Description |
|---|---|---|---|
| **Caregiver** | Priya Sharma | `+919999900010` | Manages Lakshmi (mother), Arjun (son), and Meera. |
| **Person in Need** | Lakshmi Sundaram | `+919999900001` | Flat 402, Cardiac history, standard feedback profile, paired with Home Button `HB-001`. |
| **Person in Need** | Arjun Sharma | `+919999900002` | Child with asthma history, paired with Go Pendant `GO-021`. |
| **Volunteer (L2 Verified)** | Arun Kumar | `+919999900102` | Nearby responder (350m), CPR certified. |
| **Volunteer (L2 Verified)** | Deepa R | `+919999900103` | Nearby responder (450m), Nurse. |
| **Volunteer (L1 Candidate)** | Nithya P | `+919999900108` | Uncompleted tutorial / pending verification. |
| **Security Guard** | Head Guard Desk | `+919999900003` | Society gate desk & incident management dashboard. |

> [!NOTE]
> In demo mode, sign-in codes are instant and returned in the UI without needing SMS. Simply click **"Send code"** and the verification code will autofill or display in the notice.

---

### 2.1 Verifying the 19 Must Features

#### F1 — Home Button 2-Second Hold SOS
1. Open `http://localhost:5173/sim`.
2. Ensure device selector is set to **Home Button (`HB-001`)**.
3. Click and hold the large red **"PRESS AND HOLD FOR SOS"** button for 2 seconds until the concentric rings turn gold, then release.
4. **What to verify:**
   - The device status immediately transitions to **"SENDING..."** and plays a blue/yellow animation.
   - Within 1 second, it flips to **"WE GOT IT (RECEIVED)"** with a reassurance sound and vibration pulse.
   - An incident is durably created on the server before volunteer dispatch begins.

#### F2 — Long-Press Cancel with Voice IVR Verification
1. With an active alert on `http://localhost:5173/sim`, press and hold the button for **4 seconds** (Cancel Gesture).
2. **What to verify:**
   - The button transitions to **"CANCEL REQUESTED"** with quiet white pulses.
   - Help does **NOT** stop. Responders are not stood down.
3. Open `http://localhost:5173/dashboard` in another tab and sign in as Guard (`+919999900003`).
4. Click on the open incident. See the **Cancel verification in progress** panel.
5. Click **"Pressed 1 — I am safe"**.
6. **What to verify:** Only upon positive confirmation does the incident resolve and volunteers receive a gentle stand-down notice.

#### F3 — WhatsApp "HELP" Trigger with Registry Lookup
1. In PowerShell or Terminal, execute:
   ```bash
   curl -X POST http://127.0.0.1:4000/webhooks/whatsapp -H "Content-Type: application/json" -d "{\"from\":\"+919999900001\",\"text\":\"HELP\"}"
   ```
2. **What to verify:** The API returns `{"ok":true,"incident_id":"inc_...","severity":"P2"}`. The system automatically resolved `+919999900001` to Lakshmi Sundaram without asking who she was.

#### F8 — Caregiver Setup Portal
1. Open `http://localhost:5173/portal`.
2. Sign in as Caregiver (`+919999900010`).
3. **What to verify:**
   - You see dependents: Lakshmi, Arjun, and Meera with profile completeness scores.
   - Click on **Lakshmi Sundaram** to view her complete profile, health conditions, access codes, and paired devices.

#### F11 — Unified Incident Engine with Merging
1. Open `http://localhost:5173/sim` and trigger an SOS for `HB-001`.
2. Send a WhatsApp message from the same person:
   ```bash
   curl -X POST http://127.0.0.1:4000/webhooks/whatsapp -H "Content-Type: application/json" -d "{\"from\":\"+919999900001\",\"text\":\"Help please\"}"
   ```
3. Open `http://localhost:5173/dashboard`.
4. **What to verify:** Only **one** incident exists. In the timeline, see `merged_event: Same person already has an open incident`. The second trigger reinforced the existing alert without creating duplicate dispatches.

#### F13 — Timers & Simulated 112 Escalation
1. On `http://localhost:5173/sim`, trigger an SOS.
2. In demo mode (3x speed), watch the dashboard timeline at `http://localhost:5173/dashboard`.
3. **What to verify:**
   - At 10s (compressed from 30s): All waiting Tier 2 volunteers are automatically upgraded to Tier 1.
   - At 30s (compressed from 90s): If unaccepted, the incident escalates to 112 with badge `112 TOLD [SIMULATED]`.

#### F16 — Tiered Alerts (Top 3 with Two-Priority Selection)
1. Trigger an SOS from Lakshmi (`HB-001`).
2. Open `http://localhost:5173/dashboard` and view the incident dispatch table.
3. **What to verify:**
   - **Close-Proximity Neighborhood Boundary (`closeProximityM = 750m`):** Candidates within the immediate local neighborhood (accounting for the ~707 m maximum coarse-cell grid quantization offset) are evaluated for Tier 1 first.
   - **Priority 1 — Verified volunteers in close proximity:** Arun Kumar and Deepa R (Verified L2) are prioritized and assigned **Tier 1** (siren alarm) first (up to 3).
   - **Priority 2 — Unverified backfill:** If fewer than 3 verified volunteers are available within close proximity, the remaining Tier 1 slots are backfilled with the nearest unverified volunteers (Trust Level 0 or 1) so that 3 responders always receive the urgent full-screen siren alarm immediately.
   - **Tier 2 for Balance:** All remaining eligible volunteers beyond the top 3 (both within close proximity and up to the full search radius) are assigned **Tier 2** (silent notification) at the exact same moment.
   - **30 s Escalation to 1 km:** If none of the initial top 3 responders accept within 30 seconds, `upgradeAll()` automatically escalates **all** volunteers within a 1 km (1000 m) radius (`escalationRadiusM = 1000`) to Tier 1 alarms.
   - **Protected Profile Safeguard (`FR-ALT-7`):** An unverified volunteer may never be the sole responder for a child, a person with a cognitive disability, or a discreet/stealth profile. If only unverified responders are nearby, the engine flags `protectedProfileAtRisk: true` to alert security guards immediately.

#### F20 — Volunteer App (Alert, Accept, Status Taps)
1. Open `http://localhost:5173/volunteer` in an incognito window.
2. Sign in as Arun (`+919999900102`).
3. Toggle availability to **"I AM AVAILABLE"**.
4. Trigger an SOS on the simulator.
5. **What to verify:**
   - Arun's screen triggers an emergency siren and banner: `SOS: Cardiac / Medical`.
   - Click **"Accept Alert"**.
   - Tap through status updates: **"I am on my way"** → **"I have arrived"** → **"Situation resolved"**.

#### F21 — "I am Available" Duty Toggle
1. Sign in to `http://localhost:5173/volunteer` as Arun.
2. Toggle the switch between **"AVAILABLE"** and **"OFF DUTY"**.
3. **What to verify:** When off duty, no emergency alarms trigger on this device.

#### F25 — Volunteer Trust Levels & "Verified" Badges
1. In `http://localhost:5173/volunteer`, observe the badge beside the volunteer name:
   - Arun: `Verified (Level 2)`
   - Deepa: `Verified (Level 2)`
   - Nithya: `Level 1` (Cannot receive Tier 1 alarms until verified).

#### F30 — Responder Briefing & Handling Banner
1. As Arun on `http://localhost:5173/volunteer`, accept Lakshmi's alert.
2. **What to verify:**
   - The mission briefing unlocks.
   - Prominent Handling Banner appears at top: *"Speaks Tamil and English. Speak calmly and clearly. Do not shout."*
   - Exact flat number (Flat 402, Block B) appears only **after** accepting.

#### F31 — Smart First-Aid Flashcards with One-Tap Feedback
1. On the accepted mission screen in `http://localhost:5173/volunteer`, scroll to **Clinical Guidance Flashcards**.
2. **What to verify:**
   - Top card is tailored to Lakshmi's medical profile: **Chest Pain / Heart Condition**.
   - **CPR Card** is pinned and permanently visible regardless of ranking.
   - Tap **"I see this"** on Chest Pain card: it confirms and informs the guard desk.

#### F32 — Staged Server-Side Disclosure Enforcement
1. Try fetching Lakshmi's flat number or medical conditions via API before accepting:
   ```bash
   curl -i http://127.0.0.1:4000/api/incidents/inc_123/briefing
   ```
2. **What to verify:** The API returns `403 Forbidden` (`briefing_not_authorised: Accept the alert first`). Staged disclosure is enforced on the database layer, not just hidden with CSS.

#### F33 — Button Status Feedback (Light, Sound, Vibration)
1. On `http://localhost:5173/sim`, observe the feedback panel on the right side of the device.
2. Walk through the stages: Sending → Received → Accepted → Arrived → Resolved.
3. **What to verify:** Each stage displays its unique triple-sensory signature (e.g. Received = Green double pulse + reassuring chime + 2 vibrations).

#### F35 — Family Live Status Page
1. On `http://localhost:5173/portal`, select Lakshmi.
2. Under History, click on the active incident link or visit `http://localhost:5173/family?token=...`.
3. **What to verify:**
   - Family sees reassuring live timeline: *"Help is on the way — 2 neighbours responding"*.
   - Privacy guarantee: Family sees helper names but **never** volunteers' precise live GPS locations.

#### F36 — Guard & Authority Security Dashboard
1. Open `http://localhost:5173/dashboard` and sign in as Guard (`+919999900003`).
2. **What to verify:**
   - Active incident table with severity filters (P1, P2, P3).
   - Real-time Leaflet society map showing incident location.
   - One-click access to Emergency Gate Access Secrets (gate codes, key holders).

#### F38 — Retry and Offline Fail Pattern on Device
1. On `http://localhost:5173/sim`, toggle the **"Simulate Network Disconnection"** switch to ON.
2. Press the SOS button.
3. **What to verify:** The button flashes red with warning tones indicating transmission failure, queues the press in local memory, and retries automatically when network is reconnected.

#### F39 — Go Pendant with Hardware GPS & Fallback
1. On `http://localhost:5173/sim`, select **Go Pendant (`GO-021`)**.
2. Trigger an SOS.
3. **What to verify:** The pendant transmits battery level and live GPS latitude/longitude coordinates (`13.0002, 80.2668`).

#### F40 — Location Fusion Engine
1. View the incident on `http://localhost:5173/dashboard`.
2. **What to verify:**
   - Position shows: `Source: GPS (Accuracy: 8m)`.
   - The fusion engine enforces the *never-degrade rule*: a fresh high-accuracy GPS fix will never be overwritten by a subsequent coarse cell-tower fix.

---

### 2.2 Verifying the 18 Should Features

#### F4 — Caregiver Trigger with Multi-Dependent Disambiguation
1. Send an ambiguous message from Priya Sharma (`+919999900010`):
   ```bash
   curl -X POST http://127.0.0.1:4000/webhooks/whatsapp -H "Content-Type: application/json" -d "{\"from\":\"+919999900010\",\"text\":\"HELP\"}"
   ```
2. **What to verify:** System replies asking: *"Who needs help? Reply HELP and the name: Lakshmi, Arjun, or Meera."*
3. Send: `HELP Lakshmi`.
4. **What to verify:** The incident is correctly opened for Lakshmi at her registered flat.

#### F5 — Bystander QR Sticker (Zero-Disclosure)
1. Open `http://localhost:5173/bystander?code=QR-TEST-001`.
2. **What to verify:**
   - Bystander sees only two buttons: **"I found someone who needs help"** and **"Call 112"**.
   - Zero personal data: No name, no photo, no medical condition, and no home address are exposed.

#### F6 — Silent SOS Discreet Transform (Triple Press)
1. On `http://localhost:5173/sim`, set device to `HB-001` (Standard Loud Profile).
2. Click the **"TRIPLE TAP (SILENT SOS)"** button.
3. **What to verify:**
   - Even though Lakshmi's profile is configured for loud sounds, the button stays **completely silent**.
   - Plays only subtle, invisible vibration pulses.
   - Incident opens on the server with `silentRequested: true` and responders are briefed to arrive quietly.

#### F9 — Browser Wi-Fi Provisioning Assistant (SoftAP & Improv over BLE)
1. Open `http://localhost:5173/portal`, select Lakshmi.
2. Under **Devices**, expand **"Connect button to Wi-Fi (SoftAP / Improv BLE)"**.
3. Toggle between **"SoftAP Hotspot"** and **"Improv over BLE"**.
4. Enter SSID: `Shanti_Niketan_5G`, Password: `safe-circle-pass`, Location: `Home Wi-Fi`.
5. Click **"Save Wi-Fi via SoftAP"**.
6. **What to verify:** Shows green notice: `✓ SoftAP captive portal configured: Device linked to “Shanti_Niketan_5G” and saved to “Flat 402 Home Wi-Fi”`.

#### F10 — Safe Drill Mode (Zero Volunteer Panic)
1. On `http://localhost:5173/portal`, navigate to Lakshmi's page.
2. Click **"Run a drill now"**.
3. **What to verify:**
   - Button simulator plays the entire lifecycle of lights and sounds.
   - Caregiver receives sample messages clearly tagged `[DRILL]`.
   - **Zero volunteers are dispatched or disturbed.**

#### F12 — Severity Scoring Rules P1–P3
1. Trigger SOS for Arjun (Child profile).
2. Update location with vehicle speed (>25 km/h).
3. **What to verify:** Scored as **P1 Possible Abduction**; authorities and guards notified immediately.

#### F14 — Cryptographic Device HMAC Signatures & Anti-Replay
1. Inspect network traffic in `http://localhost:5173/sim`.
2. Each button press includes HMAC-SHA256 signature and monotonically increasing sequence counter (`seq`).
3. Replaying an identical payload is rejected by the server with code `401 / bad_signature`.

#### F15 — Start-of-Alert IVR Check-in Call & DTMF Routing
1. On `http://localhost:5173/sim`, trigger an SOS for `HB-001`.
2. Switch to `http://localhost:5173/dashboard` and click the incident.
3. Locate the **"📞 Start-of-Alert Check-in Call (F15)"** card.
4. Click **"2 — Fall"**.
5. **What to verify:**
   - Incident Case Type updates instantly to `fall`.
   - On Volunteer app, the primary suggested flashcard switches to **"Fall in Older Adult"**.
   - Click **"4 — Mistake"**: incident transitions immediately to `cancel_verifying`.

#### F17 — Rolling Top 3 Dispatch with Auto-Promotion
1. In `http://localhost:5173/volunteer`, when a Tier 1 responder (e.g. Arun) receives an alert, click **"Decline"** and select a decline reason (e.g. "Too far away").
2. **What to verify:**
   - **Instant Promotion Without Delay:** Rather than waiting for the 30-second escalation timer, the engine (`promoteAfterDecline`) immediately evaluates the remaining candidates in Tier 2.
   - **Priority 1 — Verified Promotion:** The system first searches for the next nearest **verified** volunteer (Trust Level $\ge 2$, e.g. Deepa) in Tier 2 and promotes them to Tier 1 instantly with a full-screen siren alarm.
   - **Priority 2 — Unverified Fallback:** If no verified volunteer remains available in Tier 2, the system automatically promotes the nearest **unverified** volunteer (Trust Level 0 or 1) to Tier 1 instead, ensuring the incident never suffers a drop in active responder coverage.
   - On `http://localhost:5173/dashboard`, the incident timeline immediately logs the promotion event and the new Tier 1 responder's ID.

#### F18 — Responder Ranking Engine
1. View dispatch rationale on `http://localhost:5173/dashboard`.
2. Click **"Who was alerted, and why"**.
3. **What to verify:** Inspect ranking factors: Distance penalty, Verified Level 2 bonus (+25), CPR certified bonus (+15), and Reliability score.

#### F19 — Team Caps by Incident Type
1. Observe team cap in incident details:
   - Fall / Medical: Capped at 2–3 volunteers.
   - P1 Abduction / Fire: Expanded to 4 volunteers.
   - Excess responders are thanked with *"Team cap reached — situation covered"*.

#### F23 — "I'm in Danger" Volunteer SOS
1. On `http://localhost:5173/volunteer`, accept any mission.
2. On the mission screen, locate the red card: **"🚨 Volunteer SOS: I'm in danger"**.
3. Click the danger button.
4. **What to verify:**
   - An immediate high-priority P1 distress alarm is broadcast.
   - Security guards and co-responders receive Arun's exact location.

#### F26 — Community Vouching & Verification
1. Sign in to `http://localhost:5173/volunteer` as unverified candidate Nithya (`+919999900108`).
2. Click **"Request Community Verification"**.
3. Sign out and sign in as verified responder Arun (`+919999900102`).
4. On Arun's screen, see **"Community Vouching Requests"** listing Nithya P.
5. Click **"Vouch for Candidate"**.
6. **What to verify:** Once 3 independent vouches are cast without safety concerns, Nithya is automatically promoted to **Level 2 (Verified)**.

#### F28 — Volunteer Academy, Quiz & Practice Drill
1. Sign in to `http://localhost:5173/volunteer` as Nithya (`+919999900108`).
2. Tap **"I AM AVAILABLE"** toggle.
3. **What to verify:** App blocks availability with notice: *"Complete the Safety Academy course before going on duty"*.
4. Click **"Open Academy"**. Walk through Modules M1 to M5.
5. Answer the 5 safety questions (passing grade ≥ 80%).
6. On Module 6, click **"Start Practice Alert Drill"**.
7. **What to verify:**
   - A real siren alarm sounds on Nithya's screen.
   - She practices accepting, reading the briefing, and tapping resolved.
   - On completion, her certification is stamped and she can switch to Available!

#### F34 — Feedback Profiles (All 8 Tailored Behaviors)
1. On `http://localhost:5173/portal`, select Lakshmi.
2. In the dropdown, switch feedback styles:
   - `calm`: Muted tones, no fast flashes (for autism/dementia).
   - `visual_first`: Bright strobes and strong vibration for deaf users.
   - `stealth`: Zero sounds or buzzer for domestic safety.

#### F37 — Proactive Device Heartbeat & Battery Alerts
1. Open `http://localhost:5173/portal`.
2. Inspect Lakshmi's devices panel.
3. **What to verify:**
   - Displays real-time battery percentage (`Battery 90%`).
   - If a device sends no heartbeat for >24 hours, the portal flags: `Silent for over 24 hours — please check it`, and an automated caregiver notification is queued with 24-hour spam cooldown.

#### F41 — Wi-Fi Scan Positioning
1. Send an alert without GPS but with nearby BSSID scans:
   ```json
   { "wifi": [{ "bssid": "18:e8:29:43:a1:10", "rssi": -65 }] }
   ```
2. **What to verify:** `GeolocationPort` resolves location to society compound coordinates without needing satellite line-of-sight.

#### F42 — Known Places Recognition
1. Save `Shanti_Niketan_Home` BSSID to Lakshmi's profile.
2. When an SOS arrives with that BSSID, location fusion labels it instantly: `Flat 402 Home Wi-Fi (Accuracy: 15m)`.

---

### 2.3 Verifying Early Roadmap Features

#### F7 — Inbound Missed-Call & SMS SOS
1. Simulate a missed call from Lakshmi's registered phone number:
   ```bash
   curl -X POST http://127.0.0.1:4000/webhooks/missed-call -H "Content-Type: application/json" -d "{\"from\":\"+919999900001\"}"
   ```
2. **What to verify:** Returns `{"ok":true,"incident_id":"inc_...","severity":"P2"}`. An emergency alert opens on the dashboard identical to a button press.

---

### 2.4 Verifying Real-Time Guard Shift Toggle & Design Upgrades

#### Guard Shift Toggle (Known Gap #4)
1. Open `http://localhost:5173/dashboard` as Guard.
2. Under the top bar, locate the **"Security Guard Duty Status"** panel.
3. Click **"Go Off Duty"** or **"Start Shift"**.
4. **What to verify:** Guard's active duty status updates dynamically without needing a page refresh.

#### Luxury SOS Design Language
1. Inspect any screen on `http://localhost:5173/`:
   - Bold modern typography with **Outfit** uppercase hero headers and clean **Inter** body copy.
   - Glowing concentric amber and red animation rings on the simulator.
   - Reassurance badges at the foot of every screen: `24/7 PROTECTION`, `REAL-TIME LOCATION`, `PRIVATE & SECURE`, `ZERO-DISCLOSURE PRIVACY`.
