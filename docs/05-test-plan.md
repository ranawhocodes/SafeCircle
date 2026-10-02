# SafeCircle — Test plan

A life-safety prototype earns trust by testing the **failure** paths, not the happy path. Every
test below names the requirement it proves.

## 1. Levels

| Level | Tool | Scope |
|-------|------|-------|
| Unit | `node:test` | `packages/shared` pure domain: severity, states, timers, fusion, ranking, feedback patterns, flashcards, geo |
| Integration | `node:test` + Fastify `inject` | routes against a real throwaway Postgres schema; no network |
| Contract | `node:test` | every simulated provider adapter honours its port, including `simulated: true` |
| End-to-end | Playwright + `tools/sim` | device → API → volunteer PWA → family page → dashboard in one browser run |
| Manual / field | checklist in §6 | hardware, radio, battery, outdoor GPS |

`npm test` runs unit + integration + contract. `npm run test:e2e` adds Playwright.

### Always run the suite through `npm test`

`NODE_ENV=test` is set **on the command line**, not inside a test file, and this
is not a style preference. ES module imports are hoisted and evaluated before any
top-level statement, so an assignment in `test/helpers.ts` would run *after*
`src/config.ts` had already read the variable — the suite would silently select
the **development** database and `migrate({reset: true})` would drop its schema.

`test/helpers.ts` asserts `config.isTest` and throws with the database name if it
is false, so this failure is loud and harmless rather than quiet and destructive.
Integration tests also run serially (`--test-concurrency=1`) because every file
resets the one shared test schema.

## 2. Domain unit tests (the ones that matter)

**Severity (FR-INC-3)** — a press is P2; cardiac history + unanswered check-in is P1; caregiver
"unconscious" is P1; duress-after-cancel is P1; child pendant at vehicle speed is P1 with
`possible_abduction`; unknown sender is `unverified`; P3 never auto-escalates to 112.

**State machine (FR-INC-4/5)** — every legal transition accepted, every illegal one rejected;
`escalated` is a flag that survives `accepted` and `on_scene`; no path auto-closes an unresolved
incident; `cancel_verifying → resolved` is impossible without a `verifications` row.

**Timers (FR-INC-6/7)** — with a frozen clock: 30 s fires `upgrade_all`; 60 s fires the family
call only if unopened; 90 s escalates; accept cancels nothing but reschedules `still_coming`;
`DEMO_TIME_SCALE=0.333` makes 30 s fire at 10 s; a resolved incident cancels all pending timers;
timers rehydrate after a simulated restart (NFR-12).

**Location fusion (FR-INC-9/10)** — gps(8 m) beats wifi(60 m) beats cell(900 m) beats
known_place beats registry; **a newer but less accurate fix does not replace a fresher accurate
one** (the never-degrade rule); a stale GPS fix (age > 120 s) loses to a fresh Wi-Fi estimate;
every returned position carries `source` and `accuracy_m` — a position with neither is a test
failure.

**Ranking (FR-ALT-5)** — a nurse 350 m away outranks a student 300 m away on a medical case; the
language/responder-preference penalty flips an otherwise-tied pair; an expired certificate removes
its bonus; `rank_inputs` is always persisted.

**Tiering (FR-ALT-1/3/6/7)** — Tier 1 is exactly the 3 nearest **verified** available volunteers;
a decline promotes #4 immediately; 3 declines upgrade everyone without waiting; fewer than 3
verified widens 1.5 → 3 → 5 km; **an unverified volunteer is never the sole responder for a
protected profile**; opted-out case types and quiet hours exclude; the daily cap excludes.

**Feedback (FR-FDB-1/3/4)** — every stage yields non-empty light **and** sound **and** vibration
in `standard`; `stealth` yields light only (no sound, no vibration, no call); `discreet` yields
vibration only; `calm` contains no beep; a lower `seq` never moves the stage backwards.

**Flashcards (FR-BRF-5)** — Lakshmi (78, diabetic, hard of hearing, 2 falls) ranks Fall, Low blood
sugar, Stroke in that order; the CPR card is present in every response regardless of ranking; a
card lacking `reviewed_at` is never served.

## 3. Integration tests

* **Signature and replay (NFR-7)** — valid HMAC accepted; tampered body `401`; replayed `seq`
  `409`; `seq` gap accepted and recorded.
* **Merging (FR-INC-2)** — two presses 3 min apart produce **one** incident and two events; the
  partial unique index holds under concurrent inserts.
* **Staged disclosure (FR-BRF-1/2/3)** — `/briefing` is `403` before accept and `200` after; the
  pre-accept payload asserted to contain **no** name/address/health keys by deep key scan; access
  secrets absent for a volunteer and present for an on-duty guard; every success writes exactly one
  `audit_log` row.
* **Unverified incident (FR-TRG-6)** — HELP from an unknown number creates zero `dispatches` rows
  and one guard notification.
* **never_inform (FR-FAM-4)** — a flagged contact appears in no outbox row for the whole lifecycle.
* **Cancel + verification (FR-CAN-1..7)** — `safe` closes as false alarm and stands down; `need_help`
  continues at high priority with `possible_duress`; two no-answers resume the alert; while verifying,
  no new dispatches are created but accepted responders keep their briefing; a discreet profile gets
  **no** call to the person.
* **Drill (FR-SET-8)** — a drill produces device patterns and caregiver outbox rows and **zero**
  volunteer dispatches.
* **Team caps (FR-ALT-8)** — the 2nd accept on a fall case closes the case and sends "covered".
* **Family page (FR-FAM-1/2)** — no payload on any family route contains a volunteer lat/lng.
* **Rate limits** — 7th device post in a minute is `429`.

## 4. End-to-end scenarios (Playwright, `tools/sim` drives the device)

Mapped to the master document's §22.1 demo scenes and §16 playbook:

1. **The press** — pendant panic → dashboard lights up → two volunteer tabs show a Tier 1 full-screen
   alarm, a third shows Tier 2 → nobody accepts → upgrade at demo-scaled 30 s → accept → device goes
   green → family page shows "Priya (Verified, Nurse), ~3 min".
2. **Flashcards** — banner + three chips; tap Low blood sugar; dashboard shows "Volunteer reports
   possible low blood sugar".
3. **Forced cancel** — long-press cancel → dashboard shows verification → choose "no answer" → alert
   resumes at high priority, flagged possible duress, device stays quiet.
4. **No app at all** — registered number HELP → full incident; unknown number → guard only;
   bystander QR → family alerted, page shows no personal data.
5. **Becoming verified** — tutorial complete → two vouches → badge turns Verified → eligible for Tier 1.
6. **Outdoors** — pendant posts Wi-Fi-only location, then a GPS fix; the dashboard pin moves and the
   accuracy circle shrinks; walking updates follow.

Plus the ugly ones: **§16.4 #16** stalker (accept-without-moving is flagged), **§16.5 #22** 3 a.m.
nobody available (upgrade → widen → guard → 112 at 90 s), **§16.7 #30** no GPS indoors (Wi-Fi
estimate with an honest accuracy circle).

## 5. Quality gates

* `npm test` green, and **every `Must` requirement in `01-srs.md` is named by at least one test**
  (a coverage script asserts this and fails the build on a gap).
* No `console.log` in `apps/api/src` outside the logger.
* `tsc --noEmit` clean, ESLint clean.
* Accessibility: `axe` has zero critical violations on all four web faces; keyboard-only pass of the
  volunteer accept flow; the portal passes a screen-reader smoke test (NFR-10).

## 6. Manual field checklist (hardware, §18.9)

Wrong signature rejected · no network shows the failed pattern and retries · double press makes one
incident · cancel triggers verification · each stage plays the right pattern on real hardware ·
outdoor cold-start and hot-start times logged · indoor test where GPS fails and the Wi-Fi estimate
takes over · walking test where the dashboard pin follows · GPS fix compared against a phone ·
24-hour sleep drain · **press → first volunteer alert recorded** (NFR-1).

## 7. Explicitly untested in iteration 1

Real WhatsApp delivery, real Exotel IVR, real DigiLocker, FCM/APNs wake-up, pendant 4G, LoRa,
PostGIS. Each is behind a port with a contract test for the *simulated* adapter only — and is
labelled `SIMULATED` wherever it surfaces.
