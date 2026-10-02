/**
 * Geometry and ETA. No PostGIS: a bounding box prefilter plus haversine is
 * exact and fast at pilot scale (docs/03-data-model.md section 4).
 */
import { RANKING } from './config.js';
import type { Transport } from './types.js';

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = (bLat - aLat) * DEG;
  const dLng = (bLng - aLng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * A box that definitely contains the circle, for the cheap indexed prefilter.
 * Longitude degrees shrink with latitude, so the cosine term matters.
 */
export function boundingBox(lat: number, lng: number, radiusM: number): BoundingBox {
  const dLat = radiusM / 111_320;
  // Guard against the poles, where cos(lat) approaches zero.
  const cos = Math.max(Math.cos(lat * DEG), 1e-6);
  const dLng = radiusM / (111_320 * cos);
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng,
  };
}

/**
 * Effective travel time. Short hops are walked whatever the volunteer rides,
 * because unlocking and starting a two-wheeler costs more than it saves
 * (section 9.3).
 */
export function etaSeconds(distanceM: number, transport: Transport): number {
  const speed =
    distanceM < RANKING.walkUnderM || transport === 'walk'
      ? RANKING.walkingSpeedMps
      : transport === 'cycle'
        ? RANKING.walkingSpeedMps * 2.5
        : RANKING.twoWheelerSpeedMps;
  return Math.round(distanceM / speed);
}

/**
 * Coarsen a position to a ~1 km cell. Between incidents we store only this, so
 * no movement history can be reconstructed from the volunteer_zones table
 * (FR-VOL-10 privacy rule, section 11.4).
 */
export function coarseCell(lat: number, lng: number): { cellLat: number; cellLng: number } {
  const step = 0.009; // ~1 km in latitude
  return {
    cellLat: Math.round(lat / step) * step,
    cellLng: Math.round(lng / step) * step,
  };
}

/**
 * Round a distance into a band for the pre-accept view, so a volunteer who has
 * not accepted cannot triangulate an exact address by watching the number
 * change (FR-BRF-1).
 */
export function distanceBand(distanceM: number): number {
  if (distanceM < 100) return 100;
  if (distanceM < 1000) return Math.round(distanceM / 100) * 100;
  return Math.round(distanceM / 500) * 500;
}
