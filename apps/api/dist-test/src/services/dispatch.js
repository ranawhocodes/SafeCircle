/**
 * Tiered geofenced dispatch (section 9, FR-ALT-*).
 *
 * Everyone nearby is alerted at the same moment; what differs is urgency.
 * Two-priority Tier 1 selection (F16): the 3 nearest verified volunteers get
 * a full-screen alarm; if fewer than 3 verified are available, the remaining
 * slots are filled with the nearest unverified volunteers. Everyone else gets
 * a normal notification. At 30 s all volunteers within 1 km are upgraded.
 */
import { DISPATCH, buildPreAcceptView, nextRadius, planTiers, promoteAfterDecline, teamCapFor, } from '@safecircle/shared';
import { findCandidates } from '../db/repositories/geo.js';
import { appendEvent, countAccepted, insertDispatch, listDispatches, setSearchRadius, standDownOthers, upgradeAllDispatches, } from '../db/repositories/incidents.js';
import { currentLocation } from './location.js';
import { alertGuards, alertVolunteer, standDownVolunteer, upgradeVolunteer } from './notification.js';
function contextFor(incident, location, respondersSoFar) {
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
function viewerFor(v) {
    return { type: 'volunteer', id: v.id, lat: v.lat, lng: v.lng, transport: v.transport };
}
/**
 * Build and send the initial tiers.
 *
 * An `unverified` incident never reaches volunteers at all: it goes to the guard
 * desk and the dashboard only, because a fake HELP from an unknown number is a
 * known way to lure a volunteer somewhere (section 16.4 #15).
 */
export async function dispatchIncident(incident, person, at = new Date()) {
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
    const sent = { tier1: [], tier2: [] };
    for (const ranked of plan.tier1) {
        await insertDispatch(incident.id, ranked.volunteer.id, 1, ranked.score, {
            ...ranked.inputs, because: ranked.because,
        });
        await alertVolunteer(incident.id, ranked.volunteer.id, 1, buildPreAcceptView(person, ctx, 1, viewerFor(ranked.volunteer)));
        sent.tier1.push(ranked.volunteer.id);
    }
    for (const ranked of plan.tier2) {
        await insertDispatch(incident.id, ranked.volunteer.id, 2, ranked.score, {
            ...ranked.inputs, because: ranked.because,
        });
        await alertVolunteer(incident.id, ranked.volunteer.id, 2, buildPreAcceptView(person, ctx, 2, viewerFor(ranked.volunteer)));
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
async function planWithWidening(incident, person, location, at) {
    const alreadyAlerted = (await listDispatches(incident.id)).map((d) => d.volunteerId);
    let radiusM = incident.searchRadiusM;
    let plan = null;
    for (;;) {
        const candidates = await findCandidates({
            lat: location.lat,
            lng: location.lng,
            radiusM,
            at,
            excludeVolunteerIds: alreadyAlerted,
        });
        plan = planTiers(candidates, { ...person, lat: location.lat, lng: location.lng }, { caseType: incident.caseType, localHour: at.getHours() }, radiusM);
        if (!plan.sparse)
            break;
        const wider = nextRadius(radiusM);
        if (wider === null)
            break;
        radiusM = wider;
    }
    return { plan: plan, radiusM };
}
/** The 30 s timer: upgrade everyone and widen the search (FR-ALT-2). */
export async function upgradeAll(incident, person, at = new Date()) {
    const upgraded = await upgradeAllDispatches(incident.id);
    const location = await currentLocation(incident.id, at);
    if (person && location) {
        const ctx = contextFor(incident, location, await countAccepted(incident.id));
        for (const d of await listDispatches(incident.id)) {
            if (d.response !== null || d.stoodDownAt !== null)
                continue;
            await upgradeVolunteer(incident.id, d.volunteerId, buildPreAcceptView(person, ctx, 1, { type: 'volunteer', id: d.volunteerId }));
        }
    }
    // Widening brings in volunteers who were outside the original circle.
    const addedTier1 = [];
    const wider = nextRadius(incident.searchRadiusM);
    if (wider !== null && person && location) {
        await setSearchRadius(incident.id, wider);
        const result = await dispatchIncident({ ...incident, searchRadiusM: wider }, person, at);
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
 * Rolling top 3 (FR-ALT-3, F17): a decline promotes the next nearest
 * volunteer straight away. Verified volunteers are preferred; if none are
 * available, the nearest unverified volunteer is promoted instead.
 */
export async function promoteAfterDeclineFor(incident, person, declinedVolunteerId, at = new Date()) {
    const location = await currentLocation(incident.id, at);
    if (!location)
        return null;
    const alreadyAlerted = (await listDispatches(incident.id)).map((d) => d.volunteerId);
    const candidates = await findCandidates({
        lat: location.lat, lng: location.lng, radiusM: incident.searchRadiusM, at,
        excludeVolunteerIds: alreadyAlerted,
    });
    const plan = planTiers(candidates, { ...person, lat: location.lat, lng: location.lng }, { caseType: incident.caseType, localHour: at.getHours() }, incident.searchRadiusM);
    const { promoted } = promoteAfterDecline({ ...plan, tier1: [], tier2: [...plan.tier1, ...plan.tier2] }, declinedVolunteerId);
    if (!promoted)
        return null;
    const ctx = contextFor(incident, location, await countAccepted(incident.id));
    await insertDispatch(incident.id, promoted.volunteer.id, 1, promoted.score, {
        ...promoted.inputs, because: promoted.because, promotedAfterDecline: declinedVolunteerId,
    });
    await alertVolunteer(incident.id, promoted.volunteer.id, 1, buildPreAcceptView(person, ctx, 1, viewerFor(promoted.volunteer)));
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
export async function standDownIfCovered(incident, at = new Date()) {
    const accepted = await countAccepted(incident.id);
    const cap = teamCapFor(incident.caseType, incident.severity);
    if (accepted < cap)
        return [];
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
export async function standDownEveryone(incidentId) {
    const stoodDown = await standDownOthers(incidentId, []);
    const dispatches = await listDispatches(incidentId);
    for (const d of dispatches) {
        if (d.response === 'accepted' || stoodDown.includes(d.volunteerId)) {
            await standDownVolunteer(incidentId, d.volunteerId, 'stand_down');
        }
    }
    return stoodDown;
}
//# sourceMappingURL=dispatch.js.map