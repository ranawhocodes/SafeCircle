/**
 * Append-only audit log (FR-BRF-3).
 *
 * Every view of a person's data is recorded: who, when, which incident, which
 * view kind, and which field groups were released. Section 12.5 promises this
 * ("every view of a person's profile is logged"), and section 16.4 #16 relies
 * on it to catch a stalker volunteer.
 */
import type { Queryable } from '../db/pool.js';
import { pool } from '../db/pool.js';
import type { ViewKind } from '@safecircle/shared';

export interface AuditEntry {
  viewerType: 'volunteer' | 'guard' | 'family' | 'dashboard' | 'admin' | 'system';
  viewerId?: string | null;
  personId?: string | null;
  incidentId?: string | null;
  /** `denied` is recorded too: a refused attempt is the interesting one. */
  viewKind: ViewKind | 'denied';
  fields?: string[];
}

export async function recordView(entry: AuditEntry, client: Queryable = pool): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (viewer_type, viewer_id, person_id, incident_id, view_kind, fields)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.viewerType,
      entry.viewerId ?? null,
      entry.personId ?? null,
      entry.incidentId ?? null,
      entry.viewKind,
      entry.fields ?? [],
    ],
  );
}

/** Field groups, so the log says what was released without copying the data. */
export const FIELD_GROUPS = {
  preAccept: ['category', 'age_band', 'distance_band', 'eta'],
  accepted: ['identity', 'location', 'address', 'handling', 'health'],
  guard: ['identity', 'location', 'address', 'handling', 'health', 'access_secrets'],
} as const;

export function fieldsFor(viewKind: ViewKind): readonly string[] {
  if (viewKind === 'guard') return FIELD_GROUPS.guard;
  if (viewKind === 'accepted') return FIELD_GROUPS.accepted;
  return FIELD_GROUPS.preAccept;
}
