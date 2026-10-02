-- SafeCircle initial schema.
-- See docs/03-data-model.md for the reasoning behind each table.
-- No PostGIS: candidate search is a bounding box on indexed lat/lng plus
-- haversine in the same query. docs/03-data-model.md section 6 has the
-- migration path for when a pilot needs real spatial indexing.

-- ---------------------------------------------------------------------------
-- Societies, guards, admins
-- ---------------------------------------------------------------------------
CREATE TABLE societies (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  address       text,
  lat           double precision,
  lng           double precision,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guards (
  id            text PRIMARY KEY,
  society_id    text NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  phone         text NOT NULL,
  on_duty       boolean NOT NULL DEFAULT false,
  -- Capability token for the guard desk web dashboard (loud alarm screen).
  desk_token    text UNIQUE,
  order_index   int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guards_society_duty_idx ON guards (society_id, on_duty);

-- ---------------------------------------------------------------------------
-- People (Face A)
-- ---------------------------------------------------------------------------
CREATE TABLE people (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  responds_to_name      text,
  photo_url             text,
  age_band              text NOT NULL
                          CHECK (age_band IN ('0-12','13-17','18-59','60-74','75+')),
  languages             text[] NOT NULL DEFAULT '{}',
  society_id            text REFERENCES societies(id) ON DELETE SET NULL,
  address               text,
  flat                  text,
  landmark              text,
  lat                   double precision,
  lng                   double precision,
  feedback_profile      text NOT NULL DEFAULT 'standard'
                          CHECK (feedback_profile IN ('standard','loud','calm','child',
                                 'visual_first','touch_and_sound','discreet','stealth')),
  -- Decision #1: send instantly by default; a per-person countdown exists for
  -- people who press by accident often (section 6.1).
  pre_send_countdown_s  int NOT NULL DEFAULT 0 CHECK (pre_send_countdown_s BETWEEN 0 AND 5),
  -- Encrypted at the column level (AES-256-GCM). Never logged, never in a
  -- pre-accept payload.
  enc_health            bytea,
  enc_handling          bytea,
  -- True for children, cognitive disabilities and discreet/stealth cases.
  -- An unverified volunteer may never be the sole responder (FR-ALT-7).
  protected             boolean NOT NULL DEFAULT false,
  wandering_history     boolean NOT NULL DEFAULT false,
  responder_preference  text CHECK (responder_preference IN ('woman_first')),
  has_own_phone         boolean NOT NULL DEFAULT false,
  own_phone             text,
  safe_pin_hash         text,
  duress_pin_hash       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX people_bbox_idx ON people (lat, lng) WHERE deleted_at IS NULL;
CREATE INDEX people_society_idx ON people (society_id);

-- Separate table so a careless SELECT * on people can never leak door codes.
CREATE TABLE person_access_secrets (
  person_id     text PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  enc_payload   bytea NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE caregivers (
  id            text PRIMARY KEY,
  phone         text NOT NULL UNIQUE,
  name          text,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE caregiver_links (
  caregiver_id  text NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  person_id     text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'caregiver',
  can_cancel    boolean NOT NULL DEFAULT true,
  is_primary    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (caregiver_id, person_id)
);

-- Phone number -> person routing for WhatsApp/SMS triggers (FR-TRG-5/6/7).
CREATE TABLE sender_numbers (
  phone         text NOT NULL,
  person_id     text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('self','caregiver')),
  confirmed_at  timestamptz,
  can_cancel    boolean NOT NULL DEFAULT false,
  -- Section 16.3 #14: the abuser may be a registered contact. Enforced in the
  -- notification service, never in the UI.
  never_inform  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (phone, person_id)
);
CREATE INDEX sender_numbers_phone_idx ON sender_numbers (phone);

CREATE TABLE family_contacts (
  id            bigserial PRIMARY KEY,
  person_id     text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  order_index   int NOT NULL,
  name          text,
  phone         text NOT NULL,
  relation      text,
  never_inform  boolean NOT NULL DEFAULT false,
  UNIQUE (person_id, order_index)
);

-- DPDP Act evidence (Rules 10 and 11): who consented, on what basis.
CREATE TABLE consents (
  id              bigserial PRIMARY KEY,
  person_id       text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  granted_by      text NOT NULL,
  capacity_basis  text NOT NULL CHECK (capacity_basis IN ('self','parent','lawful_guardian')),
  scope           text[] NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  withdrawn_at    timestamptz
);

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------
CREATE TABLE devices (
  device_id         text PRIMARY KEY,
  person_id         text REFERENCES people(id) ON DELETE SET NULL,
  type              text NOT NULL CHECK (type IN ('home','go')),
  enc_hmac_key      bytea NOT NULL,
  -- Burned on first claim so a stolen or second-hand button cannot be re-paired.
  claim_code        text,
  claimed_at        timestamptz,
  status            text NOT NULL DEFAULT 'new',
  last_seen_at      timestamptz,
  battery_pct       int,
  -- Replay guard (NFR-7): a device event with seq <= last_seq is rejected.
  last_seq          bigint NOT NULL DEFAULT 0,
  last_gps_at       timestamptz,
  sim_id            text,
  firmware_version  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_person_idx ON devices (person_id);

-- A saved, named Wi-Fi network resolves to a building with no GPS at all.
CREATE TABLE known_places (
  id            bigserial PRIMARY KEY,
  person_id     text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  label         text NOT NULL,
  wifi_bssids   text[] NOT NULL DEFAULT '{}',
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  radius_m      int NOT NULL DEFAULT 50
);
CREATE INDEX known_places_person_idx ON known_places (person_id);

-- ---------------------------------------------------------------------------
-- Volunteers (Face B)
-- ---------------------------------------------------------------------------
CREATE TABLE volunteers (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  phone                 text NOT NULL UNIQUE,
  photo_url             text,
  dob                   date,
  -- L0 Registered, L1 ID-checked, L2 Verified, L3 Professional, L4 Police-verified.
  trust_level           int NOT NULL DEFAULT 0 CHECK (trust_level BETWEEN 0 AND 4),
  languages             text[] NOT NULL DEFAULT '{}',
  occupation            text,
  is_woman              boolean,
  home_lat              double precision,
  home_lng              double precision,
  society_id            text REFERENCES societies(id) ON DELETE SET NULL,
  transport             text NOT NULL DEFAULT 'walk'
                          CHECK (transport IN ('walk','cycle','two_wheeler')),
  max_distance_m        int NOT NULL DEFAULT 3000,
  opted_out_case_types  text[] NOT NULL DEFAULT '{}',
  quiet_hours_start     int,
  quiet_hours_end       int,
  reliability_score     double precision NOT NULL DEFAULT 0.5,
  availability_mode     text NOT NULL DEFAULT 'off'
                          CHECK (availability_mode IN ('off','available_now','available_until',
                                 'duty_windows','home_only','auto_pause')),
  available_until       timestamptz,
  -- No availability toggle until the mandatory tutorial is finished (FR-VOL-8).
  tutorial_completed_at timestamptz,
  suspended_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE TABLE volunteer_skills (
  id              bigserial PRIMARY KEY,
  volunteer_id    text NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  skill           text NOT NULL,
  credential_ref  text,
  verified_at     timestamptz,
  -- A lapsed certificate silently removes the badge and its ranking bonus.
  expires_at      timestamptz,
  UNIQUE (volunteer_id, skill)
);

CREATE TABLE volunteer_duty_windows (
  id            bigserial PRIMARY KEY,
  volunteer_id  text NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  weekday       int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_hour    int NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  end_hour      int NOT NULL CHECK (end_hour BETWEEN 0 AND 24)
);

-- ONE row per volunteer, UPDATEd in place. No movement history can be
-- reconstructed from this table (section 11.4).
CREATE TABLE volunteer_zones (
  volunteer_id  text PRIMARY KEY REFERENCES volunteers(id) ON DELETE CASCADE,
  cell_lat      double precision NOT NULL,
  cell_lng      double precision NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX volunteer_zones_bbox_idx ON volunteer_zones (cell_lat, cell_lng);

-- Precise fixes exist only inside an incident and are purged 72 h after it closes.
CREATE TABLE volunteer_fixes (
  id            bigserial PRIMARY KEY,
  volunteer_id  text NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  incident_id   text NOT NULL,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  accuracy_m    double precision NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX volunteer_fixes_incident_idx ON volunteer_fixes (incident_id, volunteer_id, at DESC);

CREATE TABLE vouches (
  id                  bigserial PRIMARY KEY,
  candidate_id        text NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  voter_id            text NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  choice              text NOT NULL CHECK (choice IN ('vouch','concern','abstain')),
  enc_private_reason  bytea,
  at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, voter_id)
);

-- ---------------------------------------------------------------------------
-- Incidents
-- ---------------------------------------------------------------------------
CREATE TABLE incidents (
  id                      text PRIMARY KEY,
  person_id               text REFERENCES people(id) ON DELETE SET NULL,
  society_id              text REFERENCES societies(id) ON DELETE SET NULL,
  source                  text NOT NULL,
  severity                text NOT NULL CHECK (severity IN ('P1','P2','P3','unverified')),
  case_type               text NOT NULL DEFAULT 'unknown',
  state                   text NOT NULL DEFAULT 'new'
                            CHECK (state IN ('new','dispatching','accepted','en_route',
                                   'on_scene','cancel_verifying','resolved')),
  flags                   jsonb NOT NULL DEFAULT '{}',
  escalated_at            timestamptz,
  opened_at               timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz,
  outcome                 text,
  volunteer_observed_type text,
  -- Recorded so a dashboard can label a compressed timeline "demo speed"
  -- truthfully instead of showing impossible numbers (FR-INC-7).
  demo_time_scale         double precision NOT NULL DEFAULT 1,
  search_radius_m         int NOT NULL DEFAULT 1500,
  team_cap                int NOT NULL DEFAULT 2,
  family_token            text UNIQUE,
  family_opened_at        timestamptz,
  last_event_at           timestamptz NOT NULL DEFAULT now()
);
-- At most ONE open incident per person. This makes 10-minute merging a database
-- guarantee rather than an application race (FR-INC-2).
CREATE UNIQUE INDEX incidents_one_open_per_person ON incidents (person_id)
  WHERE closed_at IS NULL AND person_id IS NOT NULL;
CREATE INDEX incidents_open_idx ON incidents (state) WHERE closed_at IS NULL;
CREATE INDEX incidents_opened_idx ON incidents (opened_at DESC);

-- Append-only. Every state change, dispatch, decline reason, timer firing,
-- status tap, card selection and disclosure lands here. The dashboard timeline
-- and every KPI read from this table and nothing else.
CREATE TABLE incident_events (
  incident_id   text NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  seq           int NOT NULL,
  kind          text NOT NULL,
  actor_type    text NOT NULL,
  actor_id      text,
  payload       jsonb NOT NULL DEFAULT '{}',
  at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (incident_id, seq)
);
CREATE INDEX incident_events_kind_idx ON incident_events (kind, at DESC);

-- Insert-only during an incident. The CURRENT position is the
-- highest-precedence fresh row (FR-INC-9 never-degrade rule).
CREATE TABLE person_locations (
  id            bigserial PRIMARY KEY,
  incident_id   text NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  accuracy_m    double precision NOT NULL,
  source        text NOT NULL CHECK (source IN ('gps','wifi','cell','known_place','registry','bystander')),
  speed_mps     double precision,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX person_locations_incident_idx ON person_locations (incident_id, at DESC);

CREATE TABLE incident_timers (
  id            bigserial PRIMARY KEY,
  incident_id   text NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  fire_at       timestamptz NOT NULL,
  fired_at      timestamptz,
  cancelled_at  timestamptz
);
-- The runner's claim query hits this index: due, unfired, uncancelled.
CREATE INDEX incident_timers_due_idx ON incident_timers (fire_at)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE dispatches (
  incident_id     text NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  volunteer_id    text NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  tier            int NOT NULL CHECK (tier IN (1,2)),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  upgraded_at     timestamptz,
  response        text CHECK (response IN ('accepted','declined')),
  decline_reason  text,
  responded_at    timestamptz,
  rank_score      double precision,
  -- FR-ALT-5: the inputs, not just the score, so a dispatch decision can be
  -- explained months later.
  rank_inputs     jsonb,
  stood_down_at   timestamptz,
  PRIMARY KEY (incident_id, volunteer_id)
);
CREATE INDEX dispatches_volunteer_idx ON dispatches (volunteer_id, sent_at DESC);

CREATE TABLE verifications (
  id            bigserial PRIMARY KEY,
  incident_id   text NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  channel       text NOT NULL,
  target        text,
  attempt       int NOT NULL DEFAULT 1,
  outcome       text CHECK (outcome IN ('safe','need_help','no_answer','wrong_pin','duress')),
  simulated     boolean NOT NULL DEFAULT true,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_incident_idx ON verifications (incident_id, at DESC);

-- ---------------------------------------------------------------------------
-- Content, audit, outbox
-- ---------------------------------------------------------------------------
CREATE TABLE cards (
  key           text NOT NULL,
  version       int NOT NULL DEFAULT 1,
  title         text NOT NULL,
  card_group    text NOT NULL,
  body          jsonb NOT NULL,
  source        text NOT NULL,
  -- A card with no dated doctor review is never served (FR-BRF-7).
  reviewed_by   text,
  reviewed_at   timestamptz,
  review_due    timestamptz,
  PRIMARY KEY (key, version)
);

CREATE TABLE card_selections (
  id             bigserial PRIMARY KEY,
  incident_id    text NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  -- Nullable: a historical outcome imported for prediction, or one recorded by a
  -- guard rather than a volunteer, has no volunteer to attribute it to.
  volunteer_id   text REFERENCES volunteers(id) ON DELETE SET NULL,
  card_key       text NOT NULL,
  at             timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz
);

-- Append-only. Every view of a person's data, by whom, for which incident.
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  viewer_type   text NOT NULL,
  viewer_id     text,
  person_id     text,
  incident_id   text,
  view_kind     text NOT NULL CHECK (view_kind IN ('pre_accept','accepted','guard','denied')),
  fields        text[] NOT NULL DEFAULT '{}',
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_person_idx ON audit_log (person_id, at DESC);
CREATE INDEX audit_log_viewer_idx ON audit_log (viewer_id, at DESC);

-- What the simulated providers "sent". Rendered on the dashboard and /sim so a
-- judge can see exactly what would have gone out (NFR-14).
CREATE TABLE outbox (
  id            bigserial PRIMARY KEY,
  incident_id   text REFERENCES incidents(id) ON DELETE CASCADE,
  channel       text NOT NULL,
  recipient     text NOT NULL,
  template      text,
  payload       jsonb NOT NULL DEFAULT '{}',
  simulated     boolean NOT NULL DEFAULT true,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_incident_idx ON outbox (incident_id, at DESC);

-- Volunteer sessions and device status cursors keep the demo honest about what
-- the button has actually been told.
CREATE TABLE device_status_cursor (
  device_id     text PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  incident_id   text REFERENCES incidents(id) ON DELETE SET NULL,
  stage         text NOT NULL DEFAULT 'idle',
  seq           int NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token         text PRIMARY KEY,
  subject_type  text NOT NULL CHECK (subject_type IN ('caregiver','volunteer','guard','dashboard')),
  subject_id    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

CREATE TABLE otp_codes (
  phone         text NOT NULL,
  code          text NOT NULL,
  purpose       text NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  PRIMARY KEY (phone, purpose)
);
