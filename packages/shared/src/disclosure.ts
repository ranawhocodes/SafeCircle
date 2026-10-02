/**
 * Staged disclosure (section 19.4, FR-BRF-1/2/3).
 *
 * The rule from the master document: privacy rules such as "address only after
 * accepting" are enforced ON THE SERVER, never by hiding fields in the app.
 *
 * These builders are the only way a person's data becomes a response payload.
 * `PreAcceptView` does not merely omit the name and address - those properties
 * do not exist on the type, so no client bug and no careless spread can leak
 * them.
 */
import { distanceBand, etaSeconds, haversineM } from './geo.js';
import { handlingBanner } from './flashcards.js';
import { safetyNoticeFor } from './ranking.js';
import type {
  AcceptedView,
  CaseType,
  FusedLocation,
  GuardView,
  IncidentFlags,
  PersonProfile,
  PreAcceptView,
  Severity,
  Tier,
  Transport,
  ViewKind,
} from './types.js';

export interface Viewer {
  type: 'volunteer' | 'guard' | 'family' | 'dashboard' | 'admin';
  id: string;
  /** Has this viewer accepted THIS incident? Checked by the caller against the DB. */
  hasAcceptedThisIncident?: boolean;
  /** Is this guard on duty for the society that owns the person? */
  isOnDutyForSociety?: boolean;
  transport?: Transport;
  lat?: number;
  lng?: number;
}

export interface IncidentContext {
  id: string;
  severity: Severity;
  caseType: CaseType;
  flags: IncidentFlags;
  location: FusedLocation | null;
  respondersSoFar: number;
  openedAt: Date;
  alertTtlS: number;
}

export class DisclosureDeniedError extends Error {
  constructor(
    readonly viewer: Viewer,
    readonly incidentId: string,
    readonly wanted: ViewKind,
  ) {
    super('Accept the alert first.');
    this.name = 'DisclosureDeniedError';
  }
}

/**
 * Decide which view a viewer is entitled to. Returning the kind separately from
 * building it lets the route log the decision before any data is touched.
 */
export function allowedViewKind(viewer: Viewer): ViewKind {
  if (viewer.type === 'guard' && viewer.isOnDutyForSociety) return 'guard';
  if (viewer.type === 'volunteer' && viewer.hasAcceptedThisIncident) return 'accepted';
  if (viewer.type === 'dashboard' || viewer.type === 'admin') return 'accepted';
  return 'pre_accept';
}

/**
 * What a volunteer sees before accepting (section 10.1): category and distance
 * first, full briefing only after. Distance is banded so repeated alerts cannot
 * be used to triangulate an address.
 */
export function buildPreAcceptView(
  person: Pick<PersonProfile, 'ageBand' | 'feedbackProfile'>,
  incident: IncidentContext,
  tier: Tier,
  viewer: Viewer,
): PreAcceptView {
  const stealth = person.feedbackProfile === 'stealth' || incident.flags.stealth === true;

  let distanceBandM = 0;
  let etaS = 0;
  if (incident.location && viewer.lat !== undefined && viewer.lng !== undefined) {
    const d = haversineM(viewer.lat, viewer.lng, incident.location.lat, incident.location.lng);
    distanceBandM = distanceBand(d);
    etaS = etaSeconds(d, viewer.transport ?? 'walk');
  }

  return {
    viewKind: 'pre_accept',
    incidentId: incident.id,
    tier,
    category: incident.caseType,
    severity: incident.severity,
    ageBand: person.ageBand,
    distanceBandM,
    etaS,
    respondersSoFar: incident.respondersSoFar,
    safetyNotice: safetyNoticeFor(incident.caseType, stealth),
    stealth,
    isDrill: incident.flags.drill === true,
    expiresAt: new Date(incident.openedAt.getTime() + incident.alertTtlS * 1000),
  };
}

/**
 * The full briefing, released only to a responder who accepted (section 10.1).
 * Access secrets are NOT here - they need the guard view.
 */
export function buildAcceptedView(
  person: PersonProfile,
  incident: IncidentContext,
  masked: { family?: string; guard?: string } = {},
): AcceptedView {
  return {
    viewKind: 'accepted',
    incidentId: incident.id,
    person: {
      name: person.name,
      respondsToName: person.respondsToName,
      ageBand: person.ageBand,
      photoUrl: person.photoUrl,
      languages: person.languages,
    },
    location:
      incident.location ??
      ({
        lat: person.lat ?? 0,
        lng: person.lng ?? 0,
        accuracyM: 25,
        source: 'registry',
        at: incident.openedAt,
      } satisfies FusedLocation),
    address: person.address,
    flat: person.flat,
    landmark: person.landmark,
    handlingBanner: handlingBanner(person.handling),
    health: person.health,
    familyContactMasked: masked.family,
    guardContactMasked: masked.guard,
    isDrill: incident.flags.drill === true,
  };
}

/**
 * The guard view (section 15.2): guards are a trusted on-site role, so they get
 * the full address immediately plus the access secrets. Every call must be
 * audited by the caller - `buildGuardView` deliberately takes the already
 * decrypted secrets so decryption itself is an auditable step elsewhere.
 */
export function buildGuardView(
  person: PersonProfile,
  incident: IncidentContext,
  accessSecrets: GuardView['accessSecrets'],
  masked: { family?: string; guard?: string } = {},
): GuardView {
  const base = buildAcceptedView(person, incident, masked);
  return { ...base, viewKind: 'guard', accessSecrets };
}

/** Keys that must never appear in a pre-accept payload. Used by the tests. */
export const FORBIDDEN_PRE_ACCEPT_KEYS = [
  'name',
  'respondsToName',
  'address',
  'flat',
  'landmark',
  'photoUrl',
  'health',
  'conditions',
  'medicines',
  'allergies',
  'bloodGroup',
  'accessSecrets',
  'gateCode',
  'doorCode',
  'spareKeyHolder',
  'lat',
  'lng',
  'phone',
] as const;

/**
 * Deep key scan used by both a runtime assertion and the integration tests.
 * A life-safety privacy rule is worth checking twice.
 */
export function findForbiddenKeys(payload: unknown): string[] {
  const found = new Set<string>();
  const forbidden = new Set<string>(FORBIDDEN_PRE_ACCEPT_KEYS);

  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      if (forbidden.has(k)) found.add(k);
      walk(v);
    }
  };

  walk(payload);
  return [...found];
}

/** What the family may see (FR-FAM-1/2): never a volunteer's position. */
export interface FamilyStatusView {
  incidentId: string;
  state: string;
  severity: Severity;
  isDrill: boolean;
  demoSpeed: boolean;
  /** The PERSON's location - the family is entitled to this one. */
  personLocation: FusedLocation | null;
  responders: Array<{
    name: string;
    badge: string;
    skill: string | null;
    etaS: number | null;
    status: string;
  }>;
  escalatedTo112: boolean;
  escalationSimulated: boolean;
  volunteerObservedType: string | null;
  timeline: Array<{ at: Date; text: string }>;
}

/** Keys that must never appear in a family payload. */
export const FORBIDDEN_FAMILY_KEYS = ['volunteerLat', 'volunteerLng', 'volunteerLocation'] as const;
