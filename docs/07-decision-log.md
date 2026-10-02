# SafeCircle — Decision log

The master document §26 lists every open question. This log records what the build assumes, so a
reader can tell a **decided** thing from a **placeholder**. Status: `DECIDED` (built this way) ·
`DEFAULT` (built this way, cheap to change, needs team sign-off) · `OPEN` (not built).

## Product (§26.1)

| # | Question | Status | Decision in code |
|---|----------|--------|------------------|
| 1 | Send instantly on 2 s hold, or 3 s countdown? (§6.1) | DECIDED | Send instantly. Optional per-person `pre_send_countdown_s` (0–5, default 0) exists on the profile for frequent accidental pressers. |
| 2 | After an unverifiable cancel, device quiet or reassuring? (§6.2) | DEFAULT | **Quiet** — safer against an attacker. `feedback_profile` can override per person. |
| 3 | Duress PIN, or only 1/9? (§6.2) | DEFAULT | Both supported. PIN optional per person; absent by default. A wrong PIN is treated as duress. |
| 4 | Unregistered HELP: guard only, or volunteers too? (§4 T2) | DECIDED | **Guard desk + dashboard only.** Abuse risk is the deciding factor (§16.4 #15). |
| 5 | Responders per case type? (§8.5) | DEFAULT | collapse/cardiac 3 · fall/medical 1+1 backup · child/cognitive 1 verified + guard · harassment 3 observe-only. In `shared/teamCaps.ts`. |
| 6 | Timers: 30 s upgrade, 112 at 90 s? (§8.4) | DEFAULT | As documented, in `shared/timers.ts`, all env-overridable. |
| 7 | Tier 1 size (3), radius steps (1.5/3/5 km)? (§9.1) | DEFAULT | As documented, in `shared/dispatchConfig.ts`. |
| 8 | Unverified volunteer ever sole responder for a protected profile? (§9.2) | DECIDED | **No.** Enforced in dispatch, not the UI. |
| 9 | Vote pass rule (≥3 vouches, ⅔ of non-abstain, 7 days)? (§12.3) | DEFAULT | As documented; any "concern" routes to an admin instead of auto-rejecting. |
| 10 | Retention periods? (§11.4, §20.2) | DEFAULT | Fixes 72 h after close · chat/masked-call logs 7 d · incident 1 y then anonymised · audit 1 y. One config table drives the cleanup job. |
| 11 | Stealth: lights only, brightness, position? (§7.2) | DEFAULT | Lights only, brightness level 1 of 5, side-facing LED. No buzzer, no vibration, no calls. Silent-vibration variant is a flag, off by default. |

## Build and demo (§26.2)

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 12 | Stack: Node or Python; React or plain HTML | DECIDED | **Node 25 + TypeScript + Fastify; PostgreSQL 18; React 19 + Vite.** See `02-architecture.md` §1. |
| 13 | Pilot app: Flutter or React Native | OPEN | PWA in iteration 1; native decision deferred to Phase 8. |
| 14 | Which two personas to demo | DECIDED | Lakshmi, 78, diabetic, hard of hearing, fall history (the document's worked example) and Arjun, 9, non-verbal autistic, Go pendant on a bag tag. |
| 15 | Family/volunteer alerts in the demo: WhatsApp, Telegram, app only | DECIDED | Simulated outbox rendered in the dashboard and `/sim`, plus a real WhatsApp adapter behind `MessagingPort` for when a number is provisioned. |
| 16 | Final project name, team details | OPEN | `SafeCircle` is a placeholder — not checked for trademarks (§1). |
| 17 | PostGIS | DECIDED | Not used. Bbox + haversine; migration path in `03-data-model.md` §6. |

## Pilot and partners (§26.3) — all OPEN

Pilot society · doctor for card review · lawyer for ID/consent/liability · CPR workshop partner ·
local police/PSAP contact · funding model after the pilot.

## GPS and Go pendant (§26.4)

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 18 | Pilot pendant route | DEFAULT | Route A (ESP32 + GNSS breakout) for the demo; route B (LilyGO T-A7670G **with GPS**) for the pilot. |
| 19 | Demo GPS module | DEFAULT | Budget NEO-6M/ATGM336H for the demo; MAX-M10S if low-power numbers must be shown. |
| 20 | NavIC? | OPEN | No personal-device rule found (AIS-140 is vehicle trackers). Quectel L89HA-S90 noted as the option. |
| 21 | IoT SIM provider | OPEN | — |
| 22 | Update interval moving / still | DEFAULT | 10 s moving, 60 s still. |
| 23 | P1 when a child's pendant moves at vehicle speed? | DEFAULT | **Yes**, implemented as a rule with a `possible_abduction` flag; volunteers are told not to chase. Flagged for ethics review before a pilot. |
| 24 | Any location mode beyond alerts | DECIDED | None. Alerts and drills only. Safe-zone mode stays Roadmap and opt-in. |
| 25 | Charging target and dock | DEFAULT | 3–7 day target; 20% warning to caregiver; dock is a Roadmap enclosure task. |

## Verify-before-quoting (§27.7)

ERSS 2.0 coverage · WhatsApp pricing · Apple Critical Alerts and Location Push entitlements ·
Android full-screen intent policy · Aadhaar storage rules · Good Samaritan scope for non-road
cases · CPR numbers against current AHA/ILCOR/IRC · component prices and specs. None of these are
asserted as fact in the product UI.
