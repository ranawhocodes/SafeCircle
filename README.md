# SafeCircle

A neighbourhood safety network that works **even when the person in trouble cannot use a
smartphone**. It is the "first five minutes" layer that extends 112 (India ERSS) — never a
replacement for it.

> **No app for victims. A responder app for volunteers.**

A child, senior or person with a disability presses one physical button, or a family member sends
`HELP` on WhatsApp. Within seconds the backend knows who they are and where they are, alerts the
nearest verified volunteers, the society guard and the family at the same time, and escalates to
112 if nobody responds. The button tells the person — by light, sound and vibration — that help is
coming. Volunteers arrive already knowing who they are helping and how.

## Honesty notice

This is a prototype. The following are **simulated and labelled `SIMULATED` everywhere they
appear** — in the UI and in the API payload:

* the 112 / ERSS handoff (no real integration exists, and none is claimed)
* the cancel verification voice call
* the Go pendant's own 4G link (the demo pendant sends over a phone hotspot)
* WhatsApp / SMS delivery, DigiLocker ID checks, FCM/APNs wake-up push

Demo timers are compressed and every surface says "demo speed". SafeCircle never promises that a
volunteer will come.

## Documentation

| Document | What it covers |
|----------|----------------|
| [01-srs.md](docs/01-srs.md) | Requirements, traced to success criteria C1–C5 and features F1–F45 |
| [02-architecture.md](docs/02-architecture.md) | Stack decisions, component map, request flow, disclosure guard, security |
| [03-data-model.md](docs/03-data-model.md) | Tables, invariants, retention, PostGIS migration path |
| [04-api-contract.md](docs/04-api-contract.md) | Every endpoint, auth scheme, error shape, rate limits |
| [05-test-plan.md](docs/05-test-plan.md) | Test levels, the failure-path tests that matter, quality gates |
| [06-backlog-and-phases.md](docs/06-backlog-and-phases.md) | All 45 features, phase plan, gates, KPI instrumentation |
| **[09-feature-status.md](docs/09-feature-status.md)** | **What is built, what is pending, and how each remaining feature will be built** |
| [07-decision-log.md](docs/07-decision-log.md) | Every §26 open question: decided, default or still open |
| [08-run-book.md](docs/08-run-book.md) | How to run it, the six-scene demo script, troubleshooting |
| [source-document-v2.txt](docs/source-document-v2.txt) | Extracted text of the master document |

## Quick start

Requires Node 22+ and a running PostgreSQL. No Docker, no PostGIS, no Redis.

```bash
npm install
createdb safecircle && createdb safecircle_test
cp .env.example .env
npm run db:reset && npm run db:seed
npm run dev      # API on :4000
npm run dev:web  # web faces on :5173
```

Open <http://localhost:5173>. The [run book](docs/08-run-book.md) has the demo
sign-ins and a six-scene script.

## What is here

```
packages/shared   the domain rules every layer agrees on - severity, the state
                  machine, timers, location fusion, ranking, feedback patterns,
                  flashcard prediction, staged disclosure. No I/O, 107 tests.
apps/api          Fastify + PostgreSQL: the incident engine, tiered dispatch,
                  persisted timers, the disclosure guard, simulated providers.
apps/web          React: the volunteer PWA, family status page, guard and
                  authority dashboard, caregiver portal, bystander page, and a
                  device simulator that stands in for the hardware.
firmware          ESP32 Arduino sketches for the Home button and Go pendant.
tools/sim         a headless device simulator for scripted demos.
```

## Status

**Iteration 1 is complete: all 19 `Must` features are built and tested.**
160 automated tests pass. 30 of the master document's 54 features are done,
5 are partial and 19 are not started —
[09-feature-status.md](docs/09-feature-status.md) has the full audit, the known
gaps in what is built, and the implementation approach for everything pending.

```bash
npm test
```
