/**
 * The responder lifecycle (FR-VOL-1/3, FR-ALT-3/4/8, FR-BRF-1/2/3).
 *
 * Accepting is the moment staged disclosure opens, so this module is the only
 * place that records an acceptance - and it writes the audit row in the same
 * breath as the dispatch update.
 */
import { acceptsNewResponders, allowedViewKind, briefingStaysOpen, buildAcceptedView, buildGuardView, buildPreAcceptView, canTransition, DISPATCH, DisclosureDeniedError, haversineM, nextState, observedTypeWording, scheduleOnAccept, scheduleOnArrival, } from '@safecircle/shared';
import { recordView, fieldsFor } from '../security/audit.js';
import { appendEvent, cancelTimers, closeIncident, countAccepted, findDispatch, findIncident, listDispatches, recordResponse, scheduleTimer, setObservedType, setState, } from '../db/repositories/incidents.js';
import { findAccessSecrets, findPerson } from '../db/repositories/people.js';
import { adjustReliability, findVolunteer, insertFix } from '../db/repositories/volunteers.js';
import { recordCardSelection, findCard } from '../db/repositories/cards.js';
import { currentLocation } from '../services/location.js';
import { promoteAfterDeclineFor, standDownIfCovered } from '../services/dispatch.js';
import { pushStage } from '../services/deviceStatus.js';
/** Distance at which the person is told "they are almost here" (section 7.1). */
const ARRIVING_WITHIN_M = 100;
/** Auto-suggest Arrived at this distance (section 8.3). */
const ON_SCENE_WITHIN_M = 30;
async function contextFor(incident) {
    return {
        id: incident.id,
        severity: incident.severity,
        caseType: incident.caseType,
        flags: incident.flags,
        location: await currentLocation(incident.id),
        respondersSoFar: await countAccepted(incident.id),
        openedAt: incident.openedAt,
        alertTtlS: DISPATCH.alertTtlS,
    };
}
/**
 * Accept or decline an alert.
 *
 * Silence is not a response (FR-ALT-4): only an explicit tap lands here. A
 * decline requires a reason, which is recorded so dispatch can learn.
 */
export async function respond(incidentId, volunteerId, response, reason) {
    const incident = await findIncident(incidentId);
    if (!incident || incident.closedAt)
        return { ok: false, reason: 'incident_closed' };
    const dispatch = await findDispatch(incidentId, volunteerId);
    if (!dispatch)
        return { ok: false, reason: 'not_alerted' };
    if (dispatch.response !== null)
        return { ok: false, reason: 'already_responded' };
    // While a cancel is being verified no NEW responder may join (FR-CAN-5).
    if (response === 'accepted' && !acceptsNewResponders(incident.state)) {
        return { ok: false, reason: 'not_accepting' };
    }
    const recorded = await recordResponse(incidentId, volunteerId, response, reason);
    if (!recorded)
        return { ok: false, reason: 'already_responded' };
    if (response === 'declined') {
        await appendEvent(incidentId, 'declined', 'volunteer', volunteerId, {
            reason,
            tier: dispatch.tier,
        });
        // Rolling top 3: promote the next nearest verified volunteer immediately.
        let promoted = null;
        if (dispatch.tier === 1 && incident.personId) {
            const person = await findPerson(incident.personId);
            if (person) {
                promoted = await promoteAfterDeclineFor(incident, person, volunteerId);
            }
        }
        return { ok: true, response: 'declined', promoted };
    }
    await appendEvent(incidentId, 'accepted', 'volunteer', volunteerId, {
        tier: dispatch.tier,
        rankScore: dispatch.rankScore,
    });
    if (canTransition(incident.state, 'responder_accepted')) {
        await setState(incidentId, nextState(incident.state, 'responder_accepted'));
    }
    // The 90 s escalation is no longer needed once someone is coming, but the
    // family call still is - an accepted alert is exactly when they want to know.
    await cancelTimers(incidentId, ['escalate112', 'upgradeAll']);
    for (const t of scheduleOnAccept(new Date(), incident.demoTimeScale)) {
        await scheduleTimer(incidentId, t.kind, t.fireAt);
    }
    if (incident.personId) {
        await pushStage(incident.personId, incidentId, 'accepted');
    }
    await standDownIfCovered(incident);
    return { ok: true, response: 'accepted' };
}
/**
 * The briefing. Returns `403`-worthy failure rather than a trimmed payload,
 * because FR-BRF-1 requires the identifying fields never to be assembled at all
 * for someone who has not accepted.
 */
export async function briefing(incidentId, viewer) {
    const incident = await findIncident(incidentId);
    if (!incident || !incident.personId) {
        throw new DisclosureDeniedError(viewer, incidentId, 'accepted');
    }
    if (viewer.type === 'volunteer') {
        const dispatch = await findDispatch(incidentId, viewer.id);
        const accepted = dispatch?.response === 'accepted';
        // A responder keeps their briefing while a cancel is verified: "continue
        // unless stood down" (section 6.2).
        const stillEntitled = accepted && (briefingStaysOpen(incident.state) || !incident.closedAt);
        viewer = { ...viewer, hasAcceptedThisIncident: stillEntitled };
    }
    const kind = allowedViewKind(viewer);
    if (kind === 'pre_accept') {
        await recordView({
            viewerType: viewer.type,
            viewerId: viewer.id,
            personId: incident.personId,
            incidentId,
            viewKind: 'denied',
        });
        throw new DisclosureDeniedError(viewer, incidentId, 'accepted');
    }
    const person = await findPerson(incident.personId);
    if (!person)
        throw new DisclosureDeniedError(viewer, incidentId, kind);
    const ctx = await contextFor(incident);
    const masked = {
        family: '+91-xxxxx-' + incident.id.slice(-4),
        guard: '+91-xxxxx-0000',
    };
    await recordView({
        viewerType: viewer.type,
        viewerId: viewer.id,
        personId: person.id,
        incidentId,
        viewKind: kind,
        fields: [...fieldsFor(kind)],
    });
    if (kind === 'guard') {
        const secrets = await findAccessSecrets(person.id);
        return buildGuardView(person, ctx, secrets, masked);
    }
    return buildAcceptedView(person, ctx, masked);
}
/** The pre-accept alert list for a volunteer (FR-VOL-1). */
export async function alertsFor(volunteerId) {
    const volunteer = await findVolunteer(volunteerId);
    if (!volunteer)
        return [];
    const out = [];
    const openIncidents = await listOpenAlertable();
    for (const incident of openIncidents) {
        let dispatch = await findDispatch(incident.id, volunteerId);
        if (!dispatch && incident.personId && !incident.flags.drill && incident.severity !== 'unverified') {
            // If this available volunteer was not in the initial dispatch (e.g. they were off duty),
            // check if they are eligible now and dispatch them!
            const isAvailable = volunteer.availabilityMode === 'available_now' ||
                (volunteer.availabilityMode === 'available_until' &&
                    volunteer.availableUntil &&
                    volunteer.availableUntil > new Date());
            if (isAvailable && !volunteer.suspendedAt && volunteer.tutorialCompletedAt) {
                const person = await findPerson(incident.personId);
                if (person) {
                    const { dispatchIncident } = await import('../services/dispatch.js');
                    await dispatchIncident(incident, person);
                    dispatch = await findDispatch(incident.id, volunteerId);
                }
            }
        }
        if (!dispatch || dispatch.response !== null || dispatch.stoodDownAt !== null)
            continue;
        if (!incident.personId)
            continue;
        const person = await findPerson(incident.personId);
        if (!person)
            continue;
        const ctx = await contextFor(incident);
        out.push(buildPreAcceptView(person, ctx, dispatch.tier, {
            type: 'volunteer',
            id: volunteerId,
            lat: volunteer.homeLat ?? undefined,
            lng: volunteer.homeLng ?? undefined,
        }));
    }
    return out;
}
export async function listOpenAlertable() {
    const { listOpenIncidents } = await import('../db/repositories/incidents.js');
    return listOpenIncidents(50);
}
/**
 * A responder status tap (FR-VOL-3). Each one moves the incident, updates what
 * the person feels, and is appended to the event log.
 */
export async function recordStatus(incidentId, volunteerId, tap, outcomeNote) {
    const incident = await findIncident(incidentId);
    if (!incident)
        return { ok: false, reason: 'incident_not_found' };
    const dispatch = await findDispatch(incidentId, volunteerId);
    if (!dispatch || dispatch.response !== 'accepted') {
        return { ok: false, reason: 'not_an_accepted_responder' };
    }
    await appendEvent(incidentId, `status_${tap}`, 'volunteer', volunteerId, {
        note: outcomeNote ?? null,
    });
    switch (tap) {
        case 'on_my_way': {
            if (canTransition(incident.state, 'responder_on_my_way')) {
                await setState(incidentId, nextState(incident.state, 'responder_on_my_way'));
            }
            return { ok: true, state: 'en_route' };
        }
        case 'arrived': {
            if (canTransition(incident.state, 'responder_arrived')) {
                await setState(incidentId, nextState(incident.state, 'responder_arrived'));
            }
            await cancelTimers(incidentId, ['stillComing']);
            for (const t of scheduleOnArrival(new Date(), incident.demoTimeScale)) {
                await scheduleTimer(incidentId, t.kind, t.fireAt);
            }
            if (incident.personId)
                await pushStage(incident.personId, incidentId, 'arrived');
            await adjustReliability(volunteerId, 0.05);
            return { ok: true, state: 'on_scene' };
        }
        case 'need_backup': {
            // Not a state change: the case simply needs more hands, so the remaining
            // alerted volunteers are un-stood-down by raising the cap for this case.
            await appendEvent(incidentId, 'backup_requested', 'volunteer', volunteerId, {});
            return { ok: true, state: incident.state };
        }
        case 'handed_to_ambulance': {
            await closeIncident(incidentId, 'handed_to_ambulance');
            await cancelTimers(incidentId);
            if (incident.personId)
                await pushStage(incident.personId, incidentId, 'idle');
            return { ok: true, state: 'resolved' };
        }
        case 'resolved': {
            const outcome = outcomeNote === 'no_help_needed' ? 'no_help_needed' : 'helped_on_scene';
            await closeIncident(incidentId, outcome);
            await cancelTimers(incidentId);
            if (incident.personId)
                await pushStage(incident.personId, incidentId, 'idle');
            await adjustReliability(volunteerId, 0.05);
            return { ok: true, state: 'resolved' };
        }
        case 'cant_attend': {
            // Withdrawing after accepting re-opens the incident rather than closing it.
            await recordResponse(incidentId, volunteerId, 'declined', 'busy');
            await adjustReliability(volunteerId, -0.1);
            const stillAccepted = await countAccepted(incidentId);
            if (stillAccepted === 0 && canTransition(incident.state, 'all_responders_withdrew')) {
                await setState(incidentId, nextState(incident.state, 'all_responders_withdrew'));
                await appendEvent(incidentId, 'reopened', 'system', null, {
                    reason: 'Every responder withdrew; the incident is open again.',
                });
            }
            return { ok: true, state: stillAccepted === 0 ? 'dispatching' : incident.state };
        }
    }
}
/**
 * A live fix from an en-route responder (location layer L4). Also drives the
 * "they are almost here" pattern and the Arrived suggestion.
 */
export async function recordResponderFix(incidentId, volunteerId, lat, lng, accuracyM) {
    const incident = await findIncident(incidentId);
    if (!incident)
        return { distanceM: null, suggestArrived: false };
    await insertFix(volunteerId, incidentId, lat, lng, accuracyM);
    const personLocation = await currentLocation(incidentId);
    if (!personLocation)
        return { distanceM: null, suggestArrived: false };
    const distanceM = haversineM(lat, lng, personLocation.lat, personLocation.lng);
    if (distanceM <= ARRIVING_WITHIN_M && incident.personId && incident.state === 'en_route') {
        await pushStage(incident.personId, incidentId, 'arriving');
    }
    return { distanceM, suggestArrived: distanceM <= ON_SCENE_WITHIN_M };
}
/**
 * The flashcard tap (FR-BRF-6). The wording is a report, never a diagnosis, and
 * every change is kept.
 */
export async function selectCard(incidentId, volunteerId, cardKey) {
    const dispatch = await findDispatch(incidentId, volunteerId);
    if (!dispatch || dispatch.response !== 'accepted') {
        return { ok: false, reason: 'not_an_accepted_responder' };
    }
    const card = await findCard(cardKey);
    if (!card)
        return { ok: false, reason: 'card_not_found_or_unreviewed' };
    await recordCardSelection(incidentId, volunteerId, cardKey);
    const wording = observedTypeWording(card.title);
    await setObservedType(incidentId, wording);
    await appendEvent(incidentId, 'card_selected', 'volunteer', volunteerId, {
        cardKey,
        wording,
    });
    return { ok: true, wording };
}
/** Who has accepted, for the family page and the 112 packet. */
export async function respondersFor(incidentId) {
    const out = [];
    for (const d of await listDispatches(incidentId)) {
        if (d.response !== 'accepted')
            continue;
        const v = await findVolunteer(d.volunteerId);
        if (!v)
            continue;
        out.push({
            volunteerId: v.id,
            name: v.name,
            trustLevel: v.trustLevel,
            skills: v.skills,
            response: d.response,
        });
    }
    return out;
}
//# sourceMappingURL=responder.js.map