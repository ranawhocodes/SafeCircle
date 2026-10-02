-- Phase 9 Features: Tutorial Progress (F28), Community Vouching Rounds (F26), Device Health Alerting (F37)

CREATE TABLE IF NOT EXISTS volunteer_module_progress (
  volunteer_id  text NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  module_id     text NOT NULL,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  score         integer,
  PRIMARY KEY (volunteer_id, module_id)
);

CREATE TABLE IF NOT EXISTS vote_rounds (
  id            text PRIMARY KEY,
  candidate_id  text NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  society_id    text NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'passed', 'rejected', 'referred')),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  deadline_at   timestamptz NOT NULL,
  resolved_at   timestamptz
);

ALTER TABLE vouches ADD COLUMN IF NOT EXISTS round_id text REFERENCES vote_rounds(id) ON DELETE SET NULL;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_health_alert_at timestamptz;
