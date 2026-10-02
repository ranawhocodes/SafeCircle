/**
 * Integration test harness.
 *
 * Runs against a real throwaway Postgres schema (`safecircle_test`) and injects
 * into the Fastify app, so routes, SQL, constraints and the disclosure guard are
 * all exercised together. No network is used.
 */
import { createHmac } from 'node:crypto';
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
    throw new Error('Refusing to run: NODE_ENV is not "test", so these tests would reset ' +
        `${config.databaseUrl}. Run them with "npm test".`);
}
let app = null;
/** One app and one migrated schema for the whole file; data reset per test. */
export async function getApp() {
    if (!app) {
        await migrate({ reset: true, quiet: true });
        app = await buildApp();
        await app.ready();
    }
    return app;
}
export async function resetData() {
    await seed({ quiet: true });
}
export async function teardown() {
    if (app)
        await app.close();
    app = null;
    await closePool();
}
// --- device signing (mirrors the firmware) ----------------------------------
function canonicalise(payload) {
    const walk = (v) => {
        if (v === null || typeof v !== 'object')
            return v;
        if (Array.isArray(v))
            return v.map(walk);
        const out = {};
        for (const k of Object.keys(v).sort()) {
            if (k === 'signature')
                continue;
            const val = v[k];
            if (val === undefined)
                continue;
            out[k] = walk(val);
        }
        return out;
    };
    return JSON.stringify(walk(payload));
}
export function signFor(deviceId, payload) {
    const key = DEMO_DEVICE_KEYS[deviceId];
    if (!key)
        throw new Error(`No demo key for ${deviceId}`);
    return createHmac('sha256', key).update(canonicalise(payload)).digest('hex');
}
/** A signed device press, the way the firmware sends it. */
export async function press(opts = {}) {
    const a = await getApp();
    const deviceId = opts.deviceId ?? 'GO-021';
    const body = {
        device_id: deviceId,
        event: opts.event ?? 'panic',
        seq: opts.seq ?? nextSeq(deviceId),
        battery: opts.battery ?? 80,
    };
    if (opts.location)
        body.location = opts.location;
    if (opts.signature === undefined)
        body.signature = signFor(deviceId, body);
    else if (opts.signature !== null)
        body.signature = opts.signature;
    const res = await a.inject({ method: 'POST', url: '/api/sos/device', payload: body });
    return { status: res.statusCode, body: res.json() };
}
const seqs = new Map();
function nextSeq(deviceId) {
    const n = (seqs.get(deviceId) ?? 1000) + 1;
    seqs.set(deviceId, n);
    return n;
}
/** Reset the sequence counters when the database is reset. */
export function resetSeqs() {
    seqs.clear();
}
// --- auth ------------------------------------------------------------------
export async function signIn(phone, role) {
    const a = await getApp();
    const req = await a.inject({
        method: 'POST',
        url: '/api/auth/otp/request',
        payload: { phone, role },
    });
    const code = req.json().code;
    const ver = await a.inject({
        method: 'POST',
        url: '/api/auth/otp/verify',
        payload: { phone, code, role },
    });
    const token = ver.json().token;
    if (!token)
        throw new Error(`Sign-in failed for ${phone} as ${role}: ${ver.body}`);
    return token;
}
export async function authGet(url, token) {
    const a = await getApp();
    const res = await a.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    return { status: res.statusCode, body: res.json() };
}
export async function authPost(url, payload, token) {
    const a = await getApp();
    const res = await a.inject({
        method: 'POST',
        url,
        payload: payload,
        headers: { authorization: `Bearer ${token}` },
    });
    return { status: res.statusCode, body: res.json() };
}
export async function plainGet(url) {
    const a = await getApp();
    const res = await a.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json() };
}
export async function plainPost(url, payload) {
    const a = await getApp();
    const res = await a.inject({ method: 'POST', url, payload: payload });
    return { status: res.statusCode, body: res.json() };
}
// --- waiting ---------------------------------------------------------------
/**
 * The dispatch phase runs after the device is answered, so tests must wait for
 * it. Polls a condition rather than sleeping a fixed time.
 */
export async function waitFor(fn, predicate, { timeoutMs = 4000, everyMs = 25 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = await fn();
    while (Date.now() < deadline) {
        if (predicate(last))
            return last;
        await new Promise((r) => setTimeout(r, everyMs));
        last = await fn();
    }
    throw new Error(`waitFor timed out. Last value: ${JSON.stringify(last)}`);
}
export async function eventKinds(incidentId) {
    const res = await pool.query('SELECT kind FROM incident_events WHERE incident_id = $1 ORDER BY seq', [incidentId]);
    return res.rows.map((r) => r.kind);
}
export async function waitForEvent(incidentId, kind) {
    await waitFor(() => eventKinds(incidentId), (kinds) => kinds.includes(kind));
}
export async function dispatchRows(incidentId) {
    const res = await pool.query('SELECT volunteer_id, tier, response, stood_down_at FROM dispatches WHERE incident_id = $1 ORDER BY tier, rank_score', [incidentId]);
    return res.rows;
}
export async function outboxFor(incidentId) {
    const res = await pool.query('SELECT channel, recipient, template FROM outbox WHERE incident_id = $1', [incidentId]);
    return res.rows;
}
export async function incidentRow(incidentId) {
    const res = await pool.query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
    return res.rows[0];
}
/** Force a timer to be due now, so a 90-second rule can be tested in 90 ms. */
export async function fireTimerNow(incidentId, kind) {
    await pool.query(`UPDATE incident_timers SET fire_at = now() - interval '1 second'
     WHERE incident_id = $1 AND kind = $2 AND fired_at IS NULL AND cancelled_at IS NULL`, [incidentId, kind]);
}
export { pool };
//# sourceMappingURL=helpers.js.map