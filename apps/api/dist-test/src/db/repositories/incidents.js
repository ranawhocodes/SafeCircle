import { newId, randomToken } from '../../security/crypto.js';
import { one, pool, query } from '../pool.js';
function toRecord(r) {
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
export async function findIncident(id) {
    const row = await one('SELECT * FROM incidents WHERE id = $1', [id]);
    return row ? toRecord(row) : null;
}
export async function findIncidentByFamilyToken(token) {
    const row = await one('SELECT * FROM incidents WHERE family_token = $1', [token]);
    return row ? toRecord(row) : null;
}
/**
 * The open incident for a person, if any. FR-INC-2 merging relies on this plus
 * the partial unique index `incidents_one_open_per_person`.
 */
export async function findOpenIncidentForPerson(personId, client = pool) {
    const res = await client.query('SELECT * FROM incidents WHERE person_id = $1 AND closed_at IS NULL', [personId]);
    const row = res.rows[0];
    return row ? toRecord(row) : null;
}
export async function createIncident(input, client = pool) {
    const id = newId('inc');
    const res = await client.query(`INSERT INTO incidents
       (id, person_id, society_id, source, severity, case_type, flags,
        demo_time_scale, search_radius_m, team_cap, family_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`, [
        id, input.personId, input.societyId, input.source, input.severity,
        input.caseType, input.flags, input.demoTimeScale, input.searchRadiusM,
        input.teamCap, randomToken(18),
    ]);
    return toRecord(res.rows[0]);
}
/**
 * Append an event. The sequence number is allocated from the existing maximum
 * inside the same statement, so concurrent appends cannot collide on the
 * (incident_id, seq) primary key.
 */
export async function appendEvent(incidentId, kind, actorType, actorId, payload = {}, client = pool) {
    const res = await client.query(`INSERT INTO incident_events (incident_id, seq, kind, actor_type, actor_id, payload)
     SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, $4, $5
     FROM incident_events WHERE incident_id = $1
     RETURNING seq`, [incidentId, kind, actorType, actorId, payload]);
    await client.query('UPDATE incidents SET last_event_at = now() WHERE id = $1', [incidentId]);
    return res.rows[0]?.seq ?? 1;
}
export async function listEvents(incidentId) {
    const rows = await query('SELECT seq, kind, actor_type, actor_id, payload, at FROM incident_events WHERE incident_id = $1 ORDER BY seq', [
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
export async function setState(incidentId, state, client = pool) {
    await client.query('UPDATE incidents SET state = $2 WHERE id = $1', [incidentId, state]);
}
export async function mergeFlags(incidentId, flags, client = pool) {
    await client.query('UPDATE incidents SET flags = flags || $2::jsonb WHERE id = $1', [
        incidentId,
        flags,
    ]);
}
export async function setSeverity(incidentId, severity, client = pool) {
    await client.query('UPDATE incidents SET severity = $2 WHERE id = $1', [incidentId, severity]);
}
export async function markEscalated(incidentId, client = pool) {
    // `escalated` is a flag, not a state: telling 112 stops nothing else.
    await client.query(`UPDATE incidents SET escalated_at = COALESCE(escalated_at, now()),
       flags = flags || '{"escalated":true}'::jsonb
     WHERE id = $1`, [incidentId]);
}
export async function setSearchRadius(incidentId, radiusM) {
    await pool.query('UPDATE incidents SET search_radius_m = $2 WHERE id = $1', [incidentId, radiusM]);
}
export async function setObservedType(incidentId, wording, client = pool) {
    await client.query('UPDATE incidents SET volunteer_observed_type = $2 WHERE id = $1', [
        incidentId,
        wording,
    ]);
}
export async function closeIncident(incidentId, outcome, client = pool) {
    await client.query(`UPDATE incidents SET state = 'resolved', closed_at = now(), outcome = $2 WHERE id = $1`, [incidentId, outcome]);
}
export async function markFamilyOpened(incidentId) {
    await pool.query('UPDATE incidents SET family_opened_at = COALESCE(family_opened_at, now()) WHERE id = $1', [incidentId]);
}
// --- Locations -----------------------------------------------------------
export async function insertLocation(incidentId, loc, client = pool) {
    await client.query(`INSERT INTO person_locations (incident_id, lat, lng, accuracy_m, source, speed_mps, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`, [incidentId, loc.lat, loc.lng, loc.accuracyM, loc.source, loc.speedMps ?? null, loc.at]);
}
export async function listLocations(incidentId) {
    const rows = await query('SELECT * FROM person_locations WHERE incident_id = $1 ORDER BY at ASC', [incidentId]);
    return rows.map((r) => ({
        lat: r.lat,
        lng: r.lng,
        accuracyM: r.accuracy_m,
        source: r.source,
        speedMps: r.speed_mps ?? undefined,
        at: r.at,
    }));
}
export async function insertDispatch(incidentId, volunteerId, tier, rankScore, rankInputs, client = pool) {
    // A volunteer is alerted once per incident, then UPGRADED in place.
    await client.query(`INSERT INTO dispatches (incident_id, volunteer_id, tier, rank_score, rank_inputs)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (incident_id, volunteer_id) DO NOTHING`, [incidentId, volunteerId, tier, rankScore, rankInputs]);
}
export async function listDispatches(incidentId) {
    const rows = await query('SELECT * FROM dispatches WHERE incident_id = $1 ORDER BY tier, rank_score', [incidentId]);
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
export async function findDispatch(incidentId, volunteerId) {
    const all = await listDispatches(incidentId);
    return all.find((d) => d.volunteerId === volunteerId) ?? null;
}
/**
 * Record a response. The `response IS NULL` predicate makes the first answer
 * win, so a double-tap cannot turn an accept into a decline.
 */
export async function recordResponse(incidentId, volunteerId, response, reason, client = pool) {
    const res = await client.query(`UPDATE dispatches SET response = $3, decline_reason = $4, responded_at = now()
     WHERE incident_id = $1 AND volunteer_id = $2 AND response IS NULL`, [incidentId, volunteerId, response, reason]);
    return (res.rowCount ?? 0) > 0;
}
export async function upgradeAllDispatches(incidentId, client = pool) {
    const res = await client.query(`UPDATE dispatches SET tier = 1, upgraded_at = now()
     WHERE incident_id = $1 AND response IS NULL AND stood_down_at IS NULL`, [incidentId]);
    return res.rowCount ?? 0;
}
export async function standDownOthers(incidentId, keepVolunteerIds, client = pool) {
    const res = await client.query(`UPDATE dispatches SET stood_down_at = now()
     WHERE incident_id = $1 AND response IS NULL AND stood_down_at IS NULL
       AND NOT (volunteer_id = ANY($2::text[]))
     RETURNING volunteer_id`, [incidentId, keepVolunteerIds]);
    return res.rows.map((r) => r.volunteer_id);
}
export async function countAccepted(incidentId) {
    const row = await one(`SELECT count(*)::int AS n FROM dispatches
     WHERE incident_id = $1 AND response = 'accepted' AND stood_down_at IS NULL`, [incidentId]);
    return row?.n ?? 0;
}
// --- Timers -------------------------------------------------------------
export async function scheduleTimer(incidentId, kind, fireAt, client = pool) {
    await client.query('INSERT INTO incident_timers (incident_id, kind, fire_at) VALUES ($1,$2,$3)', [incidentId, kind, fireAt]);
}
export async function cancelTimers(incidentId, kinds, client = pool) {
    const res = await client.query(`UPDATE incident_timers SET cancelled_at = now()
     WHERE incident_id = $1 AND fired_at IS NULL AND cancelled_at IS NULL
       AND ($2::text[] IS NULL OR kind = ANY($2::text[]))`, [incidentId, kinds?.length ? kinds : null]);
    return res.rowCount ?? 0;
}
/**
 * Atomically claim every due timer. The UPDATE ... RETURNING pattern means two
 * runners can never fire the same timer, so this stays correct if the API is
 * ever scaled to more than one process.
 */
export async function claimDueTimers(now, limit = 50) {
    const rows = await query(`UPDATE incident_timers SET fired_at = now()
     WHERE id IN (
       SELECT id FROM incident_timers
       WHERE fire_at <= $1 AND fired_at IS NULL AND cancelled_at IS NULL
       ORDER BY fire_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, incident_id, kind, fire_at`, [now, limit]);
    return rows.map((r) => ({
        id: r.id,
        incidentId: r.incident_id,
        kind: r.kind,
        fireAt: r.fire_at,
    }));
}
// --- Verifications -----------------------------------------------------
export async function recordVerification(incidentId, channel, target, attempt, outcome, simulated, client = pool) {
    await client.query(`INSERT INTO verifications (incident_id, channel, target, attempt, outcome, simulated)
     VALUES ($1,$2,$3,$4,$5,$6)`, [incidentId, channel, target, attempt, outcome, simulated]);
}
export async function countVerificationAttempts(incidentId) {
    const row = await one('SELECT count(*)::int AS n FROM verifications WHERE incident_id = $1', [incidentId]);
    return row?.n ?? 0;
}
/** FR-CAN: a cancel cannot be resolved without a verification on file. */
export async function hasVerificationRecord(incidentId) {
    const row = await one('SELECT count(*)::int AS n FROM verifications WHERE incident_id = $1 AND outcome IS NOT NULL', [incidentId]);
    return (row?.n ?? 0) > 0;
}
// --- Dashboard listing -------------------------------------------------
export async function listOpenIncidents(limit = 50) {
    const rows = await query('SELECT * FROM incidents WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT $1', [limit]);
    return rows.map(toRecord);
}
export async function listRecentIncidents(limit = 50) {
    const rows = await query('SELECT * FROM incidents ORDER BY opened_at DESC LIMIT $1', [limit]);
    return rows.map(toRecord);
}
//# sourceMappingURL=incidents.js.map