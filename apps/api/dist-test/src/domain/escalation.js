/**
 * Escalation to 112 (FR-INC-8, FR-FAM-8).
 *
 * `escalated` is a FLAG, not a state: telling the authorities stops nothing.
 * Volunteers keep coming, the guard keeps checking, the family keeps getting
 * updates. The handoff packet itself is SIMULATED and labelled as such
 * everywhere it appears.
 */
import { describeAccuracy } from '@safecircle/shared';
import { appendEvent, findIncident, listDispatches, markEscalated, } from '../db/repositories/incidents.js';
import { findFamilyContacts, findPerson, findPersonOwnPhone } from '../db/repositories/people.js';
import { badgeFor, findVolunteer, primarySkillLabel } from '../db/repositories/volunteers.js';
import { currentLocation } from '../services/location.js';
import { pushStage } from '../services/deviceStatus.js';
import { providers } from '../providers/index.js';
/** Build the packet a control room would receive. */
export async function buildHandoffPacket(incidentId) {
    const incident = await findIncident(incidentId);
    if (!incident)
        return null;
    const person = incident.personId ? await findPerson(incident.personId) : null;
    const location = await currentLocation(incidentId);
    const onScene = [];
    for (const d of await listDispatches(incidentId)) {
        if (d.response !== 'accepted')
            continue;
        const v = await findVolunteer(d.volunteerId);
        if (!v)
            continue;
        onScene.push({
            name: v.name,
            badge: badgeFor(v.trustLevel),
            skill: primarySkillLabel(v.skills),
        });
    }
    const callbackNumbers = [];
    if (person) {
        const own = await findPersonOwnPhone(person.id);
        if (own)
            callbackNumbers.push(own);
        // Every contact, including never_inform ones: a control room investigating a
        // domestic-violence case needs the full picture, and this packet does not go
        // to the family.
        for (const c of await findFamilyContacts(person.id))
            callbackNumbers.push(c.phone);
    }
    const careSummary = [];
    if (person?.health?.conditions?.length) {
        careSummary.push(`Conditions: ${person.health.conditions.join(', ')}`);
    }
    if (person?.health?.allergies?.length) {
        careSummary.push(`Allergies: ${person.health.allergies.join(', ')}`);
    }
    if (person?.health?.bloodGroup)
        careSummary.push(`Blood group: ${person.health.bloodGroup}`);
    if (person?.health?.medicines?.length) {
        careSummary.push(`Medicines: ${person.health.medicines.join(', ')}`);
    }
    if (person?.handling?.hearing)
        careSummary.push(person.handling.hearing);
    if (person?.handling?.speech)
        careSummary.push(person.handling.speech);
    return {
        incidentId,
        personName: person?.name ?? null,
        ageBand: person?.ageBand ?? null,
        address: person
            ? [person.flat, person.address, person.landmark].filter(Boolean).join(', ')
            : null,
        location,
        locationDescription: location ? describeAccuracy(location) : null,
        careSummary,
        volunteerObservedType: incident.volunteerObservedType,
        onScene,
        callbackNumbers,
        severity: incident.severity,
        openedAt: incident.openedAt,
    };
}
/**
 * Tell the authorities. Idempotent: `markEscalated` uses COALESCE so a repeat
 * call does not move the timestamp, and the event log shows every attempt.
 */
export async function escalate(incidentId, reason) {
    const incident = await findIncident(incidentId);
    if (!incident)
        return false;
    await markEscalated(incidentId);
    const packet = await buildHandoffPacket(incidentId);
    const result = packet
        ? await providers.authority.handoff(packet)
        : { accepted: false, simulated: true };
    await appendEvent(incidentId, 'escalated_112', 'system', null, {
        reason,
        accepted: result.accepted,
        simulated: result.simulated,
        notice: result.simulated
            ? 'SIMULATED. No real ERSS-112 integration exists in this build.'
            : null,
    });
    // The person feels a distinct pattern for "police or ambulance are also
    // coming". `pushStage` withholds it on a duress incident, so an attacker who
    // forced the cancel is not tipped off (section 6.2).
    if (incident.personId && incident.state !== 'on_scene') {
        await pushStage(incident.personId, incidentId, 'escalated');
        if (incident.flags.possibleDuress === true) {
            await appendEvent(incidentId, 'device_kept_quiet', 'system', null, {
                reason: 'Possible duress: the device keeps the cancelled pattern so an attacker is not tipped off.',
                withheldStage: 'escalated',
            });
        }
    }
    return result.accepted;
}
//# sourceMappingURL=escalation.js.map