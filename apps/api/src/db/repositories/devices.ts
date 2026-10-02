/** Devices: claim, authenticate, and the status cursor the firmware polls. */
import type { DeviceStage } from '@safecircle/shared';
import { decryptField, encryptField, safeEqual } from '../../security/crypto.js';
import { one, pool, type Queryable } from '../pool.js';

export interface DeviceRecord {
  deviceId: string;
  personId: string | null;
  type: 'home' | 'go';
  hmacKey: string;
  claimedAt: Date | null;
  lastSeq: number;
  batteryPct: number | null;
}

export async function findDevice(deviceId: string): Promise<DeviceRecord | null> {
  const row = await one<{
    device_id: string; person_id: string | null; type: 'home' | 'go';
    enc_hmac_key: Buffer; claimed_at: Date | null; last_seq: number; battery_pct: number | null;
  }>('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
  if (!row) return null;
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

export async function createDevice(
  deviceId: string,
  type: 'home' | 'go',
  hmacKey: string,
  claimCode: string,
  client: Queryable = pool,
): Promise<void> {
  await client.query(
    `INSERT INTO devices (device_id, type, enc_hmac_key, claim_code)
     VALUES ($1, $2, $3, $4)`,
    [deviceId, type, encryptField(hmacKey), claimCode],
  );
}

/**
 * Claim a device to a person. The claim code is burned in the same statement, so
 * a stolen or second-hand button cannot be claimed twice (FR-SET-3). The
 * `claim_code IS NOT NULL` predicate makes this safe under concurrency without
 * an explicit lock.
 */
export async function claimDevice(
  deviceId: string,
  claimCode: string,
  personId: string,
): Promise<'claimed' | 'already_claimed' | 'not_found' | 'bad_code'> {
  const row = await one<{ claim_code: string | null; claimed_at: Date | null }>(
    'SELECT claim_code, claimed_at FROM devices WHERE device_id = $1',
    [deviceId],
  );
  if (!row) return 'not_found';
  if (row.claimed_at !== null || row.claim_code === null) return 'already_claimed';
  if (!safeEqual(row.claim_code, claimCode)) return 'bad_code';

  const updated = await one<{ device_id: string }>(
    `UPDATE devices
     SET person_id = $2, claimed_at = now(), claim_code = NULL, status = 'active'
     WHERE device_id = $1 AND claim_code IS NOT NULL
     RETURNING device_id`,
    [deviceId, personId],
  );
  return updated ? 'claimed' : 'already_claimed';
}

/**
 * Record a sequence number atomically. The `last_seq < $2` predicate means two
 * concurrent posts cannot both be accepted, so the replay guard holds even
 * under a retry storm from the firmware.
 */
export async function advanceSequence(
  deviceId: string,
  seq: number,
  battery: number | null,
  client: Queryable = pool,
): Promise<boolean> {
  const res = await client.query(
    `UPDATE devices
     SET last_seq = $2, last_seen_at = now(), battery_pct = COALESCE($3, battery_pct)
     WHERE device_id = $1 AND last_seq < $2`,
    [deviceId, seq, battery],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function touchDevice(deviceId: string, battery: number | null): Promise<void> {
  await pool.query(
    'UPDATE devices SET last_seen_at = now(), battery_pct = COALESCE($2, battery_pct) WHERE device_id = $1',
    [deviceId, battery],
  );
}

export interface StatusCursor {
  stage: DeviceStage;
  seq: number;
  incidentId: string | null;
}

export async function getStatusCursor(deviceId: string): Promise<StatusCursor> {
  const row = await one<{ stage: DeviceStage; seq: number; incident_id: string | null }>(
    'SELECT stage, seq, incident_id FROM device_status_cursor WHERE device_id = $1',
    [deviceId],
  );
  return row
    ? { stage: row.stage, seq: row.seq, incidentId: row.incident_id }
    : { stage: 'idle', seq: 0, incidentId: null };
}

/**
 * Move the cursor forward. The sequence number increments on every write so the
 * firmware can discard a late or duplicated response (FR-FDB-3).
 */
export async function setStatusCursor(
  deviceId: string,
  stage: DeviceStage,
  incidentId: string | null,
  client: Queryable = pool,
): Promise<number> {
  const res = await client.query<{ seq: number }>(
    `INSERT INTO device_status_cursor (device_id, incident_id, stage, seq, updated_at)
     VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (device_id) DO UPDATE
       SET stage = $3, incident_id = $2,
           seq = device_status_cursor.seq + 1, updated_at = now()
     RETURNING seq`,
    [deviceId, incidentId, stage],
  );
  return res.rows[0]?.seq ?? 1;
}

/** Devices for a person, so an incident can drive every button they own. */
export async function devicesForPerson(personId: string): Promise<DeviceRecord[]> {
  const res = await pool.query<{ device_id: string; type: 'home' | 'go' }>(
    "SELECT device_id, type FROM devices WHERE person_id = $1 AND status = 'active'",
    [personId],
  );
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
export async function staleDevices(hours = 24): Promise<Array<{ deviceId: string; personId: string | null; lastSeenAt: Date | null }>> {
  const res = await pool.query<{ device_id: string; person_id: string | null; last_seen_at: Date | null }>(
    `SELECT device_id, person_id, last_seen_at FROM devices
     WHERE status = 'active'
       AND (last_seen_at IS NULL OR last_seen_at < now() - ($1 || ' hours')::interval)`,
    [hours],
  );
  return res.rows.map((r) => ({
    deviceId: r.device_id,
    personId: r.person_id,
    lastSeenAt: r.last_seen_at,
  }));
}
