/**
 * Candidate search.
 *
 * This is the ONLY file that reads lat/lng for proximity. Swapping in PostGIS
 * later means changing these two queries and nothing else
 * (docs/03-data-model.md section 6).
 *
 * Two steps: a bounding box on the indexed columns, then exact haversine in the
 * same statement so ordering is correct rather than approximate.
 */
import type { CaseType, Transport, VolunteerCandidate, VolunteerSkill } from '@safecircle/shared';
import { boundingBox } from '@safecircle/shared';
import { query } from '../pool.js';

const HAVERSINE = `
  6371000 * 2 * asin(sqrt(
    power(sin(radians($2 - %LAT%) / 2), 2) +
    cos(radians(%LAT%)) * cos(radians($2)) *
    power(sin(radians($3 - %LNG%) / 2), 2)
  ))`;

interface CandidateRow {
  id: string;
  name: string;
  trust_level: number;
  languages: string[];
  transport: Transport;
  max_distance_m: number;
  opted_out_case_types: string[];
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  reliability_score: number;
  is_woman: boolean | null;
  lat: number;
  lng: number;
  location_age_s: number;
  alerts_today: number;
  skills: string[] | null;
}

export interface CandidateSearch {
  lat: number;
  lng: number;
  radiusM: number;
  /** Only volunteers whose availability currently allows alerts. */
  at: Date;
  excludeVolunteerIds?: string[];
}

/**
 * Available volunteers whose last known zone falls inside the radius.
 *
 * Availability, tutorial completion and suspension are filtered in SQL because
 * they are hard gates. Case-type opt-outs, distance limits, daily caps and quiet
 * hours are returned and filtered in the domain layer instead, so the dashboard
 * can explain WHY coverage was thin (see `planTiers`).
 */
export async function findCandidates(search: CandidateSearch): Promise<VolunteerCandidate[]> {
  const box = boundingBox(search.lat, search.lng, search.radiusM);
  const distance = HAVERSINE.replaceAll('%LAT%', 'z.cell_lat').replaceAll('%LNG%', 'z.cell_lng');

  const rows = await query<CandidateRow>(
    `SELECT
       v.id, v.name, v.trust_level, v.languages, v.transport, v.max_distance_m,
       v.opted_out_case_types, v.quiet_hours_start, v.quiet_hours_end,
       v.reliability_score, v.is_woman,
       z.cell_lat AS lat, z.cell_lng AS lng,
       EXTRACT(EPOCH FROM (now() - z.updated_at))::int AS location_age_s,
       COALESCE(d.alerts_today, 0) AS alerts_today,
       ARRAY(
         SELECT s.skill FROM volunteer_skills s
         WHERE s.volunteer_id = v.id
           AND (s.expires_at IS NULL OR s.expires_at > now())
       ) AS skills
     FROM volunteers v
     JOIN volunteer_zones z ON z.volunteer_id = v.id
     LEFT JOIN (
       SELECT volunteer_id, count(*)::int AS alerts_today
       FROM dispatches
       WHERE sent_at > date_trunc('day', now())
       GROUP BY volunteer_id
     ) d ON d.volunteer_id = v.id
     WHERE v.deleted_at IS NULL
       AND v.suspended_at IS NULL
       AND v.tutorial_completed_at IS NOT NULL
       AND (
         v.availability_mode = 'available_now'
         OR (v.availability_mode = 'available_until' AND v.available_until > $8)
         OR v.availability_mode IN ('duty_windows', 'home_only')
       )
       AND z.cell_lat BETWEEN $4 AND $5
       AND z.cell_lng BETWEEN $6 AND $7
       AND ($9::text[] IS NULL OR NOT (v.id = ANY($9::text[])))
       AND ${distance} <= $1
     ORDER BY ${distance} ASC
     LIMIT 200`,
    [
      search.radiusM,
      search.lat,
      search.lng,
      box.minLat,
      box.maxLat,
      box.minLng,
      box.maxLng,
      search.at,
      search.excludeVolunteerIds?.length ? search.excludeVolunteerIds : null,
    ],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    trustLevel: Math.min(4, Math.max(0, r.trust_level)) as VolunteerCandidate['trustLevel'],
    skills: (r.skills ?? []) as VolunteerSkill[],
    languages: r.languages,
    transport: r.transport,
    maxDistanceM: r.max_distance_m,
    optedOutCaseTypes: r.opted_out_case_types as CaseType[],
    quietHoursStart: r.quiet_hours_start,
    quietHoursEnd: r.quiet_hours_end,
    reliabilityScore: r.reliability_score,
    lat: r.lat,
    lng: r.lng,
    locationAgeS: r.location_age_s,
    isWoman: r.is_woman ?? undefined,
    alertsToday: r.alerts_today,
  }));
}

/** Count verified volunteers within a radius - the coverage KPI in section 23.3. */
export async function countVerifiedWithin(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<number> {
  const box = boundingBox(lat, lng, radiusM);
  const distance = HAVERSINE.replaceAll('%LAT%', 'z.cell_lat').replaceAll('%LNG%', 'z.cell_lng');
  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM volunteers v
     JOIN volunteer_zones z ON z.volunteer_id = v.id
     WHERE v.trust_level >= 2 AND v.deleted_at IS NULL AND v.suspended_at IS NULL
       AND z.cell_lat BETWEEN $4 AND $5
       AND z.cell_lng BETWEEN $6 AND $7
       AND ${distance} <= $1`,
    [radiusM, lat, lng, box.minLat, box.maxLat, box.minLng, box.maxLng],
  );
  return rows[0]?.n ?? 0;
}

/**
 * On-duty guards across the whole deployment.
 *
 * Used for an `unverified` incident, where there is no person and therefore no
 * society to route to. The alert carries no personal data at all - only that an
 * unknown number asked for help - so reaching the staffed desks is both safe and
 * the only way FR-TRG-6's "guard desk and dashboard" promise can be kept.
 */
export async function onDutyGuardsAnywhere(): Promise<
  Array<{ id: string; name: string; phone: string; societyId: string }>
> {
  const rows = await query<{ id: string; name: string; phone: string; society_id: string }>(
    `SELECT id, name, phone, society_id FROM guards
     WHERE on_duty = true
     ORDER BY society_id, order_index`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, societyId: r.society_id }));
}

/** On-duty guards for a society, in escalation order (FR-FAM-6). */
export async function guardsForSociety(
  societyId: string,
): Promise<Array<{ id: string; name: string; phone: string; onDuty: boolean }>> {
  const rows = await query<{ id: string; name: string; phone: string; on_duty: boolean }>(
    `SELECT id, name, phone, on_duty FROM guards
     WHERE society_id = $1
     ORDER BY on_duty DESC, order_index ASC`,
    [societyId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, onDuty: r.on_duty }));
}
