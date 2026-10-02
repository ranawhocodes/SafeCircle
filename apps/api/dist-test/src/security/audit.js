import { pool } from '../db/pool.js';
export async function recordView(entry, client = pool) {
    await client.query(`INSERT INTO audit_log (viewer_type, viewer_id, person_id, incident_id, view_kind, fields)
     VALUES ($1, $2, $3, $4, $5, $6)`, [
        entry.viewerType,
        entry.viewerId ?? null,
        entry.personId ?? null,
        entry.incidentId ?? null,
        entry.viewKind,
        entry.fields ?? [],
    ]);
}
/** Field groups, so the log says what was released without copying the data. */
export const FIELD_GROUPS = {
    preAccept: ['category', 'age_band', 'distance_band', 'eta'],
    accepted: ['identity', 'location', 'address', 'handling', 'health'],
    guard: ['identity', 'location', 'address', 'handling', 'health', 'access_secrets'],
};
export function fieldsFor(viewKind) {
    if (viewKind === 'guard')
        return FIELD_GROUPS.guard;
    if (viewKind === 'accepted')
        return FIELD_GROUPS.accepted;
    return FIELD_GROUPS.preAccept;
}
//# sourceMappingURL=audit.js.map