# SafeCircle — Backlog and phase plan

All **45 features** from master document §21. Iteration 1 builds the **19 `Must`** features.
The `Should` and `Roadmap` features are kept here with their phase so nothing is lost.

Legend — `[ ]` not started · `[~]` in progress · `[x]` done · `S` ≤1 day · `M` 2–4 days · `L` ≥1 week

---

> **For the audited, per-feature status — including the known gaps in what is
> built and how each pending feature will be implemented — see
> [09-feature-status.md](09-feature-status.md).** This document is the phase plan;
> that one is the ground truth.

## Status at a glance

**Iteration 1 is complete: all 19 `Must` features are built and tested.**
160 automated tests pass (107 domain, 53 integration). What remains open is the
`Should` and `Roadmap` work in Phases 9 and 10, plus the hardening items listed
under P8.

Several `Should` features came along for free because the Must build needed
their domain rules: the full severity rule set (F12), ranking bonuses (F18),
rolling top 3 (F17), team caps (F19), feedback profiles (F34), drill mode (F10),
Wi-Fi positioning (F41), known places (F42), the bystander QR (F5), the caregiver
trigger (F4) and device signing (F14) are all implemented and covered by tests.
They stay listed in Phase 9 because their configuration UI is not finished.

## Iteration 1 — the 19 Must features

| Phase | ID | Feature | Req | Effort | Status |
|-------|----|---------|-----|--------|--------|
| **P1 Foundations** | — | Monorepo, TS config, Postgres migrations, seed personas, logger, config | — | M | [x] |
| | F32 | Staged disclosure enforced on the server | FR-BRF-1/2/3 | S | [x] |
| **P2 Incident engine** | F11 | Unified incident pipeline with merging | FR-INC-1/2 | M | [x] |
| | F13 | Timers + simulated 112 escalation | FR-INC-6/7/8 | S | [x] |
| | F40 | Location fusion + live updates during an alert | FR-INC-9/10/11 | M | [x] |
| **P3 Device (Face A)** | F1 | Home button (Wi-Fi), 2 s hold | FR-TRG-1 | M | [x] |
| | F39 | Go pendant: ESP32 + GPS (demo over hotspot) | FR-TRG-2/3 | M | [x] |
| | F33 | Button status patterns (light, sound, vibration) | FR-FDB-1/2/3 | M | [x] |
| | F38 | Retry + failed pattern on the button | FR-FDB-5 | S | [x] |
| **P4 Dispatch** | F16 | Tiered alerts: top 3 verified, 30 s upgrade | FR-ALT-1/2/4/6/7 | M | [x] |
| | F25 | Trust levels and Verified tag | FR-VOL-6 | S | [x] |
| **P5 Volunteer app** | F20 | Volunteer app: alert, accept, status taps | FR-VOL-1/3/4 | M | [x] |
| | F21 | "I am available" toggle | FR-VOL-2 | S | [x] |
| | F30 | Responder briefing + handling banner | FR-VOL-5, FR-BRF-4 | S | [x] |
| | F31 | Smart flashcards with tap feedback | FR-BRF-5/6/7 | M | [x] |
| **P6 Face A + authority web** | F8 | Setup portal: pairing, profile, numbers, consent | FR-SET-1..7 | M | [x] |
| | F35 | Family live status page | FR-FAM-1..4 | S | [x] |
| | F36 | Guard + authority dashboard | FR-FAM-5..8 | M | [x] |
| **P7 Cancel + messaging** | F2 | Long-press cancel + verification call (simulated) | FR-CAN-1..7 | M | [x] |
| | F3 | WhatsApp "HELP" with registry lookup | FR-TRG-5/6 | M | [x] |
| **P8 Hardening** | — | Test suite to the §5 quality gates, a11y pass, demo script rehearsal | — | M | [~] |

---

## Phase 9 — `Should` features (next iteration)

| ID | Feature | Req | Effort |
|----|---------|-----|--------|
| F4 | Caregiver trigger | FR-TRG-7 | S |
| F5 | Bystander QR on the pendant | FR-TRG-8 | S |
| F6 | Silent SOS (discreet triple press) | FR-TRG-9 | S |
| F9 | Browser Wi-Fi provisioning (SoftAP / Improv) | FR-SET-10 | M |
| F10 | Drill mode | FR-SET-8 | S |
| F12 | Severity rules P1–P3 (full rule set + AI *suggestion* only) | FR-INC-3 | S |
| F14 | Device signature + sequence check hardening | FR-TRG-10 | S |
| F17 | Rolling top 3 + early upgrade | FR-ALT-3 | S |
| F18 | Ranking with skill + reliability bonus | FR-ALT-5 | S |
| F19 | Team caps per case type | FR-ALT-8/9 | S |
| F23 | "I'm in danger" button | FR-VOL-7 | S |
| F26 | Community vote + society verifier | FR-VOL-9 | M |
| F28 | Mandatory tutorial + practice alert | FR-VOL-8 | M |
| F34 | Feedback profiles (loud, calm, discreet, stealth…) | FR-FDB-4 | S |
| F37 | Heartbeat + low-battery alerts | FR-FDB-6 | S |
| F41 | Wi-Fi scan positioning via geolocation API | FR-INC-9 | S |
| F42 | Known places (saved, named Wi-Fi networks) | FR-SET-11 | S |
| F43 | 4G Cat-1 link with SIM | FR-TRG-2 | M |

> Several `Should` items are cheap *because* the Must build already carries their seam —
> F34 feedback profiles, F12 severity rules, F18 ranking bonuses, F19 team caps and F10 drill mode
> are all implemented as **pure functions in `packages/shared` during iteration 1** with the full
> rule set, and only their UI/config surface is deferred. They are listed here honestly as
> incomplete until that surface exists.

## Phase 10+ — `Roadmap` (never shown as working)

| ID | Feature | Gate |
|----|---------|------|
| F7 | SMS keyword + missed-call trigger | Indian inbound-SMS provider |
| F15 | Check-in call at the start of an alert | Exotel account + KYC |
| F22 | Wake-up location + battery layers | native app + Apple Location Push entitlement |
| F24 | Masked calling + responder chat | telephony provider |
| F27 | DigiLocker ID + credential checks | KYC provider + legal review |
| F29 | Full emergency tutorial library | doctor sign-off on every card |
| F44 | Bluetooth finder + make-it-beep | pendant hardware revision |
| F45 | Safe-zone mode (opt-in) | ethics review (§20.6) |
| — | Daily check-in for seniors living alone | ethics + opt-in consent |
| — | Fall detection | sensor + false-positive tuning |
| — | LoRa gateways + society siren | pilot society agreement |
| — | Real ERSS-112 integration | state permission |
| — | Voice prompts + voice trigger (Tamil, Hindi) | audio hardware + TTS |
| — | Mass-incident mode | dashboard triage design |
| — | Device attestation against fake GPS | Play Integrity / App Attest |
| — | Gate integration | society hardware |
| — | Native app (Flutter or React Native) | decision #13 in the decision log |

---

## Phase gates (master document §23, targets are proposals)

**Gate 1 — the system works.** All Must features demonstrable end to end; `npm test` green; press →
first volunteer alert median < 10 s; zero known staged-disclosure leaks.

**Gate 2 — real people respond in time.** Pilot in one society: first accept within 60 s on 80% of
drills; ≥3 verified volunteers within 1 km for 90% of registered people; volunteers reporting
noticeable battery drain under 10%; buttons silent > 24 h under 2%; no unexplained vote-rejection
gap by group. Plus the legal and 112 permissions that city scale needs.

## KPI instrumentation (built in P2, read in P8)

Every KPI in §23.3 is computed from `incident_events`, so measurement needs no extra plumbing:
press→first-alert, first-accept-within-60 s, responder-on-scene-before-ambulance, verified
volunteers within 1 km per person, false alarms caught by cancel verification, verification calls
answered, buttons silent > 24 h, vote rejection rate by group, dispatch location accuracy,
press→first-GPS-fix, days between pendant charges.
