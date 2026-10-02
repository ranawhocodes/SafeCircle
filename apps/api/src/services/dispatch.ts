/**
 * Tiered geofenced dispatch (section 9, FR-ALT-*).
 *
 * Everyone nearby is alerted at the same moment; what differs is urgency. The 3
 * nearest verified volunteers get a full-screen alarm, everyone else a normal
 * notification, and at 30 s everyone is upgraded.
 */
import {
  DISPATCH,
  buildPreAcceptView,
  nextRadius,
  planTiers,
  promoteAfterDecline,
  teamCapFor,
  type IncidentContext,
  type PersonProfile,
  type TierPlan,
  type Viewer,
} from '@safecircle/shared';
import { findCandidates } from '../db/repositories/geo.js';
import {
  appendEvent,
  countAccepted,
  insertDispatch,
  listDispatches,
  setSearchRadius,
  standDownOthers,
  upgradeAllDispatches,
  type IncidentRecord,
} from '../db/repositories/incidents.js';
import { currentLocation } from './location.js';
import { alertGuards, alertVolunteer, standDownVolunteer, upgradeVolunteer } from './notification.js';

function contextFor(incident: IncidentRecord, location: Awaited<ReturnType<typeof currentLocation>>, respondersSoFar: number): IncidentContext {
  return {
    id: incident.id,
    severity: incident.severity,
    caseType: incident.caseType,
    flags: incident.flags,
    location,
    respondersSoFar,
    openedAt: incident.openedAt,
    alertTtlS: DISPATCH.alertTtlS,
  };
}

function viewerFor(v: { id: string; lat: number; lng: number; transport: Viewer['transport'] }): Viewer {
  return { type: 'volunteer', id: v.id, lat: v.lat, lng: v.lng, transport: v.transport };
}

export interface DispatchResult {
  tier1: string[];
  tier2: string[];
  excluded: Array<{ volunteerId: string; reason: string }>;
  radiusM: number;
  sparse: boolean;
  guardsNotified: number;
  /** True when a protected profile has no verified responder (FR-ALT-7). */
  protectedProfileAtRisk: boolean;
}

/**
 * Build and send the initial tiers.
 *
 * An `unverified` incident never reaches volunteers at all: it goes to the guard
 * desk and the dashboard only, because a fake HELP from an unknown number is a
 * known way to lure a volunteer somewhere (section 16.4 #15).
 */
export async function dispatchIncident(
  incident: IncidentRecord,
  person: PersonProfile | null,
  at = new Date(),
): Promise<DispatchResult> {
  const location = await currentLocation(incident.id, at);

  const guardsNotified = await alertGuards(incident.societyId, {
    incidentId: incident.id,
    caseType: incident.caseType,
    severity: incident.severity,
    flat: person?.flat ?? null,
    address: person?.address ?? null,
    isDrill: incident.flags.drill === true,
  });

  if (incident.severity === 'unverified' || !person || !location) {
    await appendEvent(incident.id, 'dispatch_withheld', 'system', null, {
      reason: !person
        ? 'Unregistered sender: guard desk and dashboard only.'
        : !location
          ? 'No usable location yet: cannot rank volunteers.'
          : 'Unverified incident: volunteers are not alerted automatically.',
      guardsNotified,
    });
    return {
      tier1: [], tier2: [], excluded: [], radiusM: incident.searchRadiusM,
      sparse: true, guardsNotified, protectedProfileAtRisk: person?.protected === true,
    };
  }

  // A drill must exercise the whole chain without alerting a single volunteer.
  if (incident.flags.drill) {
    await appendEvent(incident.id, 'dispatch_withheld', 'system', null, {
      reason: 'Drill: no volunteer is alerted.',
      guardsNotified,
    });
    return {
      tier1: [], tier2: [], excluded: [], radiusM: incident.searchRadiusM,
      sparse: false, guardsNotified, protectedProfileAtRisk: false,
    };
  }

  const { plan, radiusM } = await planWithWidening(incident, person, location, at);
  await setSearchRadius(incident.id, radiusM);

  const ctx = contextFor(incident, location, 0);
  const sent: { tier1: string[]; tier2: string[] } = { tier1: [], tier2: [] };

  for (const ranked of plan.tier1) {
    await insertDispatch(incident.id, ranked.volunteer.id, 1, ranked.score, {
      ...ranked.inputs, because: ranked.because,
    });
    await alertVolunteer(
      incident.id, ranked.volunteer.id, 1,
      buildPreAcceptView(person, ctx, 1, viewerFor(ranked.volunteer)),
    );
    sent.tier1.push(ranked.volunteer.id);
  }

  for (const ranked of plan.tier2) {
    await insertDispatch(incident.id, ranked.volunteer.id, 2, ranked.score, {
      ...ranked.inputs, because: ranked.because,
    });
    await alertVolunteer(
      incident.id, ranked.volunteer.id, 2,
      buildPreAcceptView(person, ctx, 2, viewerFor(ranked.volunteer)),
    );
    sent.tier2.push(ranked.volunteer.id);
  }

  await appendEvent(incident.id, 'dispatched', 'system', null, {
    tier1: sent.tier1,
    tier2: sent.tier2,
    radiusM,
    sparse: plan.sparse,
    guardsNotified,
    protectedProfileAtRisk: plan.protectedProfileAtRisk,
    excluded: plan.excluded.map((e) => ({ volunteerId: e.volunteer.id, reason: e.reason })),
  });

  return {
    tier1: sent.tier1,
    tier2: sent.tier2,
    excluded: plan.excluded.map((e) => ({ volunteerId: e.volunteer.id, reason: e.reason })),
    radiusM,
    sparse: plan.sparse,
    guardsNotified,
    protectedProfileAtRisk: plan.protectedProfileAtRisk,
  };
}

/**
 * Widen the radius a step at a time until there are enough verified volunteers
 * (section 9.2). Stops at the largest step rather than searching forever.
 */
async function planWithWidening(
  incident: IncidentRecord,
  person: PersonProfile,
  location: NonNullable<Awaited<ReturnType<typeof currentLocation>>>,
  at: Date,
): Promise<{ plan: TierPlan; radiusM: number }> {
  const alreadyAlerted = (await listDispatches(incident.id)).map((d) => d.volunteerId);
  let radiusM = incident.searchRadiusM;
  let plan: TierPlan | null = null;

  for (;;) {
    const candidates = await findCandidates({
      lat: location.lat,
      lng: location.lng,
      radiusM,
      at,
      excludeVolunteerIds: alreadyAlerted,
    });
    plan = planTiers(
      candidates,
      { ...person, lat: location.lat, lng: location.lng },
      { caseType: incident.caseType, localHour: at.getHours() },
      radiusM,
    );
    if (!plan.sparse) break;
    const wider = nextRadius(radiusM);
    if (wider === null) break;
    radiusM = wider;
  }

  return { plan: plan!, radiusM };
}

/** The 30 s timer: upgrade everyone and widen the search (FR-ALT-2). */
export async function upgradeAll(
  incident: IncidentRecord,
  person: PersonProfile | null,
  at = new Date(),
): Promise<{ upgraded: number; addedTier1: string[] }> {
  const upgraded = await upgradeAllDispatches(incident.id);
  const location = await currentLocation(incident.id, at);

  if (person && location) {
    const ctx = contextFor(incident, location, await countAccepted(incident.id));
    for (const d of await listDispatches(incident.id)) {
      if (d.response !== null || d.stoodDownAt !== null) continue;
      await upgradeVolunteer(
        incident.id, d.volunteerId,
        buildPreAcceptView(person, ctx, 1, { type: 'volunteer', id: d.volunteerId }),
      );
    }
  }

  // Widening brings in volunteers who were outside the original circle.
  const addedTier1: string[] = [];
  const wider = nextRadius(incident.searchRadiusM);
  if (wider !== null && person && location) {
    await setSearchRadius(incident.id, wider);
    const result = await dispatchIncident(
      { ...incident, searchRadiusM: wider }, person, at,
    );
    addedTier1.push(...result.tier1);
  }

  await appendEvent(incident.id, 'upgraded_all', 'system', null, {
    upgraded,
    newRadiusM: wider ?? incident.searchRadiusM,
    addedTier1,
  });
  return { upgraded, addedTier1 };
}

/**
 * Rolling top 3 (FR-ALT-3): a decline promotes the next nearest verified
 * volunteer straight away rather than waiting for the 30 s upgrade.
 */
export async function promoteAfterDeclineFor(
  incident: IncidentRecord,
  person: PersonProfile,
  declinedVolunteerId: string,
  at = new Date(),
): Promise<string | null> {
  const location = await currentLocation(incident.id, at);
  if (!location) return null;

  const alreadyAlerted = (await listDispatches(incident.id)).map((d) => d.volunteerId);
  const candidates = await findCandidates({
    lat: location.lat, lng: location.lng, radiusM: incident.searchRadiusM, at,
    excludeVolunteerIds: alreadyAlerted,
  });
  const plan = planTiers(
    candidates,
    { ...person, lat: location.lat, lng: location.lng },
    { caseType: incident.caseType, localHour: at.getHours() },
    incident.searchRadiusM,
  );
  const { promoted } = promoteAfterDecline(
    { ...plan, tier1: [], tier2: [...plan.tier1, ...plan.tier2] },
    declinedVolunteerId,
  );
  if (!promoted) return null;

  const ctx = contextFor(incident, location, await countAccepted(incident.id));
  await insertDispatch(incident.id, promoted.volunteer.id, 1, promoted.score, {
    ...promoted.inputs, because: promoted.because, promotedAfterDecline: declinedVolunteerId,
  });
  await alertVolunteer(
    incident.id, promoted.volunteer.id, 1,
    buildPreAcceptView(person, ctx, 1, viewerFor(promoted.volunteer)),
  );
  await appendEvent(incident.id, 'tier1_promoted', 'system', null, {
    promoted: promoted.volunteer.id,
    replacing: declinedVolunteerId,
  });
  return promoted.volunteer.id;
}

/**
 * Team caps (FR-ALT-8): once the case has its responders, everyone else is told
 * "covered, thank you, stay available" rather than left wondering.
 */
export async function standDownIfCovered(
  incident: IncidentRecord,
  at = new Date(),
): Promise<string[]> {
  const accepted = await countAccepted(incident.id);
  const cap = teamCapFor(incident.caseType, incident.severity);
  if (accepted < cap) return [];

  const dispatches = await listDispatches(incident.id);
  const keep = dispatches.filter((d) => d.response === 'accepted').map((d) => d.volunteerId);
  const stoodDown = await standDownOthers(incident.id, keep);

  for (const volunteerId of stoodDown) {
    await standDownVolunteer(incident.id, volunteerId, 'covered');
  }
  if (stoodDown.length > 0) {
    await appendEvent(incident.id, 'covered', 'system', null, {
      accepted, cap, stoodDown, at,
    });
  }
  return stoodDown;
}

/** Everyone still waiting is told to stand down, e.g. after a verified-safe cancel. */
export async function standDownEveryone(incidentId: string): Promise<string[]> {
  const stoodDown = await standDownOthers(incidentId, []);
  const dispatches = await listDispatches(incidentId);
  for (const d of dispatches) {
    if (d.response === 'accepted' || stoodDown.includes(d.volunteerId)) {
      await standDownVolunteer(incidentId, d.volunteerId, 'stand_down');
    }
  }
  return stoodDown;
}
