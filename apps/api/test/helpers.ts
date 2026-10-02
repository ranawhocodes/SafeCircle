/**
 * Integration test harness.
 *
 * Runs against a real throwaway Postgres schema (`safecircle_test`) and injects
 * into the Fastify app, so routes, SQL, constraints and the disclosure guard are
 * all exercised together. No network is used.
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { closePool, pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { seed, DEMO_DEVICE_KEYS } from '../src/seed/seed.js';

/*
 * NODE_ENV MUST already be `test` by the time this module loads.
 *
 * Setting it here would be too late: ES module imports are hoisted and
 * evaluated before any top-level statement, so `src/config.ts` would already
 * have read the old value - and `migrate({reset:true})` below would then drop
 * the schema of the DEVELOPMENT database.
 *
 * `npm run test` sets it on the command line. This guard makes the failure loud
 * and immediate rather than silently destructive.
 */
if (!config.isTest) {
  throw new Error(
    'Refusing to run: NODE_ENV is not "test", so these tests would reset ' +
      `${config.databaseUrl}. Run them with "npm test".`,
  );
}

let app: FastifyInstance | null = null;

/** One app and one migrated schema for the whole file; data reset per test. */
export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    await migrate({ reset: true, quiet: true });
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function resetData(): Promise<void> {
  await seed({ quiet: true });
}

export async function teardown(): Promise<void> {
  if (app) await app.close();
  app = null;
  await closePool();
}

// --- device signing (mirrors the firmware) ----------------------------------

function canonicalise(payload: Record<string, unknown>): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (k === 'signature') continue;
      const val = (v as Record<string, unknown>)[k];
      if (val === undefined) continue;
      out[k] = walk(val);
    }
    return out;
  };
  return JSON.stringify(walk(payload));
}

export function signFor(deviceId: string, payload: Record<string, unknown>): string {
  const key = DEMO_DEVICE_KEYS[deviceId];
  if (!key) throw new Error(`No demo key for ${deviceId}`);
  return createHmac('sha256', key).update(canonicalise(payload)).digest('hex');
}

export interface PressOptions {
  deviceId?: string;
  event?: string;
  seq?: number;
  battery?: number;
  location?: Record<string, unknown>;
  /** Omit or corrupt the signature deliberately. */
  signature?: string | null;
}

/** A signed device press, the way the firmware sends it. */
export async function press(opts: PressOptions = {}): Promise<{ status: number; body: any }> {
  const a = await getApp();
  const deviceId = opts.deviceId ?? 'GO-021';
  const body: Record<string, unknown> = {
    device_id: deviceId,
    event: opts.event ?? 'panic',
    seq: opts.seq ?? nextSeq(deviceId),
    battery: opts.battery ?? 80,
  };
  if (opts.location) body.location = opts.location;
  if (opts.signature === undefined) body.signature = signFor(deviceId, body);
  else if (opts.signature !== null) body.signature = opts.signature;

  const res = await a.inject({ method: 'POST', url: '/api/sos/device', payload: body });
  return { status: res.statusCode, body: res.json() };
}

const seqs = new Map<string, number>();
function nextSeq(deviceId: string): number {
  const n = (seqs.get(deviceId) ?? 1000) + 1;
  seqs.set(deviceId, n);
  return n;
}

/** Reset the sequence counters when the database is reset. */
export function resetSeqs(): void {
  seqs.clear();
}

// --- auth ------------------------------------------------------------------

export async function signIn(
  phone: string,
  role: 'caregiver' | 'volunteer' | 'guard' | 'dashboard',
): Promise<string> {
  const a = await getApp();
  const req = await a.inject({
    method: 'POST',
    url: '/api/auth/otp/request',
    payload: { phone, role },
  });
  const code = req.json().code as string;
  const ver = await a.inject({
    method: 'POST',
    url: '/api/auth/otp/verify',
    payload: { phone, code, role },
  });
  const token = ver.json().token as string;
  if (!token) throw new Error(`Sign-in failed for ${phone} as ${role}: ${ver.body}`);
  return token;
}

export async function authGet(url: string, token: string): Promise<{ status: number; body: any }> {
  const a = await getApp();
  const res = await a.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  return { status: res.statusCode, body: res.json() };
}

export async function authPost(
  url: string,
  payload: unknown,
  token: string,
): Promise<{ status: number; body: any }> {
  const a = await getApp();
  const res = await a.inject({
    method: 'POST',
    url,
    payload: payload as never,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.statusCode, body: res.json() };
}

export async function plainGet(url: string): Promise<{ status: number; body: any }> {
  const a = await getApp();
  const res = await a.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() };
}

export async function plainPost(
  url: string,
  payload: unknown,
): Promise<{ status: number; body: any }> {
  const a = await getApp();
  const res = await a.inject({ method: 'POST', url, payload: payload as never });
  return { status: res.statusCode, body: res.json() };
}

// --- waiting ---------------------------------------------------------------

/**
 * The dispatch phase runs after the device is answered, so tests must wait for
 * it. Polls a condition rather than sleeping a fixed time.
 */
export async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 4000, everyMs = 25 }: { timeoutMs?: number; everyMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, everyMs));
    last = await fn();
  }
  throw new Error(`waitFor timed out. Last value: ${JSON.stringify(last)}`);
}

export async function eventKinds(incidentId: string): Promise<string[]> {
  const res = await pool.query<{ kind: string }>(
    'SELECT kind FROM incident_events WHERE incident_id = $1 ORDER BY seq',
    [incidentId],
  );
  return res.rows.map((r) => r.kind);
}

export async function waitForEvent(incidentId: string, kind: string): Promise<void> {
  await waitFor(
    () => eventKinds(incidentId),
    (kinds) => kinds.includes(kind),
  );
}

export async function dispatchRows(incidentId: string): Promise<
  Array<{ volunteer_id: string; tier: number; response: string | null; stood_down_at: Date | null }>
> {
  const res = await pool.query(
    'SELECT volunteer_id, tier, response, stood_down_at FROM dispatches WHERE incident_id = $1 ORDER BY tier, rank_score',
    [incidentId],
  );
  return res.rows as never;
}

export async function outboxFor(incidentId: string): Promise<
  Array<{ channel: string; recipient: string; template: string | null }>
> {
  const res = await pool.query(
    'SELECT channel, recipient, template FROM outbox WHERE incident_id = $1',
    [incidentId],
  );
  return res.rows as never;
}

export async function incidentRow(incidentId: string): Promise<any> {
  const res = await pool.query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  return res.rows[0];
}

/** Force a timer to be due now, so a 90-second rule can be tested in 90 ms. */
export async function fireTimerNow(incidentId: string, kind: string): Promise<void> {
  await pool.query(
    `UPDATE incident_timers SET fire_at = now() - interval '1 second'
     WHERE incident_id = $1 AND kind = $2 AND fired_at IS NULL AND cancelled_at IS NULL`,
    [incidentId, kind],
  );
}

export { pool };
