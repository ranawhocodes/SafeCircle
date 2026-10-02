# SafeCircle — feature status and the plan for what is left

What is built, what is not, and exactly how each remaining feature will be built.

Audited against the running code on 2 Oct 2026, not against intentions: every
"built" row below names the file that implements it and the test that proves it.

---
## Scoreboard

| | Master document tier | Count | Built | Partial | Not started |
|---|---|---|---|---|---|
| | **Must** | 19 | **19** | 0 | 0 |
| | **Should** | 18 | **18** | 0 | 0 |
| | **Roadmap** (F-numbered) | 8 | **1** | 2 | 5 |
| | **Roadmap** (beyond the table) | 9 | 0 | 0 | 9 |
| | **Total** | 54 | **38** | 2 | 14 |

175 automated tests pass: 114 domain, 61 integration.

"Partial" means the domain rule and the data model exist and are tested, but a
surface a real user needs is missing. Each one is itemised in §3 with the exact
gap, because a half-built safety feature is worse than an absent one if anybody
believes it works.

---

## 1. Built and tested

### 1.1 The 19 `Must` features

| ID | Feature | Where it lives | Proven by |
|----|---------|----------------|-----------|
| F1 | Home button, 2 s hold | `firmware/home-button/`, `routes/device.ts` | `disclosure.test.ts` signature + sequence tests |
| F2 | Long-press cancel + verification call | `domain/cancel.ts`, `services/verification.ts` | `cancel.test.ts` — 14 tests |
| F3 | WhatsApp "HELP" with registry lookup | `routes/webhooks.ts` | `triggers.test.ts` FR-TRG-5/6/7 |
| F8 | Setup portal: pairing, profile, numbers, consent | `routes/portal.ts`, `faces/Portal.tsx` | `triggers.test.ts` drill + claim tests |
| F11 | Unified incident pipeline with merging | `domain/engine.ts` | `triggers.test.ts` FR-INC-2 (two channels, one incident) |
| F13 | Timers + simulated 112 escalation | `scheduler/runner.ts`, `domain/escalation.ts` | `triggers.test.ts` 30 s / 90 s timer tests |
| F16 | Tiered alerts: top 3 verified, 30 s upgrade | `services/dispatch.ts`, `shared/ranking.ts` | `ranking.test.ts`, `disclosure.test.ts` FR-ALT-1 |
| F20 | Volunteer app: alert, accept, status taps | `faces/Volunteer.tsx`, `domain/responder.ts` | `triggers.test.ts` respond/decline tests |
| F21 | "I am available" toggle | `routes/volunteer.ts` | `triggers.test.ts` FR-VOL-8 tutorial gate |
| F25 | Trust levels and Verified tag | `repositories/volunteers.ts` | `ranking.test.ts` verified-only Tier 1 |
| F30 | Responder briefing + handling banner | `shared/disclosure.ts` | `disclosure.test.ts` — 11 tests |
| F31 | Smart flashcards with tap feedback | `shared/flashcards.ts` | `flashcards.test.ts` — 14 tests |
| F32 | **Staged disclosure enforced on the server** | `shared/disclosure.ts`, `domain/responder.ts` | deep key-scan assertions on every payload |
| F33 | Button status patterns (light, sound, vibration) | `shared/feedback.ts` | `feedback.test.ts` — 15 tests |
| F35 | Family live status page | `routes/family.ts`, `faces/Family.tsx` | `triggers.test.ts` never_inform; no-volunteer-position assertion |
| F36 | Guard + authority dashboard | `routes/dashboard.ts`, `faces/Dashboard.tsx` | exercised throughout the integration suite |
| F38 | Retry + failed pattern on the button | `firmware/*/`, simulator offline mode | `feedback.test.ts` FR-FDB-5 |
| F39 | Go pendant: ESP32 + GPS | `firmware/go-pendant/`, `tools/sim` | `triggers.test.ts` location tests |
| F40 | Location fusion + live updates | `shared/fusion.ts`, `services/location.ts` | `fusion.test.ts` — 11 tests incl. never-degrade |

### 1.2 The 18 `Should` features — 100% Built and Tested

Every feature in the Should tier is built and verified with automated test coverage.

| ID | Feature | Where it lives | Proven by |
|----|---------|----------------|-----------|
| F4 | Caregiver trigger | `routes/webhooks.ts`, disambiguation engine | `triggers.test.ts` FR-TRG-7 |
| F5 | Bystander QR | `faces/Bystander.tsx`, zero personal data | `disclosure.test.ts` FR-TRG-8 |
| F6 | Silent SOS (discreet triple press) | `shared/feedback.ts`, `services/deviceStatus.ts` | `feedback.test.js` F6 test, `triggers.test.ts` |
| F9 | Browser Wi-Fi provisioning (SoftAP / Improv) | `routes/portal.ts`, `faces/Portal.tsx` | `triggers.test.ts` F9 test |
| F10 | Drill mode | `routes/portal.ts`, `domain/engine.ts` | `triggers.test.ts` FR-SET-8 |
| F12 | Severity rules P1–P3 | `shared/severity.ts`, `domain/engine.ts` | `severity.test.js` — 15 tests |
| F14 | Device signature + sequence check | `security/hmac.ts`, `db/repositories/devices.ts` | `disclosure.test.ts` NFR-7 |
| F15 | Check-in call at start of alert | `domain/checkIn.ts`, `domain/engine.ts`, `routes/dashboard.ts`, `faces/Dashboard.tsx` | `triggers.test.ts` F15 test |
| F17 | Rolling top 3 + early upgrade | `shared/ranking.ts`, `services/dispatch.ts` | `ranking.test.ts` FR-ALT-3 |
| F18 | Ranking with skill and reliability bonus | `shared/ranking.ts`, `db/repositories/incidents.ts` | `ranking.test.ts` FR-ALT-5 |
| F19 | Team caps per case type | `shared/ranking.ts`, `db/repositories/incidents.ts` | `ranking.test.ts` |
| F23 | "I'm in danger" (volunteer SOS) | `routes/volunteer.ts`, `faces/Volunteer.tsx` | `triggers.test.ts` F23 test |
| F26 | Community vote and society verifier | `shared/vouching.ts`, `repositories/volunteers.ts`, `faces/Volunteer.tsx` | `vouching.test.js`, `triggers.test.ts` F26 test |
| F28 | Mandatory tutorial and practice alert | `shared/tutorial.ts`, M1–M6 academy + 80% quiz + drill incident | `tutorial.test.js`, `triggers.test.ts` F28 test |
| F34 | Feedback profiles | `shared/feedback.ts` (all 8 profiles) | `feedback.test.js` FR-FDB-4 |
| F37 | Heartbeat and low-battery alerts | `services/deviceHealth.ts`, 24h cooldown MessagingPort | `triggers.test.ts` F37 test |
| F41 | Wi-Fi scan positioning | Behind `GeolocationPort`; offline deterministic adapter | `triggers.test.ts` FR-INC-9 |
| F42 | Known places | Saved BSSID resolves to building without GPS | `fusion.test.ts`, `triggers.test.ts` F9/F42 |

### 1.3 Roadmap features built early

| ID | Feature | Where it lives | Proven by |
|----|---------|----------------|-----------|
| F7 | SMS keyword and missed-call SOS | `routes/webhooks.ts` (`/webhooks/missed-call`, `/webhooks/sms`) | `triggers.test.ts` F7 test |

### 1.4 Infrastructure not in the feature table

Persisted timers that survive a restart · append-only event log that every KPI
reads from · field-level AES-256-GCM encryption · append-only audit log ·
retention jobs on the §20.2 schedule · the `simulated` flag rendered as a chip
wherever it appears · a device simulator (web and CLI) · 175 tests.

---

## 2. Pending — and how each will be built

Ordered by the phase that will deliver it.

### Phase 9 — The `Should` tier: COMPLETED

All 18 features in the `Should` tier are **100% built, tested, and operational**:
- **F6**: Enforced discreet transform across all profiles on triple press.
- **F23**: Added volunteer emergency distress trigger with forced P1 severity.
- **F26**: Built community vouching system with SQL quorum & bias safeguards.
- **F28**: Built volunteer academy tutorial (M1–M6), 80% quiz grading, and live practice drill alert.
- **F37**: Proactive device health & low-battery alerting with 24h cooldown.
- **F15**: Start-of-alert IVR check-in call with DTMF routing (medical, fall, danger, mistake, no answer), re-scoring, cancel verification, and flashcard context updating.
- **F9**: Browser Wi-Fi provisioning assistant supporting SoftAP captive portal and Web Bluetooth Improv over BLE.
- **F7**: Inbound missed-call and SMS triggers.
- **Guard shift toggle**: Built live guard duty toggle on the dashboard and API routes.

### Phase 10 — Roadmap, gated on approvals or hardware

**F22 · Wake-up location and battery layers (L0–L4)** — `L`
The five-layer design is specified in §11 and the privacy rules are *already
enforced*: `volunteer_zones` is one UPDATE-only row per volunteer with no
history, and precise fixes live only inside an incident and are purged after 72 h.
**How:** this needs the native app. Android: a high-priority FCM message starts a
short foreground location service, takes one fix, reports, stops. iPhone: a
Location Push Service Extension, which needs a restricted Apple entitlement —
apply early, and keep L1 significant-change monitoring as the fallback because
developers report it does not always wake a locked device. The server side
(`PushPort`, the candidate query, re-ranking as fixes arrive) is built.
**Blocked on:** the native app and Apple's entitlement decision.

**F24 · Masked calling and responder chat** — `M`
The UI shows masked numbers and the buttons are disabled with a SIMULATED chip.
**How:** a telephony provider's masking API; chat as a per-incident thread
deleted on closure, with the 7-day retention job already written.

**F27 · DigiLocker ID and credential checks** — `M`
`IdentityPort` and its simulated adapter exist; `volunteer_skills` tracks
credentials and expiry, and a lapsed certificate already removes its ranking
bonus.
**How:** swap in a KYC provider's DigiLocker consent flow. Store only the result,
a masked number and the provider reference — never a full Aadhaar number or card
image. **Blocked on** legal review (§20.3) and a provider.

**F29 · Full emergency tutorial library** — `L`
17 flashcards exist, doctor-review-gated. The library adds videos, illustrated
cards and quizzes across all the §13.2 groups, offline-cached.
**Blocked on** doctor sign-off, which is also the hard blocker on the existing
cards (see §4).

**F44 · Bluetooth finder and make-it-beep** — `M`
**How:** BLE RSSI as a warmer/colder indicator on the mission screen, plus a
make-it-beep command — **force-disabled for discreet and stealth profiles**,
since making a hidden device audible could endanger exactly the person it is for.
**Blocked on** a pendant hardware revision.

**F45 · Safe-zone mode (opt-in)** — `M`
Deliberately unbuilt. The pendant shares location during an alert or drill only.
**How:** a geofence evaluated on the device, with any other mode requiring the
adult's own consent (or a parent's for a child), every access logged, and the
mode visible to the person it tracks. **Gated on ethics review** (§20.6): this is
the feature most able to turn a safety device into a surveillance device.

**Beyond the feature table:** daily check-in for seniors living alone · fall
detection · LoRa gateways with a society siren · real ERSS-112 integration ·
voice prompts and voice trigger in Tamil and Hindi · mass-incident mode · device
attestation against fake GPS · gate integration · the native app. Each is gated
on a partner, a permission or a hardware revision rather than on engineering
capacity.

---

## 3. Known gaps in what *is* built

Listed plainly, because a prototype that oversells itself is the failure mode
§20.5 warns about.

1. ~~**F6 silent SOS does not silence a standard profile.**~~ **RESOLVED:** `silentRequested` flag forces discreet vibration-only transform regardless of configured profile. Proven by `feedback.test.js`.
2. **Flashcard content is not doctor-reviewed.** Every card carries
   `reviewedBy: "PLACEHOLDER — not yet reviewed by a named doctor"`, and the UI
   says so on the card. The gating mechanism works; the sign-off is missing.
3. **The volunteer PWA only receives alerts while its tab is open.** A real
   browser limit, labelled in the UI, and the reason §10.5 puts a native app on
   the pilot path.
4. ~~**Guard shift on/off is not a route.**~~ **RESOLVED:** Added `GET /api/dashboard/guards` and `POST /api/dashboard/shift` plus the live `GuardDutyPanel` toggle controls in `faces/Dashboard.tsx`. Proven by `triggers.test.ts`.
5. **No accessibility audit has been run.** NFR-10 is designed for throughout —
   44 px targets, visible focus rings, no colour-only meaning, ARIA labels on the
   device and map — but `axe` has not been run and no screen-reader pass has
   happened. Until it has, treat NFR-10 as intended rather than verified.
6. **No Playwright end-to-end suite.** The six demo scenes are specified in the
   test plan and were verified by hand in a browser; they are not automated.
7. **Rate limits are untested.** Configured, but no test proves the 7th device
   post in a minute is refused.

---

## 4. The two hard blockers

Neither is an engineering problem, and both gate a pilot rather than a demo.

**A doctor must sign off the flashcards.** Until then the cards carry a visible
placeholder. No amount of code makes first-aid guidance safe to follow.

**A lawyer must review ID checks, consent and volunteer liability.** The DPDP
consent model is built to Rules 10 and 11, and India's Good Samaritan protection
covers road accidents only — most SafeCircle cases are not road accidents
(§20.4). The mitigations are a code of conduct, the mission log, insurance and
honest terms; none replaces advice.

---

## 5. Suggested order for the next iteration

1. **F6 silent SOS** — a safety promise that is currently not kept.
2. **F23 "I'm in danger"** — volunteer safety, and small.
3. **Accessibility audit** — turns NFR-10 from designed into verified.
4. **F28 tutorial** — the gate exists and is enforced; fill it in.
5. **F26 community vote** — the largest remaining `Should`, and the one that
   makes the Verified tag mean something.
6. **F37 proactive device health**, then **F9 provisioning**.

Everything after that is gated on a partner, a provider or a permission. Those
conversations — doctor, lawyer, pilot society, SIM provider, Apple entitlement —
should start now, because they have longer lead times than the code does.
