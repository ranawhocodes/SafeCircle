/**
 * Location fusion (section 18.2, FR-INC-9/10).
 *
 * Two rules do the work:
 *   1. Source precedence: gps > known_place > wifi > bystander > cell > registry.
 *   2. Never degrade: a newer fix replaces the current one ONLY if it is at
 *      least as good. A pendant that loses its GPS lock must not make the
 *      responder's map worse than it already was.
 */
import { FUSION } from './config.js';
import type {
  FusedLocation,
  LocationSource,
  RawLocationReport,
} from './types.js';

/** Typical accuracy when a source gives us no number of its own (section 18.2). */
const DEFAULT_ACCURACY_M: Record<LocationSource, number> = {
  gps: 15,
  known_place: 50,
  wifi: 60,
  bystander: 30,
  cell: 900,
  registry: 25,
};

export interface FusionInputs {
  report?: RawLocationReport | null;
  /** Position for a resolved Wi-Fi/cell list, from the geolocation port. */
  resolved?: { lat: number; lng: number; accuracyM: number; from: 'wifi' | 'cell' } | null;
  /** A matched known place, resolved from a saved Wi-Fi network. */
  knownPlace?: { lat: number; lng: number; radiusM: number; label: string } | null;
  /** The registered address - always available for a registered person. */
  registry?: { lat: number; lng: number } | null;
  at: Date;
}

/**
 * Turn one device report into the candidate positions it supports.
 * A GPS fix older than `gpsFreshS` is deliberately dropped: a 10-minute-old
 * fix from a moving person is worse than a fresh Wi-Fi estimate.
 */
export function candidatesFrom(inputs: FusionInputs): FusedLocation[] {
  const out: FusedLocation[] = [];
  const gps = inputs.report?.gps;

  if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
    if (gps.age_s <= FUSION.gpsFreshS) {
      out.push({
        lat: gps.lat,
        lng: gps.lng,
        accuracyM: gps.acc_m > 0 ? gps.acc_m : DEFAULT_ACCURACY_M.gps,
        source: 'gps',
        at: new Date(inputs.at.getTime() - gps.age_s * 1000),
      });
    }
  }

  if (inputs.knownPlace) {
    out.push({
      lat: inputs.knownPlace.lat,
      lng: inputs.knownPlace.lng,
      accuracyM: inputs.knownPlace.radiusM || DEFAULT_ACCURACY_M.known_place,
      source: 'known_place',
      at: inputs.at,
      label: inputs.knownPlace.label,
    });
  }

  if (inputs.resolved) {
    out.push({
      lat: inputs.resolved.lat,
      lng: inputs.resolved.lng,
      accuracyM: inputs.resolved.accuracyM || DEFAULT_ACCURACY_M[inputs.resolved.from],
      source: inputs.resolved.from,
      at: inputs.at,
    });
  }

  if (inputs.registry) {
    out.push({
      lat: inputs.registry.lat,
      lng: inputs.registry.lng,
      accuracyM: DEFAULT_ACCURACY_M.registry,
      source: 'registry',
      at: inputs.at,
    });
  }

  return out;
}

/** Higher is better. Precedence first, then tighter accuracy breaks ties. */
function quality(loc: FusedLocation): number {
  const rank = FUSION.sourceRank[loc.source] ?? 0;
  return rank * 1000 - Math.min(loc.accuracyM, 999);
}

/** Pick the best of several candidates from the same report. */
export function bestOf(candidates: FusedLocation[]): FusedLocation | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (quality(c) > quality(best) ? c : best));
}

/**
 * The never-degrade rule (FR-INC-9).
 *
 * Returns the position responders should see. A candidate wins only if it is
 * better quality, or if what we are holding has gone stale.
 */
export function fuse(
  current: FusedLocation | null,
  candidate: FusedLocation | null,
  now: Date,
): FusedLocation | null {
  if (!candidate) return current;
  if (!current) return candidate;

  const currentAgeS = (now.getTime() - current.at.getTime()) / 1000;
  if (currentAgeS > FUSION.gpsFreshS) return candidate;

  return quality(candidate) > quality(current) ? candidate : current;
}

/**
 * Metres moved between two positions, or null when either is missing.
 * Used to decide whether to re-rank candidates (section 9.2).
 */
export function movedM(
  a: FusedLocation | null,
  b: FusedLocation | null,
  haversine: (aLat: number, aLng: number, bLat: number, bLng: number) => number,
): number | null {
  if (!a || !b) return null;
  return haversine(a.lat, a.lng, b.lat, b.lng);
}

/** Honest one-line description for every UI that shows a position (FR-INC-10). */
export function describeAccuracy(loc: FusedLocation): string {
  const label: Record<LocationSource, string> = {
    gps: 'GPS',
    wifi: 'Wi-Fi estimate',
    cell: 'Cell tower',
    known_place: loc.label ? `Known place: ${loc.label}` : 'Known place',
    registry: 'Registered address',
    bystander: "Bystander's phone",
  };
  return `${label[loc.source]}, about ${Math.round(loc.accuracyM)} m`;
}
