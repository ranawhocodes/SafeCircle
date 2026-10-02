/** Volunteer profile, availability, trust and zone updates. */
import type { AvailabilityMode, TrustLevel, VolunteerSkill } from '@safecircle/shared';
import { coarseCell } from '@safecircle/shared';
import { one, pool, query, type Queryable } from '../pool.js';

export interface VolunteerRecord {
  id: string;
  name: string;
  phone: string;
  trustLevel: TrustLevel;
  skills: VolunteerSkill[];
  languages: string[];
  availabilityMode: AvailabilityMode;
  availableUntil: Date | null;
  tutorialCompletedAt: Date | null;
  suspendedAt: Date | null;
  societyId: string | null;
  homeLat: number | null;
  homeLng: number | null;
  reliabilityScore: number;
  isWoman: boolean | null;
}

export async function findVolunteer(id: string): Promise<VolunteerRecord | null> {
  const row = await one<{
    id: string; name: string; phone: string; trust_level: number; languages: string[];
    availability_mode: AvailabilityMode; available_until: Date | null;
    tutorial_completed_at: Date | null; suspended_at: Date | null;
    society_id: string | null; home_lat: number | null; home_lng: number | null;
    reliability_score: number; is_woman: boolean | null; skills: string[];
  }>(
    `SELECT v.*, ARRAY(
       SELECT s.skill FROM volunteer_skills s
       WHERE s.volunteer_id = v.id AND (s.expires_at IS NULL OR s.expires_at > now())
     ) AS skills
     FROM volunteers v WHERE v.id = $1 AND v.deleted_at IS NULL`,
    [id],
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    trustLevel: row.trust_level as TrustLevel,
    skills: row.skills as VolunteerSkill[],
    languages: row.languages,
    availabilityMode: row.availability_mode,
    availableUntil: row.available_until,
    tutorialCompletedAt: row.tutorial_completed_at,
    suspendedAt: row.suspended_at,
    societyId: row.society_id,
    homeLat: row.home_lat,
    homeLng: row.home_lng,
    reliabilityScore: row.reliability_score,
    isWoman: row.is_woman,
  };
}

/**
 * FR-VOL-8: a volunteer cannot go available until the mandatory tutorial and
 * practice alert are finished. Enforced here rather than in the app, so an
 * unmodified API client cannot bypass it.
 */
export async function setAvailability(
  volunteerId: string,
  mode: AvailabilityMode,
  until: Date | null,
): Promise<'ok' | 'tutorial_required' | 'suspended' | 'not_found'> {
  const v = await findVolunteer(volunteerId);
  if (!v) return 'not_found';
  if (v.suspendedAt) return 'suspended';
  if (mode !== 'off' && !v.tutorialCompletedAt) return 'tutorial_required';

  await pool.query(
    'UPDATE volunteers SET availability_mode = $2, available_until = $3 WHERE id = $1',
    [volunteerId, mode, until],
  );
  return 'ok';
}

/**
 * Store a volunteer's coarse zone. This is an UPDATE, never an INSERT: between
 * incidents SafeCircle keeps one ~1 km cell and no movement history at all
 * (section 11.4).
 */
export async function updateZone(volunteerId: string, lat: number, lng: number): Promise<void> {
  const cell = coarseCell(lat, lng);
  await pool.query(
    `INSERT INTO volunteer_zones (volunteer_id, cell_lat, cell_lng, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (volunteer_id) DO UPDATE
       SET cell_lat = $2, cell_lng = $3, updated_at = now()`,
    [volunteerId, cell.cellLat, cell.cellLng],
  );
}

/** A precise fix, valid only inside an incident and purged 72 h after close. */
export async function insertFix(
  volunteerId: string,
  incidentId: string,
  lat: number,
  lng: number,
  accuracyM: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO volunteer_fixes (volunteer_id, incident_id, lat, lng, accuracy_m)
     VALUES ($1,$2,$3,$4,$5)`,
    [volunteerId, incidentId, lat, lng, accuracyM],
  );
}

export async function latestFix(
  volunteerId: string,
  incidentId: string,
): Promise<{ lat: number; lng: number; accuracyM: number; at: Date } | null> {
  const row = await one<{ lat: number; lng: number; accuracy_m: number; at: Date }>(
    `SELECT lat, lng, accuracy_m, at FROM volunteer_fixes
     WHERE volunteer_id = $1 AND incident_id = $2 ORDER BY at DESC LIMIT 1`,
    [volunteerId, incidentId],
  );
  return row ? { lat: row.lat, lng: row.lng, accuracyM: row.accuracy_m, at: row.at } : null;
}

export async function completeTutorial(volunteerId: string): Promise<void> {
  await pool.query(
    'UPDATE volunteers SET tutorial_completed_at = COALESCE(tutorial_completed_at, now()) WHERE id = $1',
    [volunteerId],
  );
}

export async function setTrustLevel(
  volunteerId: string,
  level: TrustLevel,
  client: Queryable = pool,
): Promise<void> {
  await client.query('UPDATE volunteers SET trust_level = $2 WHERE id = $1', [volunteerId, level]);
}

/** Badge wording for the family status page and the 112 packet. */
export function badgeFor(trustLevel: TrustLevel): string {
  switch (trustLevel) {
    case 0: return 'Registered';
    case 1: return 'ID checked';
    case 2: return 'Verified';
    case 3: return 'Verified professional';
    case 4: return 'Police verified';
  }
}

const SKILL_LABELS: Partial<Record<VolunteerSkill, string>> = {
  doctor: 'Doctor',
  nurse: 'Nurse',
  paramedic: 'Paramedic',
  first_aider: 'First-aider',
  police: 'Police',
  fire: 'Fire service',
};

/** The single skill worth showing a frightened family, or null. */
export function primarySkillLabel(skills: VolunteerSkill[]): string | null {
  for (const s of ['doctor', 'nurse', 'paramedic', 'first_aider', 'police', 'fire'] as VolunteerSkill[]) {
    if (skills.includes(s)) return SKILL_LABELS[s] ?? null;
  }
  return null;
}

/** Nudge the reliability score after an incident closes (FR-ALT-5 input). */
export async function adjustReliability(volunteerId: string, delta: number): Promise<void> {
  await pool.query(
    `UPDATE volunteers
     SET reliability_score = LEAST(1, GREATEST(0, reliability_score + $2))
     WHERE id = $1`,
    [volunteerId, delta],
  );
}

export async function recordVouch(
  candidateId: string,
  voterId: string,
  choice: 'vouch' | 'concern' | 'abstain',
  encReason: Buffer | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO vouches (candidate_id, voter_id, choice, enc_private_reason)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (candidate_id, voter_id) DO UPDATE
       SET choice = $3, enc_private_reason = $4, at = now()`,
    [candidateId, voterId, choice, encReason],
  );
}

export async function tallyVouches(
  candidateId: string,
): Promise<{ vouch: number; concern: number; abstain: number }> {
  const rows = await query<{ choice: string; n: number }>(
    'SELECT choice, count(*)::int AS n FROM vouches WHERE candidate_id = $1 GROUP BY choice',
    [candidateId],
  );
  const out = { vouch: 0, concern: 0, abstain: 0 };
  for (const r of rows) {
    if (r.choice === 'vouch') out.vouch = r.n;
    else if (r.choice === 'concern') out.concern = r.n;
    else out.abstain = r.n;
  }
  return out;
}
