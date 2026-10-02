import { decryptField, encryptField, safeEqual } from '../../security/crypto.js';
import { one, pool } from '../pool.js';
export async function findDevice(deviceId) {
    const row = await one('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    if (!row)
        return null;
    return {
        deviceId: row.device_id,
        personId: row.person_id,
        type: row.type,
        hmacKey: decryptField(row.enc_hmac_key),
        claimedAt: row.claimed_at,
        lastSeq: row.last_seq,
        batteryPct: row.battery_pct,
    };
}
export async function createDevice(deviceId, type, hmacKey, claimCode, client = pool) {
    await client.query(`INSERT INTO devices (device_id, type, enc_hmac_key, claim_code)
     VALUES ($1, $2, $3, $4)`, [deviceId, type, encryptField(hmacKey), claimCode]);
}
/**
 * Claim a device to a person. The claim code is burned in the same statement, so
 * a stolen or second-hand button cannot be claimed twice (FR-SET-3). The
 * `claim_code IS NOT NULL` predicate makes this safe under concurrency without
 * an explicit lock.
 */
export async function claimDevice(deviceId, claimCode, personId) {
    const row = await one('SELECT claim_code, claimed_at FROM devices WHERE device_id = $1', [deviceId]);
    if (!row)
        return 'not_found';
    if (row.claimed_at !== null || row.claim_code === null)
        return 'already_claimed';
    if (!safeEqual(row.claim_code, claimCode))
        return 'bad_code';
    const updated = await one(`UPDATE devices
     SET person_id = $2, claimed_at = now(), claim_code = NULL, status = 'active'
     WHERE device_id = $1 AND claim_code IS NOT NULL
     RETURNING device_id`, [deviceId, personId]);
    return updated ? 'claimed' : 'already_claimed';
}
/**
 * Record a sequence number atomically. The `last_seq < $2` predicate means two
 * concurrent posts cannot both be accepted, so the replay guard holds even
 * under a retry storm from the firmware.
 */
export async function advanceSequence(deviceId, seq, battery, client = pool) {
    const res = await client.query(`UPDATE devices
     SET last_seq = $2, last_seen_at = now(), battery_pct = COALESCE($3, battery_pct)
     WHERE device_id = $1 AND last_seq < $2`, [deviceId, seq, battery]);
    return (res.rowCount ?? 0) > 0;
}
export async function touchDevice(deviceId, battery) {
    await pool.query('UPDATE devices SET last_seen_at = now(), battery_pct = COALESCE($2, battery_pct) WHERE device_id = $1', [deviceId, battery]);
}
export async function getStatusCursor(deviceId) {
    const row = await one('SELECT stage, seq, incident_id FROM device_status_cursor WHERE device_id = $1', [deviceId]);
    return row
        ? { stage: row.stage, seq: row.seq, incidentId: row.incident_id }
        : { stage: 'idle', seq: 0, incidentId: null };
}
/**
 * Move the cursor forward. The sequence number increments on every write so the
 * firmware can discard a late or duplicated response (FR-FDB-3).
 */
export async function setStatusCursor(deviceId, stage, incidentId, client = pool) {
    const res = await client.query(`INSERT INTO device_status_cursor (device_id, incident_id, stage, seq, updated_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (device_id) DO UPDATE
       SET stage = $3, incident_id = $2,
           seq = device_status_cursor.seq + 1, updated_at = now()
     RETURNING seq`, [deviceId, incidentId, stage]);
    return res.rows[0]?.seq ?? 1;
}
/** Devices for a person, so an incident can drive every button they own. */
export async function devicesForPerson(personId) {
    const res = await pool.query("SELECT device_id, type FROM devices WHERE person_id = $1 AND status = 'active'", [personId]);
    return res.rows.map((r) => ({
        deviceId: r.device_id,
        personId,
        type: r.type,
        hmacKey: '',
        claimedAt: null,
        lastSeq: 0,
        batteryPct: null,
    }));
}
/** Heartbeat health for the caregiver page and the "silent > 24 h" KPI. */
export async function staleDevices(hours = 24) {
    const res = await pool.query(`SELECT device_id, person_id, last_seen_at FROM devices
     WHERE status = 'active'
       AND (last_seen_at IS NULL OR last_seen_at < now() - ($1 || ' hours')::interval)`, [hours]);
    return res.rows.map((r) => ({
        deviceId: r.device_id,
        personId: r.person_id,
        lastSeenAt: r.last_seen_at,
    }));
}
//# sourceMappingURL=devices.js.map