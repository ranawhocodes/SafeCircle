/**
 * The cancel path (section 6, FR-CAN-1..7).
 *
 * This is the module that makes SafeCircle different from every system surveyed
 * in section 3: a cancel moves the incident to `cancel_verifying`, it does not
 * close it. Only a positive confirmation of safety ends help. Silence, a wrong
 * PIN or the duress PIN resume the alert at high priority, while the device
 * stays quiet so an attacker who forced the cancel is not tipped off.
 */
import { canResolveFromVerifying, canTransition, nextState, } from '@safecircle/shared';
import { appendEvent, cancelTimers, closeIncident, countVerificationAttempts, findIncident, hasVerificationRecord, mergeFlags, recordVerification, setSeverity, setState, } from '../db/repositories/incidents.js';
import { findPerson } from '../db/repositories/people.js';
import { pushStage } from '../services/deviceStatus.js';
import { standDownEveryone, upgradeAll } from '../services/dispatch.js';
import { interpretOutcome, planVerification, startVerification } from '../services/verification.js';
import { escalate } from './escalation.js';
/**
 * Someone asked to cancel - a long press, a "CANCEL" reply, or the family's
 * "this is a false alarm" button. All three land here, and none of them cancels
 * anything on its own.
 */
export async function requestCancel(incidentId, requestedBy) {
    const incident = await findIncident(incidentId);
    if (!incident)
        return { ok: false, reason: 'incident_not_found' };
    if (incident.closedAt)
        return { ok: false, reason: 'incident_closed' };
    if (!incident.personId)
        return { ok: false, reason: 'no_person' };
    if (!canTransition(incident.state, 'cancel_requested')) {
        return { ok: false, reason: 'illegal_state' };
    }
    const person = await findPerson(incident.personId);
    if (!person)
        return { ok: false, reason: 'no_person' };
    await setState(incidentId, nextState(incident.state, 'cancel_requested'));
    await appendEvent(incidentId, 'cancel_requested', requestedBy.type, requestedBy.id, {
        note: 'A cancel never ends an alert on its own. Verification follows.',
    });
    // The device goes deliberately quiet here (decision #2 in the decision log).
    await pushStage(incident.personId, incidentId, 'cancel_verifying');
    const plan = await startVerification(incidentId, person, incident.demoTimeScale);
    return {
        ok: true,
        state: 'cancel_verifying',
        rationale: plan.rationale,
        requiresGuardCheck: plan.requiresGuardCheck,
    };
}
/**
 * An outcome arrived - from the dashboard in a demo, or a provider webhook in
 * production.
 *
 * Only `safe` on a profile that does not require an in-person check actually
 * closes the incident.
 */
export async function applyVerificationOutcome(incidentId, outcome, opts = {}) {
    const incident = await findIncident(incidentId);
    if (!incident)
        return { ok: false, reason: 'incident_not_found' };
    if (incident.state !== 'cancel_verifying')
        return { ok: false, reason: 'not_verifying' };
    if (!incident.personId)
        return { ok: false, reason: 'not_verifying' };
    const person = await findPerson(incident.personId);
    if (!person)
        return { ok: false, reason: 'not_verifying' };
    const attempt = await countVerificationAttempts(incidentId);
    const plan = await planVerification(person);
    const verdict = interpretOutcome(outcome, attempt, plan.requiresGuardCheck);
    await recordVerification(incidentId, plan.channel, plan.target, attempt, outcome, opts.simulated ?? true);
    if (verdict.decision === 'safe') {
        return finishAsSafe(incident, verdict.rationale);
    }
    // `no_answer` on the first attempt only means "retry": the deadline timer or
    // the retry timer will bring us back here.
    const retrying = outcome === 'no_answer' && attempt < 2;
    if (retrying) {
        await appendEvent(incidentId, 'verification_retrying', 'system', null, {
            attempt,
            rationale: verdict.rationale,
        });
        return { ok: true, decision: 'continue', duress: false, rationale: verdict.rationale, retrying };
    }
    return resumeAlert(incident, person, verdict.duress, verdict.rationale);
}
/** The only path that closes an incident as a false alarm. */
async function finishAsSafe(incident, rationale) {
    // Belt and braces for the invariant in states.ts: a cancel cannot resolve
    // without a verification on file.
    if (!(await hasVerificationRecord(incident.id))) {
        await appendEvent(incident.id, 'verification_invariant_blocked', 'system', null, {
            reason: 'Refused to close as safe with no verification record.',
        });
        return { ok: false, reason: 'not_verifying' };
    }
    if (!canResolveFromVerifying(true)) {
        return { ok: false, reason: 'not_verifying' };
    }
    await closeIncident(incident.id, 'cancelled_verified_safe');
    await cancelTimers(incident.id);
    await standDownEveryone(incident.id);
    await appendEvent(incident.id, 'verified_safe', 'system', null, {
        rationale,
        standDown: 'Stand down, person confirmed safe.',
    });
    if (incident.personId)
        await pushStage(incident.personId, incident.id, 'idle');
    return { ok: true, decision: 'safe', rationale };
}
/**
 * The attacker-forced-cancel case: the alert resumes with every volunteer at
 * high priority, flagged `possible_duress`, and 112 is told.
 *
 * The device is NOT updated: it keeps showing the cancelled pattern so an
 * attacker standing next to the person cannot tell that help is still coming.
 */
async function resumeAlert(incident, person, duress, rationale) {
    await setState(incident.id, nextState('cancel_verifying', 'verification_failed'));
    await cancelTimers(incident.id, ['verificationRetry', 'verificationDeadline']);
    if (duress) {
        await mergeFlags(incident.id, { possibleDuress: true });
        await setSeverity(incident.id, 'P1');
    }
    await appendEvent(incident.id, 'verification_failed', 'system', null, {
        rationale,
        duress,
        deviceStaysQuiet: true,
        note: 'Device keeps the cancelled pattern so an attacker is not tipped off.',
    });
    const refreshed = (await findIncident(incident.id)) ?? incident;
    await upgradeAll(refreshed, person);
    if (duress) {
        await escalate(incident.id, `Cancel could not be verified: ${rationale}`);
    }
    return { ok: true, decision: 'continue', duress, rationale, retrying: false };
}
/**
 * The verification deadline fired with no outcome at all (section 6.2: "decision
 * by about 60 s at most"). Treated exactly like an unanswered call, because that
 * is what it is.
 */
export async function verificationDeadlineReached(incidentId) {
    const incident = await findIncident(incidentId);
    if (!incident)
        return { ok: false, reason: 'incident_not_found' };
    if (incident.state !== 'cancel_verifying')
        return { ok: false, reason: 'not_verifying' };
    await appendEvent(incidentId, 'verification_deadline', 'system', null, {
        reason: 'No verification outcome in time: the alert is treated as real.',
    });
    // Force the terminal reading rather than another retry.
    await recordVerification(incidentId, 'ivr_person', null, 2, 'no_answer', true);
    return applyVerificationOutcome(incidentId, 'no_answer');
}
//# sourceMappingURL=cancel.js.map