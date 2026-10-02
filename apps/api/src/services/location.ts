/**
 * Person location (FR-INC-9/10/11).
 *
 * Two rules from the master document do all the work:
 *   - Send now, refine later (section 18.2). The geolocation lookup is NEVER
 *     awaited before dispatch; it arrives as an update.
 *   - Never degrade. A later, worse fix does not replace a good fresh one.
 */
import {
  bestOf,
  candidatesFrom,
  describeAccuracy,
  fuse,
  haversineM,
  type FusedLocation,
  type PersonProfile,
  type RawLocationReport,
} from '@safecircle/shared';
import { insertLocation, listLocations } from '../db/repositories/incidents.js';
import { matchKnownPlace } from '../db/repositories/people.js';
import { providers } from '../providers/index.js';

/**
 * The position a responder should see right now: fold every stored fix through
 * the never-degrade rule rather than trusting the newest row.
 */
export async function currentLocation(
  incidentId: string,
  now = new Date(),
): Promise<FusedLocation | null> {
  const all = await listLocations(incidentId);
  return all.reduce<FusedLocation | null>((best, next) => fuse(best, next, now), null);
}

export interface ImmediateLocation {
  location: FusedLocation | null;
  /** True when a slower, more accurate source is still being resolved. */
  refining: boolean;
}

/**
 * The fast path. Uses only what needs no network call: a GPS fix the device
 * already had, a saved Wi-Fi network that names a building, or the registered
 * address. Returns in a single database round trip so dispatch can start.
 */
export async function locateImmediately(
  person: PersonProfile,
  report: RawLocationReport | null | undefined,
  at: Date,
): Promise<ImmediateLocation> {
  const knownPlaceMatch = report?.wifi?.length
    ? await matchKnownPlace(person.id, report.wifi)
    : null;

  const candidates = candidatesFrom({
    report,
    knownPlace: knownPlaceMatch
      ? {
          lat: knownPlaceMatch.lat,
          lng: knownPlaceMatch.lng,
          radiusM: knownPlaceMatch.radiusM,
          label: knownPlaceMatch.label,
        }
      : null,
    registry:
      person.lat !== undefined && person.lng !== undefined
        ? { lat: person.lat, lng: person.lng }
        : null,
    at,
  });

  // A Wi-Fi or cell list that we have not resolved yet means a better position
  // is still coming, but we do not wait for it.
  const refining = Boolean(
    (report?.wifi?.length && !knownPlaceMatch) || report?.cell,
  );

  return { location: bestOf(candidates), refining };
}

/**
 * The slow path, run after the response has already gone back to the device.
 * Resolves a Wi-Fi scan or cell tower through the geolocation port and stores
 * the result if it beats what we already have.
 */
export async function refineLocation(
  incidentId: string,
  person: PersonProfile,
  report: RawLocationReport | null | undefined,
  at: Date,
): Promise<FusedLocation | null> {
  if (!report?.wifi?.length && !report?.cell) return null;

  const resolved = await providers.geolocation.locate({
    wifi: report.wifi ?? undefined,
    cell: report.cell ?? null,
  });
  if (!resolved) return null;

  const candidate: FusedLocation = {
    lat: resolved.lat,
    lng: resolved.lng,
    accuracyM: resolved.accuracyM,
    source: resolved.from,
    at,
  };

  const current = await currentLocation(incidentId, at);
  const winner = fuse(current, candidate, at);
  // Only store it when it actually improves the picture, so the locations table
  // does not fill with estimates nobody will ever use.
  if (winner !== candidate) return current;

  await insertLocation(incidentId, candidate);
  return candidate;
}

/** Store a position that has already been fused in, e.g. the first fix. */
export async function recordLocation(
  incidentId: string,
  loc: FusedLocation,
): Promise<void> {
  await insertLocation(incidentId, loc);
}

export interface MovementAssessment {
  movedM: number | null;
  speedMps: number | null;
  /** True when the search circle should be re-centred and candidates re-ranked. */
  shouldReRank: boolean;
}

/**
 * How far the person has moved since the previous fix, and how fast. Speed feeds
 * the possible-abduction rule (section 8.2) and the 10 s / 60 s update cadence.
 */
export function assessMovement(
  previous: FusedLocation | null,
  next: FusedLocation,
  reRankThresholdM: number,
): MovementAssessment {
  if (!previous) return { movedM: null, speedMps: null, shouldReRank: false };

  const movedM = haversineM(previous.lat, previous.lng, next.lat, next.lng);
  const elapsedS = (next.at.getTime() - previous.at.getTime()) / 1000;
  const speedMps = elapsedS > 0 ? movedM / elapsedS : null;

  return {
    movedM,
    speedMps,
    // Movement inside the accuracy circle is noise, not travel.
    shouldReRank: movedM > reRankThresholdM && movedM > next.accuracyM,
  };
}

export { describeAccuracy };
