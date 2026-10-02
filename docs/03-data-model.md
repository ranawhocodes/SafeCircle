# SafeCircle — Data model

Authoritative DDL lives in `apps/api/src/db/migrations/`. This document explains *why* each table
looks the way it does; where the two disagree, the migration wins.

## 1. Principles

1. **Data minimisation (DPDP, §5.2).** Every column must change how someone responds. Each table
   below names the responder decision it serves.
2. **Append-only truth.** `incident_events` and `audit_log` are never updated or deleted; current
   state on `incidents` is a projection you could rebuild from events.
3. **Encrypt the harmful.** Medical notes, access secrets, ID references and raw location fixes are
   AES-256-GCM at the column level (`enc_` prefix, `bytea`).
4. **No movement history.** `volunteer_zones` holds *one* coarse cell per volunteer with
   `updated_at` — an UPDATE, never an INSERT. Precise fixes live only in incident-scoped tables.
5. **Deletion is a product feature.** Every subject table carries `deleted_at` and is reachable
   from a caregiver/volunteer "delete my data" action.

## 2. Core entities

### People and their circle

| Table | Purpose | Notable columns |
|-------|---------|-----------------|
| `people` | the protected person | `name`, `responds_to_name`, `photo_url`, `age_band`, `languages[]`, `society_id`, `address`, `flat`, `landmark`, `lat`, `lng`, `feedback_profile`, `pre_send_countdown_s`, `safe_pin_hash`, `duress_pin_hash`, `enc_health`, `enc_handling`, `protected` (bool), `wandering_history`, `responder_preference` |
| `person_access_secrets` | gate/door code, spare-key holder | `enc_payload` — **guard role only**, separate table so a careless `SELECT *` on `people` cannot leak it |
| `caregivers` | a person who manages others | `phone`, `name`, `verified_at` |
| `caregiver_links` | caregiver ↔ person, many-to-many | `role`, `can_cancel`, `is_primary` |
| `sender_numbers` | phone → person routing for FR-TRG-5/6/7 | `phone`, `person_id`, `role` (`self`/`caregiver`), `confirmed_at`, `can_cancel`, `never_inform` |
| `family_contacts` | ordered escalation chain | `order_index`, `phone`, `relation`, `never_inform` |
| `consents` | DPDP evidence | `subject`, `granted_by`, `capacity_basis` (`self`/`parent`/`lawful_guardian`), `scope[]`, `granted_at`, `withdrawn_at` |

`never_inform` appears on both `sender_numbers` and `family_contacts` because §16.3 #14 is a
domestic-violence case: the abuser may be a registered contact. The notification service filters on
it; no UI is trusted to hide it.

### Devices

`devices` — `device_id` (PK, human-readable e.g. `GO-021`), `person_id`, `type` (`home`|`go`),
`enc_hmac_key`, `claim_code`, `claimed_at`, `status`, `last_seen_at`, `battery_pct`, `last_seq`,
`last_gps_at`, `sim_id`, `firmware_version`.

`known_places` — `person_id`, `label` ("school", "day centre"), `wifi_bssids[]`, `lat`, `lng`,
`radius_m`. A pendant that sees a saved BSSID resolves to a building with no GPS at all (FR-SET-11).

`last_seq` on the device row is the replay guard (NFR-7). `claim_code` is burned on first claim so a
stolen or second-hand button cannot be re-paired (FR-SET-3).

### Society and guards

`societies` (name, address, centroid, verifier_id) · `guards` (society_id, name, phone, on_duty,
desk_token) · `society_admins`.

### Volunteers

| Table | Purpose |
|-------|---------|
| `volunteers` | `trust_level` (0–4), `name`, `phone`, `photo_url`, `dob`, `languages[]`, `home_lat/lng`, `occupation`, `transport`, `max_distance_m`, `opted_out_case_types[]`, `quiet_hours`, `reliability_score`, `availability_mode`, `available_until`, `tutorial_completed_at`, `suspended_at` |
| `volunteer_skills` | `skill`, `credential_ref`, `verified_at`, `expires_at` — a lapsed certificate silently removes the badge and its ranking bonus |
| `volunteer_duty_windows` | repeating schedule rows |
| `volunteer_zones` | **one row per volunteer**: `cell_lat`, `cell_lng` (~1 km), `updated_at`. UPDATE only — no history (FR-VOL-10 privacy rule, enforced now even though wake-up push is Roadmap) |
| `volunteer_fixes` | incident-scoped precise fixes: `incident_id`, `lat`, `lng`, `accuracy_m`, `at`. Deleted 72 h after the incident closes |
| `vouches` | `candidate_id`, `voter_id`, `choice`, `enc_private_reason`, `at` |

### Incidents

`incidents` — `id`, `person_id` (nullable for unverified), `source`, `severity`, `state`,
`escalated_at`, `flags` (jsonb: `drill`, `unverified`, `possible_duress`, `raised_by_caregiver`,
`possible_abduction`, `stealth`), `opened_at`, `closed_at`, `outcome`,
`volunteer_observed_type`, `demo_time_scale`, `search_radius_m`, `team_cap`.

`incident_events` — append-only: `incident_id`, `seq`, `kind`, `actor_type`, `actor_id`,
`payload` jsonb, `at`. Every state change, dispatch, decline reason, timer firing, status tap, card
selection and disclosure appears here. This is what the dashboard timeline and NFR-13 read.

`person_locations` — `incident_id`, `lat`, `lng`, `accuracy_m`, `source`
(`gps`|`wifi`|`cell`|`known_place`|`registry`|`bystander`), `speed_mps`, `at`. Insert-only during an
incident; the *current* fused position is the highest-precedence fresh row (FR-INC-9).

`incident_timers` — `incident_id`, `kind`, `fire_at`, `fired_at`, `cancelled_at`. The atomic claim
query is in `02-architecture.md` §7.

`dispatches` — `incident_id`, `volunteer_id`, `tier`, `sent_at`, `upgraded_at`, `response`
(`accepted`|`declined`|null), `decline_reason`, `responded_at`, `rank_score`, `rank_inputs` jsonb.
`rank_inputs` is why FR-ALT-5's "every dispatch decision is logged so it can be explained" is true
and not aspirational.

`verifications` — `incident_id`, `channel`, `target`, `attempt`, `outcome`
(`safe`|`need_help`|`no_answer`|`wrong_pin`|`duress`), `simulated`, `at`.

### Content and audit

`cards` — `key`, `version`, `title`, `group`, `body` jsonb (check / steps / do-not / when-112 /
tell-the-crew), `source`, `reviewed_by`, `reviewed_at`, `review_due`. A card with no
`reviewed_at` cannot be served (FR-BRF-7).

`card_selections` — `incident_id`, `volunteer_id`, `card_key`, `at`, `superseded_at`.

`audit_log` — append-only `viewer_type`, `viewer_id`, `person_id`, `incident_id`, `fields[]`,
`view_kind` (`pre_accept`|`accepted`|`guard`), `at`.

`outbox` — the simulated `MessagingPort`/`VoicePort`/`AuthorityPort` record: `channel`, `to`,
`template`, `payload`, `simulated`, `at`. This is what `/sim` and the dashboard render so a judge
can see exactly what *would* have been sent.

## 3. Key invariants (enforced in DB where possible)

* `devices.last_seq` is monotonic — enforced in the ingest transaction, not by trust.
* At most one open incident per person: partial unique index on `(person_id)` where
  `closed_at IS NULL` — this makes FR-INC-2 merging a database guarantee, not a race.
* `dispatches` unique on `(incident_id, volunteer_id)` — a volunteer is alerted once per incident,
  then *upgraded* in place.
* `incident_events.seq` unique per incident — gives the device its never-go-backwards ordering
  (FR-FDB-3).
* A `cancel_verifying` incident cannot reach `resolved` without a `verifications` row.

## 4. Geo query (no PostGIS)

Candidate search is two steps:

```sql
-- 1. cheap bounding box on indexed lat/lng
WHERE lat BETWEEN $lat - $dlat AND $lat + $dlat
  AND lng BETWEEN $lng - $dlng AND $lng + $dlng
-- 2. exact haversine in the same query, ordered
ORDER BY 6371000 * 2 * asin(sqrt(...)) ASC
```

`dlat = radius_m / 111320`, `dlng = radius_m / (111320 * cos(radians(lat)))`. Correct and fast to
tens of thousands of volunteers.

## 5. Retention jobs

| Data | Kept | Job |
|------|------|-----|
| `volunteer_fixes`, `person_locations` | 72 h after `incidents.closed_at` | `purgeFixes` |
| responder chat, masked-call logs | 7 d | `purgeComms` |
| `incidents`, `incident_events` | 1 y, then anonymised in place | `anonymiseIncidents` |
| `audit_log` | 1 y | `purgeAudit` |

Each runs hourly, logs counts, and is unit-tested with a frozen clock.

## 6. PostGIS migration path (when a pilot needs it)

1. `CREATE EXTENSION postgis;`
2. Add `geog geography(Point,4326)` to `people`, `volunteer_zones`, `person_locations`; backfill
   from `lat`/`lng`; add a trigger to keep them in sync.
3. `CREATE INDEX … USING GIST (geog);`
4. Swap the two queries in `apps/api/src/db/repositories/geo.ts` for `ST_DWithin` / `ST_Distance`.

Only that one file changes — nothing else in the codebase reads `lat`/`lng` for search.
