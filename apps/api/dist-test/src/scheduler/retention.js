/**
 * Retention jobs (NFR-9, master document section 20.2).
 *
 * The master document's retention schedule is a promise to users; these jobs are
 * what make it true. Every one is idempotent and takes an explicit clock so it
 * can be tested without waiting.
 */
import { RETENTION_H } from '@safecircle/shared';
import { pool } from '../db/pool.js';
/**
 * Precise location fixes, 72 h after the incident closes.
 *
 * Tied to `closed_at` rather than the row's own age, because an incident that
 * runs for hours must keep its track while it is live.
 */
export async function purgeFixes(now = new Date()) {
    const cutoffHours = RETENTION_H.locationFixes;
    const vf = await pool.query(`DELETE FROM volunteer_fixes vf
     USING incidents i
     WHERE vf.incident_id = i.id
       AND i.closed_at IS NOT NULL
       AND i.closed_at < $1::timestamptz - ($2 || ' hours')::interval`, [now, cutoffHours]);
    const pl = await pool.query(`DELETE FROM person_locations pl
     USING incidents i
     WHERE pl.incident_id = i.id
       AND i.closed_at IS NOT NULL
       AND i.closed_at < $1::timestamptz - ($2 || ' hours')::interval`, [now, cutoffHours]);
    return { volunteerFixes: vf.rowCount ?? 0, personLocations: pl.rowCount ?? 0 };
}
/** Responder chat and masked-call logs after 7 days. */
export async function purgeComms(now = new Date()) {
    const res = await pool.query(`DELETE FROM outbox
     WHERE channel IN ('voice', 'chat')
       AND at < $1::timestamptz - ($2 || ' hours')::interval`, [now, RETENTION_H.maskedCallLogs]);
    return res.rowCount ?? 0;
}
/** The audit log after a year. */
export async function purgeAudit(now = new Date()) {
    const res = await pool.query(`DELETE FROM audit_log WHERE at < $1::timestamptz - ($2 || ' hours')::interval`, [now, RETENTION_H.auditLog]);
    return res.rowCount ?? 0;
}
/**
 * Incidents are kept for a year, then anonymised IN PLACE rather than deleted,
 * so the statistics a society is shown survive while the person does not.
 */
export async function anonymiseIncidents(now = new Date()) {
    const res = await pool.query(`UPDATE incidents
     SET person_id = NULL, family_token = NULL, volunteer_observed_type = NULL
     WHERE closed_at IS NOT NULL
       AND closed_at < $1::timestamptz - ($2 || ' hours')::interval
       AND person_id IS NOT NULL`, [now, RETENTION_H.incidentRecord]);
    return res.rowCount ?? 0;
}
export async function runAllRetentionJobs(now = new Date()) {
    const fixes = await purgeFixes(now);
    return {
        volunteerFixes: fixes.volunteerFixes,
        personLocations: fixes.personLocations,
        outbox: await purgeComms(now),
        auditLog: await purgeAudit(now),
        anonymisedIncidents: await anonymiseIncidents(now),
    };
}
/** Hourly in the background. Returns a stop function. */
export function startRetentionJobs(onError) {
    const handle = setInterval(() => {
        void runAllRetentionJobs().catch((err) => onError(err));
    }, 60 * 60 * 1000);
    handle.unref?.();
    return () => clearInterval(handle);
}
//# sourceMappingURL=retention.js.map