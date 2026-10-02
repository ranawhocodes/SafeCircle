# SafeCircle — Architecture

> One backend owns every incident. Every channel is only an input or an output around it.
> Privacy rules such as "address only after accepting" are enforced **on the server**, never by
> hiding fields in a client.

## 1. Chosen stack (resolves master document §19.1 "Decision needed")

| Concern | Decision | Why |
|---------|----------|-----|
| Language | **TypeScript** end to end (Node 25) | one language across API, web, shared domain and device simulator |
| API | **Fastify** | fast, first-class JSON schema validation, native hooks for auth/audit |
| DB | **PostgreSQL 18** (already running locally) | the document's choice; transactional incident state |
| Geo | **bounding box + haversine in SQL**, no PostGIS | PostGIS is not installed and is not needed at pilot scale; `docs/03-data-model.md` documents the exact migration |
| Timers | **in-process scheduler persisted in `incident_timers`** | no Redis to install; timers rehydrate on restart (NFR-12) |
| Realtime | **WebSocket** (`ws`) for dashboard/family/volunteer; **HTTP polling** for devices | the document's own demo fallback for devices; MQTT is the pilot upgrade |
| Web | **React 19 + Vite + TypeScript**, one app, four route trees | shares components and types; volunteer tree is the PWA |
| Maps | **Leaflet + OpenStreetMap** | zero cost, offline-tileable |
| Firmware | **Arduino C++ for ESP32** (PlatformIO layout) | matches the BOM in §18.8 |
| Tests | **node:test** + **supertest**-style inject, **Playwright** for the web faces | no extra runtime |

### Deliberately deferred

MQTT broker, Redis, PostGIS, FCM/APNs, Exotel, WhatsApp Business API, DigiLocker KYC. Each sits
behind a **provider port** (§4) with a `SimulatedX` implementation that is labelled `SIMULATED`
in the API payload, so swapping in the real provider is a one-file change.

---

## 2. Component map

```
                    FACE A (no app)                              FACE B (app)
  ┌──────────────┐  ┌──────────────┐  ┌───────────┐     ┌──────────────┐  ┌───────────┐
  │ Home button  │  │  Go pendant  │  │ WhatsApp  │     │ Volunteer    │  │  Guard    │
  │ ESP32 + WiFi │  │ +GPS +4G     │  │ SMS / IVR │     │ PWA          │  │  role     │
  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘     └──────┬───────┘  └─────┬─────┘
         │  signed POST    │                │ webhook          │  REST + WS     │
         └────────┬────────┘                │                  └────────┬───────┘
                  ▼                          ▼                           ▼
         ┌───────────────────────────────────────────────────────────────────────┐
         │                        INGEST GATEWAY (Fastify)                        │
         │  signature + sequence check · webhook signature · rate limit · normalise│
         └───────────────────────────────┬───────────────────────────────────────┘
                                         ▼  NormalisedEvent
         ┌───────────────────────────────────────────────────────────────────────┐
         │                           INCIDENT ENGINE                              │
         │  identify → locate → merge(10 min) → score severity → state machine     │
         │  → timer schedule → event log (append-only)                            │
         └───┬──────────────┬──────────────┬──────────────┬──────────────┬────────┘
             ▼              ▼              ▼              ▼              ▼
      ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
      │ DISPATCH   │ │ LOCATION   │ │NOTIFICATION│ │VERIFICATION│ │  CONTENT   │
      │ tiers,     │ │ fusion,    │ │ app push,  │ │ cancel IVR,│ │ flashcards,│
      │ ranking,   │ │ accuracy,  │ │ WhatsApp,  │ │ duress,    │ │ tutorials, │
      │ upgrade,   │ │ geo search │ │ SMS, voice,│ │ ID checks, │ │ versioned  │
      │ team caps  │ │ retention  │ │ 112 packet │ │ vote engine│ │ + dated    │
      └────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘
             │                             │
             ▼                             ▼
      ┌────────────────────────────────────────────────┐   ┌─────────────────────┐
      │  DISCLOSURE GUARD  (single choke point)         │   │  AUDIT LOG          │
      │  pre-accept view / accepted view / guard view   │──▶│  append-only        │
      └────────────────────────────────────────────────┘   └─────────────────────┘
             │
             ▼  WebSocket + REST
      ┌────────────────────────────────────────────────────────────────┐
      │  WEB: setup portal · family status · volunteer PWA · dashboard │
      └────────────────────────────────────────────────────────────────┘
```

---

## 3. Repository layout

```
SafeCircle/
├── docs/                     SRS, architecture, data model, API, test plan, backlog, decisions
├── packages/shared/           domain rules shared by API, web and simulator
│   └── src/
│       ├── types.ts           NormalisedEvent, Incident, Severity, DeviceStage, TrustLevel…
│       ├── severity.ts        FR-INC-3 rules
│       ├── states.ts          FR-INC-4 state machine + legal transitions
│       ├── timers.ts          FR-INC-6 schedule + demo time-scale
│       ├── feedback.ts        FR-FDB-1/4 pattern table × profile transforms
│       ├── geo.ts             haversine, bbox, ETA, accuracy comparison
│       ├── ranking.ts         FR-ALT-5 effective-ETA score
│       ├── fusion.ts          FR-INC-9 source precedence + never-degrade rule
│       └── flashcards.ts      FR-BRF-5 weighted prediction
├── apps/api/
│   └── src/
│       ├── db/                pool, migrations/, repositories/
│       ├── domain/            engine orchestration over packages/shared
│       ├── services/          dispatch, location, notification, verification, content
│       ├── providers/         ports + Simulated* implementations
│       ├── routes/            sos, device, volunteer, incidents, webhooks, portal, family, dashboard, ws
│       ├── scheduler/         persisted timer runner
│       ├── security/          hmac, disclosure guard, audit, field encryption
│       └── seed/              demo personas, volunteers, society, cards
├── apps/web/                  React + Vite — /portal /family/:token /volunteer /dashboard /bystander/:code /sim
├── firmware/
│   ├── home-button/           ESP32 + Wi-Fi
│   ├── go-pendant/            ESP32 + GNSS (+4G in pilot)
│   └── shared/                press timing, pattern player, signing, store-and-forward
└── tools/sim/                 headless device simulator (CLI) used by tests and the demo
```

---

## 4. Provider ports

Each port is an interface in `apps/api/src/providers/`. Iteration 1 ships the simulated adapter;
the real adapter is a drop-in.

| Port | Simulated now | Real later |
|------|---------------|-----------|
| `VoicePort` | dashboard-driven IVR outcome (`safe` / `need_help` / `no_answer` / `duress`) | Exotel Voice v1 + DTMF webhooks |
| `MessagingPort` | in-memory outbox rendered in the dashboard and `/sim` | WhatsApp Business utility templates + SMS |
| `PushPort` | WebSocket to the open PWA | FCM high-priority + APNs (incl. location pushes) |
| `AuthorityPort` | 112 handoff packet rendered on the dashboard, stamped `SIMULATED` | state PSAP / ERSS-112 integration |
| `GeolocationPort` | deterministic offline estimator over seeded Wi-Fi BSSIDs and cells | Google Geolocation API |
| `IdentityPort` | admin-approved mock | DigiLocker via KYC provider |

**NFR-14 is structural:** every simulated response carries `"simulated": true`, and the web layer
renders a `SIMULATED` chip wherever that flag appears. A simulated capability can never be
presented as working.

---

## 5. Request flow: press → first alert (NFR-1, target < 10 s)

1. `POST /api/sos/device` — body carries `device_id`, `event`, `seq`, `battery`, optional
   `location`, `signature`.
2. **Ingest**: constant-time HMAC compare over the canonical body; reject `seq <= last_seq`
   (replay); per-device rate limit. Rejections are logged and answered `401`/`409` **without**
   revealing which check failed.
3. **Normalise** → `{source:'device', sender:'GO-021', type:'panic', at, location?}`.
4. **Identify** `device → person` (single indexed read).
5. **Locate** — `fuseLocation()` over `{gps, wifi, cell, known_place, registry}`. A Wi-Fi/cell list
   is resolved through `GeolocationPort`; **this call is never awaited on the critical path** — the
   registry/known-place/last-GPS estimate dispatches now, the resolved estimate arrives as an update.
6. **Merge** — open incident for this person inside 10 min? join it, append an event, return.
7. **Score severity** — deterministic rules (`packages/shared/severity.ts`).
8. **Persist** incident + first event in one transaction, then **return `202` to the device
   immediately** so the `received` pattern fires early.
9. **Dispatch (async, same tick)** — candidate query (bbox prefilter → haversine → availability →
   trust → opt-outs) → rank → Tier 1 = nearest 3 verified, Tier 2 = the rest → fan out to
   volunteers, guard and family **in parallel**.
10. **Schedule timers** — 30 s upgrade, 60 s family call, 90 s escalate (× demo scale), persisted.

Step 8 before step 9 is deliberate: the person feels "we got it" before the network finishes
fanning out.

---

## 6. The disclosure guard (FR-BRF-1/2/3)

One function, called by every read path that touches a person:

```ts
buildPersonView(person, viewer, incident) → PreAcceptView | AcceptedView | GuardView
```

* `PreAcceptView` — category, age band, coarse distance, ETA, responders-so-far. **No name, no
  address, no medical data exist in the returned object.**
* `AcceptedView` — identity, location, handling notes, health summary. Not access secrets.
* `GuardView` — `AcceptedView` + decrypted access secrets.

Rules: viewer must have an `accepted` dispatch row on *this* incident; guard role must be on duty
for the owning society; every call writes `audit_log(viewer, incident, person, fields, at)`. The
briefing route has no "include everything" escape hatch, so a client bug cannot leak.

---

## 7. Timer design

`incident_timers(incident_id, kind, fire_at, fired_at, cancelled_at)`.

A single runner ticks every 250 ms, claims due rows with
`UPDATE … SET fired_at = now() WHERE fire_at <= now() AND fired_at IS NULL RETURNING *`
(atomic claim, so it is safe if a second process ever runs), and dispatches to a handler per kind:
`upgrade_all`, `family_voice_call`, `escalate_112`, `still_coming`, `on_scene_checkin`,
`verification_retry`, `verification_deadline`.

`DEMO_TIME_SCALE` (default `1`, demo `0.333`) multiplies every interval at schedule time. The scale
in force is stored on the incident, so a dashboard can label the timeline "demo speed" truthfully.

---

## 8. Security

| Threat | Control |
|--------|---------|
| Device spoofing / replay | per-device HMAC-SHA256 key + strictly increasing `seq` |
| Stolen device claimed by someone else | single-use `claim_code`, burned on first claim |
| Stalker volunteer harvesting addresses | staged disclosure server-side; protected profiles need a verified responder; accept-without-moving flagged; every view audited |
| Fake HELP luring a volunteer | unverified incidents go to the guard desk only, never to volunteers |
| Spoofed GPS to look closer | mock-location flag + network cross-check; device attestation is Roadmap |
| Webhook forgery | provider signature verified; unsigned calls rejected |
| Data at rest | field-level AES-256-GCM for medical notes, access codes, ID refs, location fixes |
| Number harvesting | masked calling; no phone number ever crosses between parties |
| Abuse of status | `never_inform` enforced in the notification service, not the UI |

---

## 9. What is NOT built in iteration 1

Native app wake-up location (FR-VOL-10), real verification calls, DigiLocker (FR-VOL-12), real
ERSS-112, pendant 4G link, LoRa, fall detection, voice prompts, masked calling (FR-VOL-11),
mass-incident mode, device attestation. All are tracked in `06-backlog-and-phases.md` and are
**never shown as working**.
