# SafeCircle — feature status and the plan for what is left

What is built, what is not, and exactly how each remaining feature will be built.

Audited against the running code on 2 Oct 2026, not against intentions: every
"built" row below names the file that implements it and the test that proves it.

---

## Scoreboard

| | Master document tier | Count | Built | Partial | Not started |
|---|---|---|---|---|---|
| | **Must** | 19 | **19** | 0 | 0 |
| | **Should** | 18 | 11 | 2 | 5 |
| | **Roadmap** (F-numbered) | 8 | 0 | 3 | 5 |
| | **Roadmap** (beyond the table) | 9 | 0 | 0 | 9 |
| | **Total** | 54 | 30 | 5 | 19 |

160 automated tests pass: 107 domain, 53 integration.

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

### 1.2 `Should` features that the Must build required anyway

These are genuinely finished, not scaffolded.

| ID | Feature | Note |
|----|---------|------|
| F4 | Caregiver trigger | Including the "which dependent?" disambiguation |
| F5 | Bystander QR | Page asserted to carry no personal data; unknown codes are indistinguishable from real ones |
| F10 | Drill mode | Full chain, zero dispatches, caregiver gets sample messages, no escalation timers |
| F12 | Severity rules P1–P3 | 15 tests, including possible-abduction and duress |
| F14 | Device signature + sequence check | Constant-time HMAC, atomic replay guard |
| F17 | Rolling top 3 + early upgrade | A decline promotes the next **verified** volunteer, not the next nearest |
| F18 | Ranking with skill and reliability bonus | `rank_inputs` persisted so a dispatch can be explained months later |
| F19 | Team caps per case type | "Covered, thank you" to the rest |
| F34 | Feedback profiles | All 8, including the quiet-stage invariant that `loud` must not override |
| F41 | Wi-Fi scan positioning | Behind `GeolocationPort`; offline deterministic adapter |
| F42 | Known places | A saved BSSID resolves to a building with no GPS at all |

### 1.3 Infrastructure not in the feature table

Persisted timers that survive a restart · append-only event log that every KPI
reads from · field-level AES-256-GCM encryption · append-only audit log ·
retention jobs on the §20.2 schedule · the `simulated` flag rendered as a chip
wherever it appears · a device simulator (web and CLI) · 160 tests.

---

## 2. Pending — and how each will be built

Ordered by the phase that will deliver it. Every entry names the seam that
already exists, because most of this work is surface rather than foundation.

### Phase 9 — finish the `Should` tier

**F23 · "I'm in danger" (volunteer's own SOS)** — `S`
*Not started.* `POST /api/volunteer/danger` is in the API contract but has no
route.
**How:** reuse the engine. A volunteer SOS is an incident whose `person` is the
volunteer, so: add a `volunteers.as_person_id` link created on registration, then
the route calls `ingest()` with `source: 'volunteer_app'` and severity forced to
P1. The guard, co-responders on that incident and 112 are notified by the
existing `alertGuards` / `escalate` paths. New work is one route, one migration
column, and a button on the mission screen.
**Depends on:** nothing.

**F26 · Community vote and society verifier** — `M`
*Partial.* `vouches` table, `recordVouch` and `tallyVouches` exist and are
unused; there is no route, no pass rule, no invitation logic, no safeguards.
**How:** (1) a `vote_rounds` table holding candidate, opened_at, deadline and
outcome; (2) an invitation job that picks the society verifier plus up to 15
random L2 volunteers within 1 km using the existing `findCandidates` bounding-box
query; (3) the pass rule as a pure function in `packages/shared/vouching.ts` —
≥3 vouches, ≥⅔ of non-abstain, inside 7 days, any "concern" routing to an admin
instead of auto-rejecting, so it is unit-testable without a database;
(4) collusion safeguards as SQL constraints — shared phone/device/address cannot
vouch, a monthly cap per voter, no voting within 30 days of reaching L2;
(5) a voter screen showing only photo, first name and initial, street, occupation
and years resident — never the ID. Promotion to L2 calls the existing
`setTrustLevel`.
**Watch:** §12.3's bias problem is a product risk, not a code one. Rejection
rates by group must be visible on the dashboard from day one, and every rejection
appealable.

**F28 · Mandatory tutorial and practice alert** — `M`
*Partial.* The gate is real and enforced server-side — `setAvailability` refuses
without `tutorial_completed_at`, and `POST /api/volunteer/tutorial/complete` sets
it. There is no actual course: a volunteer presses one button.
**How:** modules M1–M6 as versioned content rows next to `cards`, a
`volunteer_module_progress` table, and a quiz with an 80% pass mark. M6 (the
practice alert) reuses drill mode: raise a `drill` incident targeted at that one
volunteer so they experience a real siren, accept, briefing and flashcard without
anyone being dispatched. The gate already exists; this fills it in.

**F37 · Heartbeat and low-battery alerts** — `S`
*Partial.* Devices send heartbeats, `staleDevices()` finds silent ones, and the
portal shows battery and "silent for over 24 hours". Nothing proactively
*messages* the caregiver.
**How:** an hourly job beside the retention jobs in `scheduler/`, using the same
atomic-claim pattern as the timer runner so it is safe under multiple processes.
It sends a `device_health` template through `MessagingPort` with a cooldown per
device so a flat battery cannot message someone hourly for a week.

**F6 · Silent SOS (discreet triple press)** — `S`
*Partial, and the gap matters.* The firmware detects the triple press and the API
accepts `silent_panic`; a stealth profile correctly yields light-only. **But a
`silent_panic` from a standard profile currently plays the standard loud
pattern** — the one thing the gesture exists to prevent.
**How:** treat the event, not just the profile, as the silence signal. Add
`silentRequested` to the incident flags and have `patternFor()` take it alongside
the profile, forcing the discreet transform for that incident regardless of the
person's configured profile. A domain test per profile, mirroring the
quiet-stage invariant that already guards `cancel_verifying`.

**F9 · Browser Wi-Fi provisioning (SoftAP / Improv)** — `M`
*Not started.* The demo hardcodes credentials.
**How:** two paths, as §5.1 describes. SoftAP: the button opens its own hotspot
and serves a captive-portal page from the ESP32; works in any browser including
iPhone. Improv over BLE: a Web Bluetooth flow from the portal, Chrome and Edge
only. Ship SoftAP first because it has no browser exclusions, and offer Improv as
the faster path where it works.

**F43 · 4G Cat-1 link with SIM** — `M`
*Partial.* The pendant firmware has the `USE_LTE` seam and the route-B board is
chosen; the modem bring-up is a stub.
**How:** initialise the A7670G, attach to the IoT APN, and prefer a saved Wi-Fi
network when one is in range because it is faster and free. Status comes back
over MQTT on the same link rather than HTTP polling, which is also the upgrade
path for F33's push. **Blocked on** an IoT SIM provider (decision log #21).

**F7 · SMS keyword and missed call** — `M`
*Not started.* `/webhooks/sms` exists and normalises identically to WhatsApp.
**How:** mostly procurement. Inbound SMS to India needs an Indian virtual-number
provider; missed-call needs a number whose caller ID we read. Both then run the
existing pipeline unchanged. **Blocked on** a provider (§4 T4 is unresearched).

**F15 · Check-in call at the start of an alert** — `M`
*Not started.* `VoicePort.placeCall` already has a `check_in` flow defined.
**How:** place the call in parallel with dispatch — never on the critical path —
and feed the DTMF answer into `scoreSeverity` (which already accepts
`checkInAnswer`) and into the flashcard `context` term (which already consumes
it). Both consumers are built and tested; this is the producer.
**Blocked on** an Exotel account and KYC.

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

1. **F6 silent SOS does not silence a standard profile.** Detailed above. The
   highest-priority fix in Phase 9, because the gesture promises silence and does
   not deliver it.
2. **Flashcard content is not doctor-reviewed.** Every card carries
   `reviewedBy: "PLACEHOLDER — not yet reviewed by a named doctor"`, and the UI
   says so on the card. The gating mechanism works; the sign-off is missing.
3. **The volunteer PWA only receives alerts while its tab is open.** A real
   browser limit, labelled in the UI, and the reason §10.5 puts a native app on
   the pilot path.
4. **Guard shift on/off is not a route.** Guards are seeded on duty and the guard
   *view* is fully enforced server-side, but a guard cannot toggle their own
   shift. One route plus a button.
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
