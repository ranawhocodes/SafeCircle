/** Postgres access. A single pool per process; transactions via `tx`. */
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { resolve } from 'node:path';
import { config } from '../config.js';
// Return DATE and TIMESTAMPTZ as JS Dates, and BIGINT as a number: our ids are
// text and our counters never approach 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
let pgliteInstance = null;
let pgliteInitPromise = null;
let usePgLite = config.databaseUrl.startsWith('pglite') || config.databaseUrl.startsWith('memory');
async function getPgLite() {
    if (pgliteInstance)
        return pgliteInstance;
    if (!pgliteInitPromise) {
        pgliteInitPromise = (async () => {
            let dataDir;
            if (config.databaseUrl.startsWith('pglite://')) {
                const raw = config.databaseUrl.replace('pglite://', '');
                dataDir = raw === 'memory' ? undefined : resolve(raw);
            }
            else if (config.databaseUrl.startsWith('memory')) {
                dataDir = undefined;
            }
            else {
                dataDir = resolve(config.isTest ? '.safecircle_pg_test' : '.safecircle_pg');
            }
            const instance = new PGlite(dataDir);
            await instance.waitReady;
            pgliteInstance = instance;
            return instance;
        })();
    }
    return pgliteInitPromise;
}
function formatResult(res) {
    const rows = (res?.rows || []).map((row) => {
        if (row && typeof row === 'object') {
            for (const k of Object.keys(row)) {
                if (row[k] instanceof Uint8Array && !Buffer.isBuffer(row[k])) {
                    row[k] = Buffer.from(row[k]);
                }
            }
        }
        return row;
    });
    return {
        rows,
        rowCount: res?.rowCount ?? res?.affectedRows ?? rows.length,
        command: res?.command ?? '',
        oid: 0,
        fields: res?.fields ?? [],
    };
}
let txQueue = Promise.resolve();
async function serializeTx(action) {
    let release;
    const nextLock = new Promise((r) => {
        release = r;
    });
    const prevQueue = txQueue;
    txQueue = prevQueue.then(() => nextLock);
    await prevQueue;
    try {
        return await action();
    }
    finally {
        release();
    }
}
async function runPgLiteQuery(queryTextOrConfig, values) {
    const db = await getPgLite();
    const text = typeof queryTextOrConfig === 'string' ? queryTextOrConfig : queryTextOrConfig.text;
    const params = typeof queryTextOrConfig === 'string' ? values : (queryTextOrConfig.values ?? values);
    if (params && params.length > 0) {
        const res = await db.query(text, params);
        return formatResult(res);
    }
    const trimmed = text.trim();
    if (trimmed.includes(';') ||
        /^(CREATE|DROP|ALTER|TRUNCATE|BEGIN|COMMIT|ROLLBACK)/i.test(trimmed)) {
        const results = await db.exec(text);
        const last = results.length > 0 ? results[results.length - 1] : undefined;
        return formatResult(last);
    }
    const res = await db.query(text);
    return formatResult(res);
}
const realPool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.isTest ? 4 : 10,
    connectionTimeoutMillis: 1500,
});
export const pool = {
    async query(queryTextOrConfig, values) {
        if (usePgLite) {
            return runPgLiteQuery(queryTextOrConfig, values);
        }
        try {
            return await realPool.query(queryTextOrConfig, values);
        }
        catch (err) {
            if (!usePgLite &&
                (err.code === 'ECONNREFUSED' ||
                    err.code === 'ETIMEDOUT' ||
                    err.message?.includes('Connection terminated') ||
                    err.message?.includes('connect ECONNREFUSED'))) {
                console.warn('PostgreSQL server not reachable at', config.databaseUrl, '- using embedded PGlite storage.');
                usePgLite = true;
                return runPgLiteQuery(queryTextOrConfig, values);
            }
            throw err;
        }
    },
    async connect() {
        if (usePgLite) {
            const client = {
                query: ((q, v) => runPgLiteQuery(q, v)),
                release: () => { },
            };
            return client;
        }
        try {
            return await realPool.connect();
        }
        catch (err) {
            if (!usePgLite &&
                (err.code === 'ECONNREFUSED' ||
                    err.code === 'ETIMEDOUT' ||
                    err.message?.includes('Connection terminated') ||
                    err.message?.includes('connect ECONNREFUSED'))) {
                console.warn('PostgreSQL server not reachable at', config.databaseUrl, '- using embedded PGlite storage.');
                usePgLite = true;
                return pool.connect();
            }
            throw err;
        }
    },
    async end() {
        if (pgliteInstance) {
            await pgliteInstance.close();
            pgliteInstance = null;
            pgliteInitPromise = null;
        }
        if (!usePgLite) {
            await realPool.end();
        }
    },
};
export async function query(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rows;
}
export async function one(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0] ?? null;
}
export async function tx(fn) {
    if (usePgLite) {
        return serializeTx(async () => {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await fn(client);
                await client.query('COMMIT');
                return result;
            }
            catch (err) {
                await client.query('ROLLBACK');
                throw err;
            }
            finally {
                client.release();
            }
        });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
export async function closePool() {
    await pool.end();
}
//# sourceMappingURL=pool.js.map