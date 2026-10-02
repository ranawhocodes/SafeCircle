/**
 * Start-of-alert check-in call (Section 6.4, F15).
 *
 * For people with a phone and no discreet or stealth flag, an IVR call is placed
 * in parallel with dispatch:
 * "Press 1 medical, 2 fall, 3 danger, 4 pressed by mistake."
 *
 * It never delays dispatch.
 * No answer means nothing changes (unless cardiac/seizure history, which elevates to P1).
 * "4" behaves like a cancel and goes through verification.
 * The answer seeds the volunteer flashcards and can upgrade severity/caseType.
 */
import { isOpen, scoreSeverity } from '@safecircle/shared';
import { appendEvent, findIncident, mergeFlags, setCaseType, setSeverity, } from '../db/repositories/incidents.js';
import { findPerson } from '../db/repositories/people.js';
import { requestCancel } from './cancel.js';
import { escalate } from './escalation.js';
export async function applyCheckInAnswer(incidentId, answer) {
    const incident = await findIncident(incidentId);
    if (!incident)
        return { ok: false, reason: 'incident_not_found' };
    if (!isOpen(incident.state))
        return { ok: false, reason: 'incident_closed' };
    if (answer === 'mistake') {
        if (incident.personId) {
            await requestCancel(incident.id, { type: 'person', id: incident.personId });
        }
        await appendEvent(incident.id, 'check_in_answered', 'person', incident.personId, {
            answer: 'mistake',
            action: 'verification_started',
        });
        await mergeFlags(incident.id, { checkInAnswer: 'mistake' });
        return { ok: true, answer: 'mistake' };
    }
    const person = incident.personId ? await findPerson(incident.personId) : null;
    const scored = scoreSeverity({
        event: {
            source: incident.source,
            type: 'panic',
            sender: incident.personId ?? 'unknown',
            at: new Date(),
        },
        person,
        checkInAnswer: answer,
    });
    await mergeFlags(incident.id, { checkInAnswer: answer });
    await appendEvent(incident.id, 'check_in_answered', 'person', incident.personId, {
        answer,
        severity: scored.severity,
        caseType: scored.caseType,
    });
    if (scored.caseType && scored.caseType !== incident.caseType) {
        await setCaseType(incident.id, scored.caseType);
    }
    if (scored.severity === 'P1' && incident.severity !== 'P1') {
        await setSeverity(incident.id, 'P1');
        await escalate(incident.id, `Check-in call outcome escalated severity to P1 (${answer}).`);
    }
    return { ok: true, answer };
}
//# sourceMappingURL=checkIn.js.map