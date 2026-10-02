/**
 * The incident engine (section 8.1, FR-INC-1/2).
 *
 * One pipeline, whatever the channel:
 *   receive -> normalise -> identify -> locate -> merge -> score -> persist
 *   -> reply to the device -> dispatch -> arm timers
 *
 * Two ordering rules are deliberate and load-bearing:
 *   1. The incident and its first event are persisted, and the device is told
 *      "received", BEFORE the fan-out runs. The person should feel "we got it"
 *      while the network is still working.
 *   2. The geolocation lookup is never awaited on the critical path. Dispatch
 *      ranks on what we already know and re-ranks as better fixes arrive.
 */
import { DISPATCH, FUSION, isOpen, scheduleForNewIncident, scoreSeverity, teamCapFor, } from '@safecircle/shared';
import { config } from '../config.js';
import { tx } from '../db/pool.js';
import { appendEvent, createIncident, findOpenIncidentForPerson, insertLocation, mergeFlags, scheduleTimer, setSeverity, setState, } from '../db/repositories/incidents.js';
import { findPerson, findPersonBySenderNumber, findPersonOwnPhone } from '../db/repositories/people.js';
import { dispatchIncident } from '../services/dispatch.js';
import { pushStage } from '../services/deviceStatus.js';
import { alertFamily } from '../services/notification.js';
import { assessMovement, currentLocation, locateImmediately, refineLocation, } from '../services/location.js';
import { escalate } from './escalation.js';
import { providers } from '../providers/index.js';
/** Identify the person behind an event, whatever channel it came from. */
async function identify(event) {
    if (event.onBehalfOfPersonId)
        return findPerson(event.onBehalfOfPersonId);
    if (event.source === 'home_button' ||
        event.source === 'go_pendant' ||
        event.source === 'volunteer_app') {
        // The route has already resolved and authenticated the device or volunteer,
        // and passes the person id as the sender.
        return findPerson(event.sender);
    }
    const match = await findPersonBySenderNumber(event.sender);
    return match?.person ?? null;
}
/**
 * Raise or join an incident.
 *
 * The 10-minute merge window is enforced by the partial unique index
 * `incidents_one_open_per_person` as well as by this lookup, so two
 * simultaneous presses cannot race into two incidents.
 */
export async function ingest(event) {
    const person = await identify(event);
    const immediate = person
        ? await locateImmediately(person, event.location, event.at)
        : { location: null, refining: false };
    // Speed matters before scoring: a protected profile moving at vehicle speed is
    // a P1 (section 8.2), and we only know that from the previous fix.
    let speedMps = null;
    const openBefore = person ? await findOpenIncidentForPerson(person.id) : null;
    if (openBefore && immediate.location) {
        const previous = await currentLocation(openBefore.id, event.at);
        speedMps = assessMovement(previous, immediate.location, DISPATCH.reRankOnMoveM).speedMps;
    }
    const scored = scoreSeverity({
        event,
        person,
        possibleDuress: false,
        speedMps,
        caregiverReport: event.source === 'caregiver_link' ? event.text ?? null : null,
    });
    // --- merge ---------------------------------------------------------------
    if (openBefore && isOpen(openBefore.state)) {
        const ageMinutes = (event.at.getTime() - openBefore.openedAt.getTime()) / 60_000;
        await appendEvent(openBefore.id, 'merged_event', 'device', event.sender, {
            source: event.source,
            type: event.type,
            ageMinutes: Math.round(ageMinutes),
            reason: 'Same person already has an open incident.',
        });
        if (immediate.location)
            await insertLocation(openBefore.id, immediate.location);
        // A repeat press can raise severity but never lower it.
        if (scored.severity === 'P1' && openBefore.severity !== 'P1') {
            await setSeverity(openBefore.id, 'P1');
            await mergeFlags(openBefore.id, scored.flags);
            await escalate(openBefore.id, 'Severity raised to P1 by a repeat event.');
        }
        return {
            incident: openBefore,
            merged: true,
            person,
            location: immediate.location ?? (await currentLocation(openBefore.id, event.at)),
            severity: openBefore.severity,
            reasons: ['Joined the open incident for this person.'],
        };
    }
    // --- create --------------------------------------------------------------
    const incident = await tx(async (client) => {
        const created = await createIncident({
            personId: person?.id ?? null,
            societyId: person?.societyId ?? null,
            source: event.source,
            severity: scored.severity,
            caseType: scored.caseType,
            flags: scored.flags,
            demoTimeScale: config.demoTimeScale,
            searchRadiusM: DISPATCH.radiusStepsM[0],
            teamCap: teamCapFor(scored.caseType, scored.severity),
        }, client);
        await appendEvent(created.id, 'opened', person ? 'person' : 'unknown_sender', person?.id ?? event.sender, {
            source: event.source,
            type: event.type,
            severity: scored.severity,
            caseType: scored.caseType,
            reasons: scored.reasons,
            battery: event.battery ?? null,
        }, client);
        if (immediate.location) {
            await insertLocation(created.id, immediate.location, client);
            await appendEvent(created.id, 'located', 'system', null, {
                source: immediate.location.source,
                accuracyM: immediate.location.accuracyM,
                refining: immediate.refining,
            }, client);
        }
        // The person feels "we got it" from inside this transaction, so the
        // confirmation cannot be lost to a later failure in the fan-out.
        if (person) {
            await pushStage(person.id, created.id, 'received', client);
        }
        return created;
    });
    return {
        incident,
        merged: false,
        person,
        location: immediate.location,
        severity: scored.severity,
        reasons: scored.reasons,
    };
}
/**
 * Fan-out, timers and location refinement.
 *
 * Kept separate from `ingest` so the device route can reply the moment the
 * incident is durable, then run this. Errors here are logged to the incident
 * rather than thrown: the alert is already real, and a dashboard operator must
 * be able to see that the fan-out failed.
 */
export async function runDispatchPhase(incident, person, event) {
    try {
        await setState(incident.id, 'dispatching');
        await dispatchIncident(incident, person, event.at);
        for (const timer of scheduleForNewIncident({
            severity: incident.severity,
            openedAt: incident.openedAt,
            timeScale: incident.demoTimeScale,
            isDrill: incident.flags.drill === true,
        })) {
            await scheduleTimer(incident.id, timer.kind, timer.fireAt);
        }
        // Family is told even on a drill: FR-SET-8 requires the caregiver to receive
        // sample messages, clearly marked, so they know what a real alert looks like.
        if (person) {
            await alertFamily(person.id, {
                incidentId: incident.id,
                personName: person.name,
                familyToken: incident.familyToken ?? '',
                isDrill: incident.flags.drill === true,
                demoSpeed: incident.demoTimeScale !== 1,
            });
        }
        // Start-of-alert check-in call (Section 6.4, F15):
        // In parallel with dispatch for people with a phone and no discreet/stealth flag.
        if (person &&
            person.hasOwnPhone &&
            !incident.flags.drill &&
            !incident.flags.silentRequested &&
            person.feedbackProfile !== 'discreet' &&
            person.feedbackProfile !== 'stealth') {
            void findPersonOwnPhone(person.id).then((phone) => {
                if (!phone)
                    return;
                return providers.voice
                    .placeCall({
                    incidentId: incident.id,
                    to: phone,
                    flow: 'check_in',
                    language: person.languages[0] ?? 'en',
                    expectPin: false,
                })
                    .then(async () => {
                    await appendEvent(incident.id, 'check_in_call_placed', 'system', null, {
                        to: phone,
                        simulated: true,
                    });
                });
            }).catch(() => {
                // Never block dispatch on check-in call failure
            });
        }
        // P1 tells 112 at once (section 8.2).
        if (incident.severity === 'P1' && !incident.flags.drill) {
            await escalate(incident.id, 'P1 severity: authorities told immediately.');
        }
        // Now the slow lookup, which may improve the position for everyone.
        if (person) {
            const refined = await refineLocation(incident.id, person, event.location, event.at);
            if (refined) {
                await appendEvent(incident.id, 'location_refined', 'system', null, {
                    source: refined.source,
                    accuracyM: refined.accuracyM,
                });
            }
        }
    }
    catch (err) {
        await appendEvent(incident.id, 'dispatch_failed', 'system', null, {
            error: err.message,
        }).catch(() => {
            // If even the event log is unreachable there is nothing further to do: the
            // incident stays open and will be flagged stale on the dashboard.
        });
    }
}
/**
 * A location update from a Go pendant while an incident is open (FR-INC-11).
 * Re-ranks candidates when the person has genuinely moved, and raises P1 if a
 * protected profile is moving at vehicle speed.
 */
export async function ingestLocationUpdate(incident, person, report, at) {
    const previous = await currentLocation(incident.id, at);
    const immediate = await locateImmediately(person, report, at);
    if (!immediate.location) {
        void refineLocation(incident.id, person, report, at);
        return { location: previous, reRanked: false };
    }
    const movement = assessMovement(previous, immediate.location, DISPATCH.reRankOnMoveM);
    await insertLocation(incident.id, {
        ...immediate.location,
        speedMps: movement.speedMps ?? undefined,
    });
    if (person.protected &&
        (movement.speedMps ?? 0) >= FUSION.vehicleSpeedMps &&
        incident.severity !== 'P1') {
        await setSeverity(incident.id, 'P1');
        await mergeFlags(incident.id, { possibleAbduction: true });
        await escalate(incident.id, 'A protected profile is moving at vehicle speed: possible abduction. Volunteers are told not to chase.');
    }
    let reRanked = false;
    if (movement.shouldReRank) {
        await appendEvent(incident.id, 'location_moved', 'system', null, {
            movedM: Math.round(movement.movedM ?? 0),
            speedMps: movement.speedMps,
            reason: 'Person moved far enough to re-rank candidates.',
        });
        await dispatchIncident(incident, person, at);
        reRanked = true;
    }
    void refineLocation(incident.id, person, report, at);
    return { location: immediate.location, reRanked };
}
//# sourceMappingURL=engine.js.map