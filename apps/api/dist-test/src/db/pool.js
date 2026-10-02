/** Postgres access. A single pool per process; transactions via `tx`. */
import pg from 'pg';
import { config } from '../config.js';
// Return DATE and TIMESTAMPTZ as JS Dates, and BIGINT as a number: our ids are
// text and our counters never approach 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
export const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.isTest ? 4 : 10,
});
export async function query(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rows;
}
export async function one(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0] ?? null;
}
/**
 * Run a function inside a transaction. Used wherever an incident's state and
 * its event row must land together - a state change with no event is an
 * unexplainable incident.
 */
export async function tx(fn) {
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