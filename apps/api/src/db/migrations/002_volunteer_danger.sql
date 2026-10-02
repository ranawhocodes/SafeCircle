-- F23: Volunteer's own SOS — link volunteer to person record
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS as_person_id text REFERENCES people(id) ON DELETE SET NULL;
