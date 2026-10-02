/**
 * Incidents, their append-only event log, locations, dispatches and timers.
 *
 * Every state change goes through `appendEvent` in the same transaction as the
 * change itself: a state with no event is an incident nobody can explain
 * afterwards, which defeats both the dashboard timeline and every KPI.
 */
import type {
  CaseType,
  DeclineReason,
  FusedLocation,
  IncidentFlags,
  IncidentOutcome,
  IncidentState,
  LocationSource,
  Severity,
  Tier,
} from '@safecircle/shared';
import { newId, randomToken } from '../../security/crypto.js';
import { one, pool, query, type Queryable } from '../pool.js';

export interface IncidentRecord {
  id: string;
  personId: string | null;
  societyId: string | null;
  source: string;
  severity: Severity;
  caseType: CaseType;
  state: IncidentState;
  flags: IncidentFlags;
  escalatedAt: Date | null;
  openedAt: Date;
  closedAt: Date | null;
  outcome: IncidentOutcome | null;
  volunteerObservedType: string | null;
  demoTimeScale: number;
  searchRadiusM: number;
  teamCap: number;
  familyToken: string | null;
  familyOpenedAt: Date | null;
  lastEventAt: Date;
}

interface IncidentRow {
  id: string; person_id: string | null; society_id: string | null; source: string;
  severity: Severity; case_type: CaseType; state: IncidentState; flags: IncidentFlags;
  escalated_at: Date | null; opened_at: Date; closed_at: Date | null;
  outcome: IncidentOutcome | null; volunteer_observed_type: string | null;
  demo_time_scale: number; search_radius_m: number; team_cap: number;
  family_token: string | null; family_opened_at: Date | null; last_event_at: Date;
}

function toRecord(r: IncidentRow): IncidentRecord {
  return {
    id: r.id,
    personId: r.person_id,
    societyId: r.society_id,
    source: r.source,
    severity: r.severity,
    caseType: r.case_type,
    state: r.state,
    flags: r.flags ?? {},
    escalatedAt: r.escalated_at,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    outcome: r.outcome,
    volunteerObservedType: r.volunteer_observed_type,
    demoTimeScale: r.demo_time_scale,
    searchRadiusM: r.search_radius_m,
    teamCap: r.team_cap,
    familyToken: r.family_token,
    familyOpenedAt: r.family_opened_at,
    lastEventAt: r.last_event_at,
  };
}

export async function findIncident(id: string): Promise<IncidentRecord | null> {
  const row = await one<IncidentRow>('SELECT * FROM incidents WHERE id = $1', [id]);
  return row ? toRecord(row) : null;
}

export async function findIncidentByFamilyToken(token: string): Promise<IncidentRecord | null> {
  const row = await one<IncidentRow>('SELECT * FROM incidents WHERE family_token = $1', [token]);
  return row ? toRecord(row) : null;
}

/**
 * The open incident for a person, if any. FR-INC-2 merging relies on this plus
 * the partial unique index `incidents_one_open_per_person`.
 */
export async function findOpenIncidentForPerson(
  personId: string,
  client: Queryable = pool,
): Promise<IncidentRecord | null> {
  const res = await client.query<IncidentRow>(
    'SELECT * FROM incidents WHERE person_id = $1 AND closed_at IS NULL',
    [personId],
  );
  const row = res.rows[0];
  return row ? toRecord(row) : null;
}

export interface CreateIncidentInput {
  personId: string | null;
  societyId: string | null;
  source: string;
  severity: Severity;
  caseType: CaseType;
  flags: IncidentFlags;
  demoTimeScale: number;
  searchRadiusM: number;
  teamCap: number;
}

export async function createIncident(
  input: CreateIncidentInput,
  client: Queryable = pool,
): Promise<IncidentRecord> {
  const id = newId('inc');
  const res = await client.query<IncidentRow>(
    `INSERT INTO incidents
       (id, person_id, society_id, source, severity, case_type, flags,
        demo_time_scale, search_radius_m, team_cap, family_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      id, input.personId, input.societyId, input.source, input.severity,
      input.caseType, input.flags, input.demoTimeScale, input.searchRadiusM,
      input.teamCap, randomToken(18),
    ],
  );
  return toRecord(res.rows[0]!);
}

// --- Events ---------------------------------------------------------------

export interface IncidentEvent {
  seq: number;
  kind: string;
  actorType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  at: Date;
}

/**
 * Append an event. The sequence number is allocated from the existing maximum
 * inside the same statement, so concurrent appends cannot collide on the
 * (incident_id, seq) primary key.
 */
export async function appendEvent(
  incidentId: string,
  kind: string,
  actorType: string,
  actorId: string | null,
  payload: Record<string, unknown> = {},
  client: Queryable = pool,
): Promise<number> {
  const res = await client.query<{ seq: number }>(
    `INSERT INTO incident_events (incident_id, seq, kind, actor_type, actor_id, payload)
     SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, $4, $5
     FROM incident_events WHERE incident_id = $1
     RETURNING seq`,
    [incidentId, kind, actorType, actorId, payload],
  );
  await client.query('UPDATE incidents SET last_event_at = now() WHERE id = $1', [incidentId]);
  return res.rows[0]?.seq ?? 1;
}

export async function listEvents(incidentId: string): Promise<IncidentEvent[]> {
  const rows = await query<{
    seq: number; kind: string; actor_type: string; actor_id: string | null;
    payload: Record<string, unknown>; at: Date;
  }>('SELECT seq, kind, actor_type, actor_id, payload, at FROM incident_events WHERE incident_id = $1 ORDER BY seq', [
    incidentId,
  ]);
  return rows.map((r) => ({
    seq: r.seq,
    kind: r.kind,
    actorType: r.actor_type,
    actorId: r.actor_id,
    payload: r.payload,
    at: r.at,
  }));
}

// --- State ---------------------------------------------------------------

export async function setState(
  incidentId: string,
  state: IncidentState,
  client: Queryable = pool,
): Promise<void> {
  await client.query('UPDATE incidents SET state = $2 WHERE id = $1', [incidentId, state]);
}

export async function mergeFlags(
  incidentId: string,
  flags: IncidentFlags,
  client: Queryable = pool,
): Promise<void> {
  await client.query('UPDATE incidents SET flags = flags || $2::jsonb WHERE id = $1', [
    incidentId,
    flags,
  ]);
}

export async function setSeverity(
  incidentId: string,
  severity: Severity,
  client: Queryable = pool,
): Promise<void> {
  await client.query('UPDATE incidents SET severity = $2 WHERE id = $1', [incidentId, severity]);
}

export async function setCaseType(
  incidentId: string,
  caseType: CaseType,
  client: Queryable = pool,
): Promise<void> {
  await client.query('UPDATE incidents SET case_type = $2 WHERE id = $1', [incidentId, caseType]);
}

export async function markEscalated(incidentId: string, client: Queryable = pool): Promise<void> {
  // `escalated` is a flag, not a state: telling 112 stops nothing else.
  await client.query(
    `UPDATE incidents SET escalated_at = COALESCE(escalated_at, now()),
       flags = flags || '{"escalated":true}'::jsonb
     WHERE id = $1`,
    [incidentId],
  );
}

export async function setSearchRadius(incidentId: string, radiusM: number): Promise<void> {
  await pool.query('UPDATE incidents SET search_radius_m = $2 WHERE id = $1', [incidentId, radiusM]);
}

export async function setObservedType(
  incidentId: string,
  wording: string,
  client: Queryable = pool,
): Promise<void> {
  await client.query('UPDATE incidents SET volunteer_observed_type = $2 WHERE id = $1', [
    incidentId,
    wording,
  ]);
}

export async function closeIncident(
  incidentId: string,
  outcome: IncidentOutcome,
  client: Queryable = pool,
): Promise<void> {
  await client.query(
    `UPDATE incidents SET state = 'resolved', closed_at = now(), outcome = $2 WHERE id = $1`,
    [incidentId, outcome],
  );
}

export async function markFamilyOpened(incidentId: string): Promise<void> {
  await pool.query(
    'UPDATE incidents SET family_opened_at = COALESCE(family_opened_at, now()) WHERE id = $1',
    [incidentId],
  );
}

// --- Locations -----------------------------------------------------------

export async function insertLocation(
  incidentId: string,
  loc: FusedLocation,
  client: Queryable = pool,
): Promise<void> {
  await client.query(
    `INSERT INTO person_locations (incident_id, lat, lng, accuracy_m, source, speed_mps, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [incidentId, loc.lat, loc.lng, loc.accuracyM, loc.source, loc.speedMps ?? null, loc.at],
  );
}

export async function listLocations(incidentId: string): Promise<FusedLocation[]> {
  const rows = await query<{
    lat: number; lng: number; accuracy_m: number; source: LocationSource;
    speed_mps: number | null; at: Date;
  }>('SELECT * FROM person_locations WHERE incident_id = $1 ORDER BY at ASC', [incidentId]);
  return rows.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    accuracyM: r.accuracy_m,
    source: r.source,
    speedMps: r.speed_mps ?? undefined,
    at: r.at,
  }));
}

// --- Dispatches ---------------------------------------------------------

export interface DispatchRecord {
  volunteerId: string;
  tier: Tier;
  sentAt: Date;
  upgradedAt: Date | null;
  response: 'accepted' | 'declined' | null;
  declineReason: DeclineReason | null;
  respondedAt: Date | null;
  rankScore: number | null;
  stoodDownAt: Date | null;
}

export async function insertDispatch(
  incidentId: string,
  volunteerId: string,
  tier: Tier,
  rankScore: number,
  rankInputs: unknown,
  client: Queryable = pool,
): Promise<void> {
  // A volunteer is alerted once per incident, then UPGRADED in place.
  await client.query(
    `INSERT INTO dispatches (incident_id, volunteer_id, tier, rank_score, rank_inputs)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (incident_id, volunteer_id) DO NOTHING`,
    [incidentId, volunteerId, tier, rankScore, rankInputs],
  );
}

export async function listDispatches(incidentId: string): Promise<DispatchRecord[]> {
  const rows = await query<{
    volunteer_id: string; tier: Tier; sent_at: Date; upgraded_at: Date | null;
    response: 'accepted' | 'declined' | null; decline_reason: DeclineReason | null;
    responded_at: Date | null; rank_score: number | null; stood_down_at: Date | null;
  }>('SELECT * FROM dispatches WHERE incident_id = $1 ORDER BY tier, rank_score', [incidentId]);
  return rows.map((r) => ({
    volunteerId: r.volunteer_id,
    tier: r.tier,
    sentAt: r.sent_at,
    upgradedAt: r.upgraded_at,
    response: r.response,
    declineReason: r.decline_reason,
    respondedAt: r.responded_at,
    rankScore: r.rank_score,
    stoodDownAt: r.stood_down_at,
  }));
}

export async function findDispatch(
  incidentId: string,
  volunteerId: string,
): Promise<DispatchRecord | null> {
  const all = await listDispatches(incidentId);
  return all.find((d) => d.volunteerId === volunteerId) ?? null;
}

/**
 * Record a response. The `response IS NULL` predicate makes the first answer
 * win, so a double-tap cannot turn an accept into a decline.
 */
export async function recordResponse(
  incidentId: string,
  volunteerId: string,
  response: 'accepted' | 'declined',
  reason: DeclineReason | null,
  client: Queryable = pool,
): Promise<boolean> {
  const res = await client.query(
    `UPDATE dispatches SET response = $3, decline_reason = $4, responded_at = now()
     WHERE incident_id = $1 AND volunteer_id = $2 AND response IS NULL`,
    [incidentId, volunteerId, response, reason],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function upgradeAllDispatches(
  incidentId: string,
  client: Queryable = pool,
): Promise<number> {
  const res = await client.query(
    `UPDATE dispatches SET tier = 1, upgraded_at = now()
     WHERE incident_id = $1 AND response IS NULL AND stood_down_at IS NULL`,
    [incidentId],
  );
  return res.rowCount ?? 0;
}

export async function standDownOthers(
  incidentId: string,
  keepVolunteerIds: string[],
  client: Queryable = pool,
): Promise<string[]> {
  const res = await client.query<{ volunteer_id: string }>(
    `UPDATE dispatches SET stood_down_at = now()
     WHERE incident_id = $1 AND response IS NULL AND stood_down_at IS NULL
       AND NOT (volunteer_id = ANY($2::text[]))
     RETURNING volunteer_id`,
    [incidentId, keepVolunteerIds],
  );
  return res.rows.map((r) => r.volunteer_id);
}

export async function countAccepted(incidentId: string): Promise<number> {
  const row = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM dispatches
     WHERE incident_id = $1 AND response = 'accepted' AND stood_down_at IS NULL`,
    [incidentId],
  );
  return row?.n ?? 0;
}

// --- Timers -------------------------------------------------------------

export async function scheduleTimer(
  incidentId: string,
  kind: string,
  fireAt: Date,
  client: Queryable = pool,
): Promise<void> {
  await client.query(
    'INSERT INTO incident_timers (incident_id, kind, fire_at) VALUES ($1,$2,$3)',
    [incidentId, kind, fireAt],
  );
}

export async function cancelTimers(
  incidentId: string,
  kinds?: string[],
  client: Queryable = pool,
): Promise<number> {
  const res = await client.query(
    `UPDATE incident_timers SET cancelled_at = now()
     WHERE incident_id = $1 AND fired_at IS NULL AND cancelled_at IS NULL
       AND ($2::text[] IS NULL OR kind = ANY($2::text[]))`,
    [incidentId, kinds?.length ? kinds : null],
  );
  return res.rowCount ?? 0;
}

/**
 * Atomically claim every due timer. The UPDATE ... RETURNING pattern means two
 * runners can never fire the same timer, so this stays correct if the API is
 * ever scaled to more than one process.
 */
export async function claimDueTimers(
  now: Date,
  limit = 50,
): Promise<Array<{ id: number; incidentId: string; kind: string; fireAt: Date }>> {
  const rows = await query<{ id: number; incident_id: string; kind: string; fire_at: Date }>(
    `UPDATE incident_timers SET fired_at = now()
     WHERE id IN (
       SELECT id FROM incident_timers
       WHERE fire_at <= $1 AND fired_at IS NULL AND cancelled_at IS NULL
       ORDER BY fire_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, incident_id, kind, fire_at`,
    [now, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    incidentId: r.incident_id,
    kind: r.kind,
    fireAt: r.fire_at,
  }));
}

// --- Verifications -----------------------------------------------------

export async function recordVerification(
  incidentId: string,
  channel: string,
  target: string | null,
  attempt: number,
  outcome: string | null,
  simulated: boolean,
  client: Queryable = pool,
): Promise<void> {
  await client.query(
    `INSERT INTO verifications (incident_id, channel, target, attempt, outcome, simulated)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [incidentId, channel, target, attempt, outcome, simulated],
  );
}

export async function countVerificationAttempts(incidentId: string): Promise<number> {
  const row = await one<{ n: number }>(
    'SELECT count(*)::int AS n FROM verifications WHERE incident_id = $1',
    [incidentId],
  );
  return row?.n ?? 0;
}

/** FR-CAN: a cancel cannot be resolved without a verification on file. */
export async function hasVerificationRecord(incidentId: string): Promise<boolean> {
  const row = await one<{ n: number }>(
    'SELECT count(*)::int AS n FROM verifications WHERE incident_id = $1 AND outcome IS NOT NULL',
    [incidentId],
  );
  return (row?.n ?? 0) > 0;
}

// --- Dashboard listing -------------------------------------------------

export async function listOpenIncidents(limit = 50): Promise<IncidentRecord[]> {
  const rows = await query<IncidentRow>(
    'SELECT * FROM incidents WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT $1',
    [limit],
  );
  return rows.map(toRecord);
}

export async function listRecentIncidents(limit = 50): Promise<IncidentRecord[]> {
  const rows = await query<IncidentRow>(
    'SELECT * FROM incidents ORDER BY opened_at DESC LIMIT $1',
    [limit],
  );
  return rows.map(toRecord);
}

export async function findActiveIncidentForVolunteer(volunteerId: string): Promise<string | null> {
  const row = await one<{ incident_id: string }>(
    `SELECT d.incident_id
     FROM dispatches d
     JOIN incidents i ON i.id = d.incident_id
     WHERE d.volunteer_id = $1
       AND d.response = 'accepted'
       AND i.closed_at IS NULL
     ORDER BY i.opened_at DESC
     LIMIT 1`,
    [volunteerId],
  );
  return row?.incident_id ?? null;
}
