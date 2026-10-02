# SafeCircle — API contract

Base: `http://localhost:4000` (demo). All bodies JSON. Times are ISO-8601 UTC.
Any response that reflects a simulated capability carries `"simulated": true` (NFR-14).

## Auth

| Caller | Scheme |
|--------|--------|
| Device | `X-SafeCircle-Signature: <hex HMAC-SHA256>` over the canonical body + per-device key |
| Caregiver / portal | bearer session from phone + OTP |
| Volunteer / guard | bearer session from phone + OTP |
| Family status page | capability token in the URL path, single incident, expires with the incident |
| Dashboard | bearer session with `dashboard` scope |
| Provider webhook | provider signature header, verified per provider |

## 1. Device (Face A)

### `POST /api/sos/device`
```json
{ "device_id":"GO-021","event":"panic","seq":112,"battery":76,
  "location":{"gps":{"lat":13.0827,"lng":80.2707,"acc_m":8,"age_s":3},
              "wifi":[{"bssid":"a4:2b:..","rssi":-61}],
              "cell":{"mcc":404,"mnc":0,"tac":0,"cell_id":0},
              "known_place":null} }
```
`event` ∈ `panic | cancel | silent_panic | location_update | heartbeat | low_battery`.
→ `202 { "incident_id":"...", "stage":"received", "seq":1, "poll_after_ms":3000 }`
→ `401` bad signature · `409` replayed `seq` · `404` unclaimed device. Failures never say which.

### `GET /api/device/:device_id/status`
→ `200 { "stage":"accepted", "seq":4, "pattern":{ "light":{...},"sound":{...},"vibration":{...} },
         "poll_after_ms":3000, "incident_open":true }`
The `pattern` is already transformed for the person's feedback profile, so firmware stays dumb.

### `POST /api/device/:device_id/location` — updates while an incident is open.
### `POST /api/device/:device_id/heartbeat` — link health + battery, no location.

## 2. Messaging triggers (Face A)

`POST /webhooks/whatsapp` · `POST /webhooks/sms` · `POST /webhooks/voice`
Signature verified, then normalised to the same pipeline. An unknown sender creates an
`unverified` incident routed to the guard desk only (FR-TRG-6).

`POST /api/bystander/:qr_code/alert` — `{ "lat","lng","accuracy_m","note" }`.
The matching `GET /api/bystander/:qr_code` returns **only** `{"prompt":"This person may need help.","can_alert_family":true}` — never name, address or medical data (FR-TRG-8).

## 3. Portal (caregiver)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/otp/request` · `/api/auth/otp/verify` | phone sign-in |
| GET POST PATCH | `/api/portal/people` · `/api/portal/people/:id` | profile CRUD |
| POST | `/api/portal/people/:id/devices/claim` | `{device_id, claim_code}` |
| POST | `/api/portal/people/:id/sender-numbers` | trigger numbers |
| PUT | `/api/portal/people/:id/family-contacts` | ordered chain |
| POST | `/api/portal/people/:id/consent` | DPDP consent record |
| POST | `/api/portal/people/:id/drill` | drill press — no volunteer alerted |
| GET | `/api/portal/people/:id/kit` | fridge QR, wallet card, bystander sticker payloads |

## 4. Volunteer (Face B)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/volunteer/availability` | `{mode, until?}` |
| POST | `/api/volunteer/location` | zone update, or incident fix when `incident_id` given |
| GET | `/api/volunteer/alerts` | open alerts for me — **pre-accept view only** |
| POST | `/api/incidents/:id/respond` | `{response:"accepted"\|"declined", reason?}` |
| GET | `/api/incidents/:id/briefing` | **403 unless this volunteer accepted** (FR-BRF-1) |
| GET | `/api/incidents/:id/flashcards` | top-3 ranked + always-on CPR + symptom picker |
| POST | `/api/incidents/:id/card-selection` | `{card_key}` → sets `volunteer_observed_type` |
| POST | `/api/incidents/:id/status` | `on_my_way \| arrived \| need_backup \| handed_to_ambulance \| resolved \| cant_attend` |
| POST | `/api/volunteer/danger` | volunteer's own SOS |
| GET | `/api/volunteer/me` | trust level, badges, pending votes |
| POST | `/api/votes` | community vouch |

**Pre-accept payload** (the whole object — there is nothing to strip):
```json
{ "incident_id":"...","tier":1,"category":"medical","age_band":"75+",
  "distance_band_m":300,"eta_s":210,"responders_so_far":0,
  "safety_notice":null,"stealth":false,"expires_at":"..." }
```

## 5. Family

`GET /api/family/:token/status` → received → accepted (responder name, badge, skill, ETA) →
arrived → resolved. Never a volunteer position (FR-FAM-2).
`POST /api/family/:token/on-my-way` · `POST /api/family/:token/false-alarm` (runs verification —
does **not** cancel) · `POST /api/family/:token/share-medical-summary`.
`WS /ws/family/:token`.

## 6. Guard and dashboard

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/guard/shift` | on/off duty |
| GET | `/api/guard/incidents/:id` | guard view incl. access secrets (audited) |
| POST | `/api/guard/incidents/:id/tasks/:task` | gate opened, lift held, doorstep check done |
| GET | `/api/dashboard/incidents` | list + filters, stale flags |
| GET | `/api/dashboard/incidents/:id` | full timeline, dispatch table with rank inputs, locations with source+accuracy |
| POST | `/api/dashboard/incidents/:id/verification-outcome` | **demo**: drive the simulated IVR `{outcome}` |
| GET | `/api/dashboard/incidents/:id/handoff-112` | the packet, `"simulated": true` |
| POST | `/api/dashboard/incidents/:id/close` | `{outcome}` |
| GET | `/api/dashboard/outbox` | everything the simulated providers "sent" |
| WS | `/ws/dashboard` | live incident stream |

## 7. Error shape

```json
{ "error": { "code":"briefing_not_authorised","message":"Accept the alert first." } }
```
Codes are stable strings; messages are human and localisable. 4xx never leaks whether a device id,
phone number or person exists.

## 8. Rate limits

Device `6/min` per device · OTP `5/hour` per phone · bystander `3/hour` per QR ·
volunteer respond `30/min` · webhooks per provider contract. Exceeded → `429` with `Retry-After`.
