# SafeCircle — Software Requirements Specification (SRS)

Derived from **SafeCircle Super Master Document (v2.2)**, 1 Oct 2026.
Source of truth for scope: `docs/SafeCircle-Super-Master-Document-v2.pdf` (archived with this repo).

Status: **Iteration 1 — all 19 `Must` features.** `Should` / `Roadmap` features are specified
at a lower level of detail here and scheduled in `06-backlog-and-phases.md`.

---

## 1. Purpose and problem

SafeCircle is a neighbourhood safety network that works **even when the person in trouble cannot
use a smartphone**. It is the "first five minutes" layer that extends 112 (India ERSS), never a
replacement for it.

The problem statement's hidden requirement: *"relying exclusively on app-based reporting excludes
these groups"*. Therefore **at least one non-app, low-effort trigger is mandatory** and is treated
as a hard architectural constraint, not a feature.

### Success criteria (traced throughout)

| ID | Criterion |
|----|-----------|
| C1 | Faster initiation of help |
| C2 | Unified reporting and dispatch to authorities |
| C3 | Coordinating nearby volunteers |
| C4 | Clear status updates to those affected |
| C5 | Accessible to children, seniors and people with disabilities **without depending on an app** |

### Two faces, one backend

* **Face A** — the person and their family. Home button (Wi-Fi), Go pendant (GPS + 4G),
  WhatsApp/SMS, bystander QR, setup web portal, family status page. **No app, ever.**
* **Face B** — the responders. Native volunteer app (PWA in iteration 1), guard role, dashboard.

Face A only *sends alarms* and *receives status*. Every routing decision is made in the backend.

---

## 2. Actors

| Actor | Role | May see |
|-------|------|---------|
| The person | Presses the button / sends "HELP" | Light, sound, vibration on device; WhatsApp replies |
| Caregiver / family | Sets up profile; can trigger, confirm, follow | Live status page; verification messages |
| Verified volunteer (L2+) | Tier 1 responder; votes on new members | Category + distance first; full briefing **after** accepting |
| Unverified volunteer (L0/L1) | Tier 2 responder, limited | Same, but never sole responder for protected profiles |
| Society guard | On-site responder, opens gates, in-person checks | Full address and access notes immediately |
| Society verifier / RWA admin | Approves local volunteers | Volunteer cards for approval; monthly report |
| Authority (112 / police) | Takes over when needed | Dashboard and handoff packet |
| SafeCircle admin | Reviews concerns, misconduct | Audit logs and reports |

---

## 3. Functional requirements

Requirement IDs are `FR-<area>-<n>`. Each maps to the master document's feature IDs (`F1`–`F45`)
and to criteria `C1`–`C5`. **MoSCoW** column is iteration-1 commitment.

### 3.1 Triggers (Face A)

| ID | Requirement | Feature | Criteria | MoSCoW |
|----|-------------|---------|----------|--------|
| FR-TRG-1 | A Home button (Wi-Fi) raises an SOS on a ~2 s hold. A press under 2 s is ignored. | F1 | C1 C5 | Must |
| FR-TRG-2 | A Go pendant raises an SOS identically and attaches a location object (GPS fix, Wi-Fi scan list, serving cell, known place). | F39 | C1 C5 | Must |
| FR-TRG-3 | The device sends immediately with whatever location it has; it never waits for a GPS fix. | F39 F40 | C1 | Must |
| FR-TRG-4 | A ~4 s hold requests cancel and moves the incident to `cancel_verifying` — it never closes it. | F2 | C1 | Must |
| FR-TRG-5 | A message (default keyword `HELP`, or any text) from a registered number raises an SOS for the person that number maps to. | F3 | C1 C5 | Must |
| FR-TRG-6 | A message from an unregistered number creates an `unverified` incident routed to the guard desk and dashboard only — never to volunteers automatically. | F3 | C1 | Must |
| FR-TRG-7 | A caregiver number registered against dependents can raise an alarm for a named dependent; the incident is located at the **dependent's** address, flagged `raised_by_caregiver`. | F4 | C1 C5 | Should |
| FR-TRG-8 | A bystander QR on the pendant opens a page with **no personal data** that lets a stranger alert the family and share their own location. | F5 | C1 C5 | Should |
| FR-TRG-9 | A triple short press on a discreet/stealth profile raises a silent SOS: no sound, no light (discreet) and no call to the person. | F6 | C1 C5 | Should |
| FR-TRG-10 | Device events are rejected unless the HMAC signature verifies and the sequence number is strictly increasing. | F14 | C2 | Should |
| FR-TRG-11 | SMS keyword and missed-call triggers. | F7 | C1 C5 | Roadmap |

### 3.2 Setup and onboarding (Face A)

| ID | Requirement | Feature | Criteria | MoSCoW |
|----|-------------|---------|----------|--------|
| FR-SET-1 | A caregiver signs in with a phone number and one-time code. | F8 | C5 | Must |
| FR-SET-2 | A caregiver can create and edit a person profile with the Section 5.2 field groups. One caregiver ↔ many people, one person ↔ many caregivers. | F8 | C2 C5 | Must |
| FR-SET-3 | A device is claimed by `device_id` + single-use `claim_code`; a claimed device cannot be re-claimed. | F8 | C2 | Must |
| FR-SET-4 | Trigger numbers (`self`, `caregiver`) are added with a role, a confirm step, a `can_cancel` flag and a `never_inform` flag. | F8 | C2 | Must |
| FR-SET-5 | Family contacts are ordered; order drives the escalation chain. | F8 | C4 | Must |
| FR-SET-6 | A feedback profile is selected per person: `standard`, `loud`, `calm`, `child`, `visual_first`, `touch_and_sound`, `discreet`, `stealth`. | F34 | C4 C5 | Must |
| FR-SET-7 | Consent is recorded with subject, who consented, capacity basis (self / parent / lawful guardian), scope and timestamp. | F8 | C5 | Must |
| FR-SET-8 | A drill press runs the whole chain flagged `drill`: every device pattern plays, the caregiver gets sample messages, **no volunteer is alerted**. | F10 | C4 | Should |
| FR-SET-9 | Printable kit: fridge QR (prefilled WhatsApp HELP), wallet card, bystander QR sticker. | F8 | C5 | Should |
| FR-SET-10 | Browser Wi-Fi provisioning (SoftAP captive portal / Improv over BLE). | F9 | C5 | Should |
| FR-SET-11 | Known places: named saved Wi-Fi networks that resolve to a building. | F42 | C2 | Should |

### 3.3 Incident engine

| ID | Requirement | Feature | Criteria | MoSCoW |
|----|-------------|---------|----------|--------|
| FR-INC-1 | Every channel normalises to one event shape and runs one pipeline: receive → verify → normalise → identify → locate → merge → score → dispatch → track. | F11 | C2 | Must |
| FR-INC-2 | A new event for a person with an open incident inside 10 minutes **joins** that incident instead of creating a new one. | F11 | C2 | Must |
| FR-INC-3 | Severity is scored by deterministic rules into `P1`, `P2` (default for a press), `P3`, `unverified`. AI triage may only *suggest*. | F12 | C2 | Must (rules) |
| FR-INC-4 | The state machine is `new → dispatching → accepted → en_route → on_scene → resolved`, with `cancel_verifying` and the `escalated` **flag** (a flag, not a terminal state). | F11 | C2 | Must |
| FR-INC-5 | An incident is **never auto-closed** while unresolved; a stale one is flagged on the dashboard. | F11 | C2 | Must |
| FR-INC-6 | Timers (P2 default, all tunable): 0 s tiered alert; 30 s upgrade-all; 60 s family voice call; 90 s escalate to 112; accept+3 min "still coming?"; on-scene+30 min check-in. | F13 | C2 | Must |
| FR-INC-7 | A global demo time-scale compresses every timer for stage use, and every surface labels it "demo speed". | F13 | C4 | Must |
| FR-INC-8 | P1 alerts all volunteers at high priority and notifies 112 **at once** (simulated). | F12 F13 | C2 | Must |
| FR-INC-9 | Location is fused from sources ranked `gps > wifi > cell > known_place > registry`; a newer fix replaces the current one **only if it is more accurate**, so the displayed position never degrades. | F40 F41 | C2 C3 | Must |
| FR-INC-10 | Every consumer sees the location **source** and an **accuracy radius**; uncertainty is never hidden. | F40 | C2 C4 | Must |
| FR-INC-11 | While an incident is open the device may post location updates; movement > ~200 m re-ranks candidates and alerts the new nearest volunteers. | F40 | C3 | Must |
| FR-INC-12 | An optional check-in IVR at alert start ("1 medical, 2 fall, 3 danger, 4 mistake") never delays dispatch and seeds the flashcards. | F15 | C1 C4 | Roadmap |

### 3.4 Cancel and verification

| ID | Requirement | Feature | Criteria | MoSCoW |
|----|-------------|---------|----------|--------|
| FR-CAN-1 | A cancel request places a verification call to the person's registered phone within ~5 s. | F2 | C1 | Must (simulated) |
| FR-CAN-2 | `pressed 1` (+ correct safe PIN if set) closes the incident as `false_alarm` and stands everyone down. | F2 | C1 | Must |
| FR-CAN-3 | `pressed 9`, a wrong PIN, or the duress PIN keeps the alert alive at high priority flagged `possible_duress`, while the device keeps showing the cancelled pattern. | F2 | C1 | Must |
| FR-CAN-4 | No answer / busy / rejected retries once after ~10 s; still nothing means the alert is **real** and resumes with all volunteers at high priority. | F2 | C1 | Must |
| FR-CAN-5 | While verifying: already-accepted responders continue, no new volunteers are added, the guard still performs the in-person check, and a pendant keeps sending location silently. | F2 | C3 | Must |
| FR-CAN-6 | Profiles that cannot take a call route verification elsewhere: child → parent + doorstep check; deaf → message + device double-press confirm; cognitive → caregiver **plus** guard check; discreet/stealth → **no call to the person at all**. | F2 F34 | C5 | Must |
| FR-CAN-7 | A caregiver "safe" confirmation does **not** stand down the guard's in-person check for high-risk profiles. | F2 | C5 | Must |

### 3.5 Device feedback (Face A status loop)

| ID | Requirement | Feature | Criteria | MoSCoW |
|----|-------------|---------|----------|--------|
| FR-FDB-1 | Every stage is expressed in **three senses at once** — light, sound, vibration — so no single sense is required: `holding, sending, received, accepted, arriving, arrived, escalated, still_working, cancel_verifying, failed, low_battery`. | F33 | C4 C5 | Must |
| FR-FDB-2 | The device learns its stage by polling `GET /api/device/:id/status` (demo) or MQTT push (pilot). | F33 | C4 | Must |
| FR-FDB-3 | Each status carries a sequence number; a late or duplicate message must never move the device backwards. | F33 | C4 | Must |
| FR-FDB-4 | Feedback profiles transform the pattern table: `loud`, `calm`, `child`, `visual_first`, `touch_and_sound`, `discreet` (vibration only), `stealth` (**light only**, low brightness, no buzzer, no vibration, no calls). | F34 | C4 C5 | Must |
| FR-FDB-5 | Send failure after retries shows the `failed` pattern and the device keeps retrying with back-off. | F38 | C1 | Must |
| FR-FDB-6 | Heartbeat every ~6 h; a missed heartbeat or low battery messages the caregiver. | F37 | C2 | Should |

### 3.6 Tiered geofenced alerting

| ID | Requirement | Feature | Criteria | MoSCoW |
|----|-------------|---------|----------|--------|
| FR-ALT-1 | At second 0: the 3 nearest **verified** available volunteers get a high-priority Tier 1 alarm; every other available volunteer in radius gets a normal Tier 2 alert; guard and family are alerted in the same moment. | F16 | C3 | Must |
| FR-ALT-2 | At 30 s with no Tier 1 accept, every alerted volunteer is upgraded to high priority and the radius widens. | F16 | C3 | Must |
| FR-ALT-3 | Tier 1 is a **rolling** top 3: a decline immediately promotes the next nearest verified volunteer. All 3 declining upgrades everyone at once without waiting for 30 s. | F17 | C3 | Should |
| FR-ALT-4 | Silence is not a response. Decline requires a one-tap reason (`too_far`, `busy`, `not_safe`, `not_trained`) which is recorded. | F16 F17 | C3 | Must |
| FR-ALT-5 | Ranking is an effective ETA: `score = eta_seconds − skill_bonus − reliability_bonus + preference_penalty`. Every dispatch decision is logged with its inputs so it can be explained. | F18 | C3 | Should |
| FR-ALT-6 | Fewer than 3 verified volunteers in radius widens it in steps (1.5 → 3 → 5 km) and leans harder on guard and family. | F16 | C3 | Must |
| FR-ALT-7 | Protected profiles (child, cognitive disability, discreet) may not have an unverified volunteer as **sole** responder. | F16 | C3 C5 | Must |
| FR-ALT-8 | Team caps per case type; once met, everyone else receives "Covered, thank you, stay available". | F19 | C3 | Should |
| FR-ALT-9 | Fatigue and fairness: daily alert cap per volunteer, quiet hours unless on duty, rotation among equally near volunteers. | F19 | C3 | Should |

### 3.7 Volunteer app (Face B)

| ID | Requirement | Feature | Criteria | MoSCoW |
|----|-------------|---------|----------|--------|
| FR-VOL-1 | Alert screen: Tier 1 full-screen alarm, Tier 2 notification. Shows category, rough distance, ETA, age band, how many others are responding — **and nothing identifying**. Accept is a slide gesture; Decline asks a reason. | F20 | C3 C4 | Must |
| FR-VOL-2 | `I am available` toggle with modes `off`, `available_now`, `available_until`, `duty_windows`, `home_only`, `auto_pause`. | F21 | C3 | Must |
| FR-VOL-3 | Status taps: `On my way`, `Arrived`, `Need backup`, `Handed to ambulance`, `Resolved` with outcome, `Can't attend`. | F20 | C4 | Must |
| FR-VOL-4 | Safety check before accepting a harassment/violence case: "Do not confront. Observe from a safe distance and call 112." Stealth adds "Arrive quietly; do not mention SafeCircle out loud." | F20 | C3 | Must |
| FR-VOL-5 | Mission screen after accepting: map with accuracy circle, full address, flat, landmark, gate notes, photo, handling banner, flashcards. | F30 | C5 | Must |
| FR-VOL-6 | Trust levels L0–L4 with badges; only L2+ is eligible for Tier 1. | F25 | C3 | Must |
| FR-VOL-7 | A volunteer's own SOS (`I'm in danger`) alerts guard, co-responders and 112 with their live location. | F23 | C3 | Should |
| FR-VOL-8 | Mandatory tutorial and a practice alert before the first availability toggle. | F28 | C3 | Should |
| FR-VOL-9 | Community vote / society verifier path to L2. | F26 | C3 | Should |
| FR-VOL-10 | Battery-aware location layers L0–L4 with wake-up push. | F22 | C3 | Roadmap |
| FR-VOL-11 | Masked calling and per-incident responder chat. | F24 | C3 | Roadmap |
| FR-VOL-12 | DigiLocker ID and credential checks. | F27 | C3 | Roadmap |

### 3.8 Responder briefing, disclosure and flashcards

| ID | Requirement | Feature | Criteria | MoSCoW |
|----|-------------|---------|----------|--------|
| FR-BRF-1 | **Staged disclosure is enforced server-side.** The briefing endpoint returns `403` unless this volunteer has accepted this incident; the pre-accept payload physically does not contain name, address or medical data. | F32 | all | Must |
| FR-BRF-2 | Access secrets (gate/door code, spare-key holder) are released to the **guard role only**, encrypted at rest, and every release is audited. | F32 | all | Must |
| FR-BRF-3 | Every profile view is written to an append-only audit log: who, when, which incident, which fields. | F32 | all | Must |
| FR-BRF-4 | A handling banner is rendered from communication/handling profile fields, above everything else. | F30 | C5 | Must |
| FR-BRF-5 | On acceptance the app shows the 3 most likely situations ranked `w1·profile + w2·history + w3·context + w4·age + w5·population`, plus an always-visible "Not breathing? Start CPR" and a symptom picker fallback. | F31 | C3 C5 | Must |
| FR-BRF-6 | The chosen card becomes the incident's `volunteer_observed_type`, worded as a report ("Volunteer reports possible low blood sugar"), visible to dashboard, family and the 112 packet; changes are logged. | F31 | C4 | Must |
| FR-BRF-7 | Cards carry a "first-aid guidance, not a diagnosis" line, no medicine doses, a source and a dated doctor review. | F31 | C5 | Must |
| FR-BRF-8 | Cards are cached for offline use. | F31 | C3 | Should |

### 3.9 Family, guards, authorities

| ID | Requirement | Feature | Criteria | MoSCoW |
|----|-------------|---------|----------|--------|
| FR-FAM-1 | A family status page reachable by link with **no app**, live-updating: received → accepted (name, badge, skill) → distance/ETA → arrived → handed over → resolved. | F35 | C4 | Must |
| FR-FAM-2 | The family never sees a volunteer's live position; they do see the person's own location. | F35 | C4 | Must |
| FR-FAM-3 | Family actions: "I'm on my way", call via masked number, "This is a false alarm" (**runs verification, does not cancel**), share medical summary with hospital. | F35 | C4 | Must |
| FR-FAM-4 | A contact on the `never_inform` list receives no status, ever. | F35 | C5 | Must |
| FR-FAM-5 | Guard desk dashboard with a loud alarm, incident type, block and flat; full address and access notes immediately. | F36 | C2 C4 | Must |
| FR-FAM-6 | An unreachable guard escalates to the next guard then the society admin; timers keep running. | F36 | C2 | Must |
| FR-FAM-7 | Authority dashboard: live map with source + accuracy, incident list, volunteer/guard status, full event timeline, escalation state. | F36 | C2 C4 | Must |
| FR-FAM-8 | A 112 handoff packet (name, age band, address, live coordinates with source and accuracy, care-relevant profile summary, volunteer-observed type, who is on scene, callback numbers) — **simulated and labelled as such**. | F13 F36 | C2 | Must |
| FR-FAM-9 | Monthly RWA report: alerts, response times, false alarms, coverage gaps. | F36 | C2 | Should |

---

## 4. Non-functional requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Press → first volunteer alert (median) | **< 10 s** |
| NFR-2 | Dispatch must not block on a fresh location fix; it ranks on last-known and re-ranks as fixes arrive | hard rule |
| NFR-3 | Location accuracy at dispatch, outdoors (median) | < 30 m |
| NFR-4 | Press → first GPS fix (median) | < 30 s |
| NFR-5 | Device offline detection via heartbeat | buttons silent > 24 h under 2% |
| NFR-6 | Transport | TLS in production; plain HTTP is demo-only and must be labelled |
| NFR-7 | Device authenticity | HMAC-SHA256 per-device key + strictly increasing sequence |
| NFR-8 | At rest | field-level encryption for medical notes, access codes, ID references, person location fixes |
| NFR-9 | Retention | volunteer/person fixes 72 h after close; chat and masked-call logs 7 d; incident record 1 y then anonymised; audit log 1 y |
| NFR-10 | Accessibility | no flow requires speaking, hearing, reading or seeing; portal is screen-reader friendly; WCAG 2.2 AA for all four web faces |
| NFR-11 | Localisation | English, Hindi, Tamil for all person-facing and responder-facing content |
| NFR-12 | Resilience | device store-and-forward with back-off; an incident survives an API restart (timers rehydrate from the DB) |
| NFR-13 | Observability | every dispatch decision, state change and disclosure is queryable from the event log |
| NFR-14 | Honesty | every simulated capability (112 handoff, verification call, pendant 4G) is labelled `SIMULATED` in the UI and the API payload |

---

## 5. Explicit non-goals

1. SafeCircle does **not** promise a volunteer will come. Every surface says it adds to 112.
2. No real ERSS-112 integration exists. Any handoff is a simulation.
3. Cards are first-aid guidance, not diagnosis; the app course does not replace hands-on training.
4. Response speed is **never** gamified.
5. The Go pendant is **not** a tracker: location is shared during an alert or drill only, by default.

---

## 6. Legal and ethical constraints (design inputs)

* **DPDP Act 2023 / Rules 2025** — verifiable parental consent for a child (Rule 10) and lawful
  guardian consent for a person with a disability who has one (Rule 11). Many adults with
  disabilities consent for themselves. Core duties land ~May 2027; a pilot crosses that date, so
  the consent model is built now. Data minimisation: **every profile field must change how someone
  responds, or it is not collected.**
* **Good Samaritan protection** (MV Act s.134A) covers road accidents only. Most SafeCircle cases
  are not road accidents. Mitigations: code of conduct, mission log, insurance, honest terms.
* **Government ID** — DigiLocker consent flow via a KYC provider; store only the result, a masked
  number and the provider reference. Never a full Aadhaar number or card image.
* **Ethics watch-list** — vouching can carry prejudice (reasons required, appeals, verifier path,
  monitored rejection rates); geofencing and check-ins stay opt-in Roadmap; a discreet profile must
  never become a way to hide abuse *by* the person who configured it.

---

## 7. Traceability summary

| Criterion | Requirements |
|-----------|--------------|
| C1 Faster initiation | FR-TRG-1..11, FR-CAN-1..4, FR-FDB-5, NFR-1, NFR-2 |
| C2 Unified dispatch | FR-SET-2..4, FR-INC-1..11, FR-FAM-5..8, FR-TRG-10 |
| C3 Volunteer coordination | FR-ALT-1..9, FR-VOL-1..12, FR-BRF-5, FR-INC-11 |
| C4 Status updates | FR-FDB-1..6, FR-FAM-1..3, FR-VOL-1, FR-VOL-3, FR-SET-8 |
| C5 Accessible without an app | FR-TRG-1..9, FR-SET-1..9, FR-FDB-1..4, FR-BRF-4..5, FR-ALT-7, NFR-10 |
