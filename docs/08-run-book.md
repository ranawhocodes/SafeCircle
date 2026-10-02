# SafeCircle — run book and demo script

## 1. First run

Requires Node 22+ and a running PostgreSQL. No Docker, no PostGIS, no Redis.

```bash
npm install
createdb safecircle && createdb safecircle_test
cp .env.example .env
npm run db:reset && npm run db:seed
```

Then, in two terminals:

```bash
npm run dev         # API on :4000
npm run dev:web     # web faces on :5173
```

Open <http://localhost:5173>. The home page links to every face and explains what
is simulated.

### Demo speed

`DEMO_TIME_SCALE` in `.env` compresses every timer. `0.333` turns the 30-second
upgrade into 10 seconds and the 90-second escalation into 30. Every surface then
shows a **DEMO SPEED** chip, so a compressed timeline is never passed off as real.

## 2. Demo sign-ins

The API returns the one-time code in its response outside production, because no
SMS is sent. The sign-in panel fills it in for you.

| Role | Number | Who |
|------|--------|-----|
| Caregiver | `+919999900010` | Priya — manages Lakshmi, Arjun and Meera |
| Volunteer | `+919999900101` | Priya N — Verified, Nurse (ranks top on medical cases) |
| Volunteer | `+919999900102` | Arun M — Verified, First-aider, rides a two-wheeler |
| Volunteer | `+919999900105` | Sanjay K — unverified, Tier 2 only |
| Volunteer | `+919999900108` | Nithya P — tutorial unfinished, cannot go available |
| Guard | `+919999900001` | Ravi — on duty |
| Dashboard | `+919999900001` | the society desk / control room |

### The three seeded people

* **Lakshmi Raman, 78** — diabetic, hard of hearing, four falls in her history.
  `loud` feedback profile. The worked example from master document §14.2: her
  flashcards come out as Fall, Low blood sugar, Stroke.
* **Arjun Kumar, 9** — non-verbal, autistic, wanders. Go pendant on a bag tag.
  `calm` profile, protected: never left to an unverified volunteer, and a cancel
  from him alone can never close an alert.
* **Meera S** — `stealth` profile. A press is P1 and tells 112 at once, the
  pendant shows light only, she is never called, and her ex-partner is on the
  `never_inform` list.

## 3. The demo, in six scenes

Open three tabs: **/sim** (the button), **/volunteer**, **/dashboard**.

### Scene 1 — the press (2 min)

Sign the volunteer in as `+919999900101` and go available. On **/sim**, hold the
button for two seconds.

* the button fills white, then pulses blue with a two-tone chime: *"We got it"*
* the dashboard lights up with a P2 fall, located by GPS to about 8 m
* the volunteer gets a **Tier 1** full-screen alarm showing only the category,
  a banded distance and an age band — **no name, no address, no condition**
* slide to accept; the button turns green: *"Someone is on the way"*

### Scene 2 — the flashcards (1 min)

The mission screen leads with *"Hard of hearing: face her and speak slowly"*,
then offers three chips — Fall, Low blood sugar, Stroke — each saying why it was
suggested. CPR is always on screen. Tap **Low blood sugar**; the dashboard shows
*"Volunteer reports possible low blood sugar."*

### Scene 3 — the forced cancel (1 min)

**The scene that distinguishes SafeCircle.** Hold the button for four seconds.

* the incident moves to `cancel_verifying` — it does **not** close
* the button goes deliberately quiet: one white flash, no sound, no vibration
* on the dashboard, choose **No answer** twice
* the alert comes back at **P1**, flagged possible duress, every volunteer
  upgraded to Tier 1, and 112 told
* **the button still shows nothing.** An attacker standing next to her cannot
  tell that help is on the way

Run it headlessly with `npm run sim -- scene duress`.

### Scene 4 — no app at all (1 min)

```bash
# A registered number: a full incident.
curl -s localhost:4000/webhooks/whatsapp -H 'content-type: application/json' \
  -d '{"from":"+919999900011","text":"HELP"}'

# An unknown number: the guard desk only, never volunteers.
curl -s localhost:4000/webhooks/whatsapp -H 'content-type: application/json' \
  -d '{"from":"+918888800000","text":"HELP"}'
```

The second one creates an `unverified` incident with **zero** dispatch rows —
a fake HELP cannot be used to lure a volunteer somewhere.

### Scene 5 — the trust model (1 min)

Sign in as `+919999900105` (Sanjay, unverified). He is alerted at Tier 2 for the
same incident, and the API refuses to make him the only responder for Arjun.
`+919999900108` cannot go available at all until the tutorial is done.

### Scene 6 — outdoors (1 min)

```bash
npm run sim -- press --device GO-042 --place school   # saved Wi-Fi names the building
npm run sim -- press --device GO-021 --place mall     # no GPS, Wi-Fi estimate
npm run sim -- walk --device GO-021 --steps 6         # the map follows
```

On the dashboard the pin starts as a wide Wi-Fi circle and tightens to a GPS dot.
Walking far enough re-ranks the volunteers and alerts the new nearest ones.

**Say plainly on stage:** the 112 handoff and the verification call are
simulated, the pendant sends over a phone hotspot rather than its own 4G, timers
are compressed, and the web app reads location only while it is open.

## 4. The device simulator

```bash
npm run sim -- press  [--device GO-021] [--place home|street|mall|school|basement]
npm run sim -- cancel [--device GO-021]
npm run sim -- watch  [--device GO-021]      # follow the status like the firmware
npm run sim -- walk   [--device GO-021] [--steps 6]
npm run sim -- scene  duress
```

It signs with the real HMAC key and honours the real press timings, so it
exercises the authenticity path rather than bypassing it.

## 5. Tests

```bash
npm test              # 160 tests: 107 domain, 53 integration
npm run test:shared   # pure domain rules, no database
npm run test:api      # routes against a real throwaway Postgres schema
```

Integration tests run serially (`--test-concurrency=1`) because they share one
test schema which each file resets.

## 6. Firmware

`firmware/home-button` and `firmware/go-pendant` are Arduino sketches for the
ESP32, with the shared press-timing and pattern-player code in
`firmware/shared/safecircle.h`. Copy `secrets.h.example` to `secrets.h` and fill
in the Wi-Fi details, the API address and the device key.

The firmware is deliberately dumb: it measures a press, signs a payload, sends
it, and plays whatever pattern the server returns. Changing someone's feedback
profile never means reflashing their button.

Build order and the field test plan are in master document §18.9.

## 7. Troubleshooting

| Symptom | Cause |
|---------|-------|
| `Unsupported state or unable to authenticate data` | The seed and the server used different `FIELD_ENCRYPTION_KEY` values. Run both with the same `.env`, then `npm run db:reset && npm run db:seed`. |
| A press returns 409 | The sequence number was replayed. The simulator persists its counter in the temp directory; delete `safecircle-sim-sequences.json` to reset. |
| No volunteers alerted | Check the `dispatched` event's `excluded` list on the dashboard — it names the reason for every volunteer who was skipped. |
| The volunteer app gets no alert | It only receives pushes while the tab is open; that is a real limit of the PWA, and why the pilot needs a native app. |
