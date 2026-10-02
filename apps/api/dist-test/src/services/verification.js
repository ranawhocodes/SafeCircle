/**
 * Cancel verification (section 6, FR-CAN-1..7).
 *
 * The rule that makes SafeCircle different: a cancel NEVER silently ends an
 * alert. Only a positive confirmation of safety does. Silence, a wrong PIN or
 * the duress PIN all keep help coming, while the device stays quiet so an
 * attacker who forced the cancel is not tipped off.
 */
import { TIMERS_S, allowsCallToPerson, scheduleOnCancelRequest, } from '@safecircle/shared';
import { appendEvent, countVerificationAttempts, recordVerification, scheduleTimer, } from '../db/repositories/incidents.js';
import { findPersonOwnPhone, informableFamilyContacts } from '../db/repositories/people.js';
import { providers } from '../providers/index.js';
/**
 * Choose how to verify, from the person's profile (section 6.3).
 *
 * A ringing phone can endanger someone being followed, so discreet and stealth
 * profiles are NEVER called. A person with a cognitive disability cannot
 * meaningfully confirm their own safety, so a caregiver answer is not enough
 * either - the guard still checks.
 */
export async function planVerification(person) {
    if (!allowsCallToPerson(person.feedbackProfile)) {
        const family = await informableFamilyContacts(person.id);
        return {
            channel: 'ivr_caregiver',
            target: family[0]?.phone ?? null,
            rationale: 'Discreet or stealth profile: a ringing phone could endanger her, so the person is never called. Responders continue.',
            requiresGuardCheck: true,
        };
    }
    const isChild = person.ageBand === '0-12' || person.ageBand === '13-17';
    if (isChild || !person.hasOwnPhone) {
        const family = await informableFamilyContacts(person.id);
        return {
            channel: 'ivr_caregiver',
            target: family[0]?.phone ?? null,
            rationale: isChild
                ? 'Child profile: the parent is called and a doorstep or on-site check is done.'
                : 'No phone of their own: the caregiver is called and the guard checks in person.',
            requiresGuardCheck: true,
        };
    }
    // A cognitive-disability profile is marked `protected` with handling notes; a
    // cancel from the person alone can never close the alert.
    if (person.protected) {
        const phone = await findPersonOwnPhone(person.id);
        return {
            channel: 'ivr_person',
            target: phone,
            rationale: 'Protected profile: the person is called, but a caregiver confirmation alone does not stand down the guard check.',
            requiresGuardCheck: true,
        };
    }
    if (person.handling?.hearing || person.handling?.speech) {
        return {
            channel: 'message_person',
            target: await findPersonOwnPhone(person.id),
            rationale: 'Hearing or speech needs: verification goes by message, with a device double-press as the confirm.',
            requiresGuardCheck: false,
        };
    }
    return {
        channel: 'ivr_person',
        target: await findPersonOwnPhone(person.id),
        rationale: 'Standard profile: automated call to the person with 1 safe / 9 help.',
        requiresGuardCheck: false,
    };
}
/**
 * Start verification. Timers are armed first so a provider failure can never
 * leave an incident waiting forever in `cancel_verifying`.
 */
export async function startVerification(incidentId, person, timeScale, at = new Date()) {
    const plan = await planVerification(person);
    const attempt = (await countVerificationAttempts(incidentId)) + 1;
    for (const timer of scheduleOnCancelRequest(at, timeScale)) {
        await scheduleTimer(incidentId, timer.kind, timer.fireAt);
    }
    await recordVerification(incidentId, plan.channel, plan.target, attempt, null, true);
    await appendEvent(incidentId, 'verification_started', 'system', null, {
        channel: plan.channel,
        rationale: plan.rationale,
        requiresGuardCheck: plan.requiresGuardCheck,
        attempt,
        simulated: true,
        deadlineS: TIMERS_S.verificationDeadline,
    });
    if (plan.target && (plan.channel === 'ivr_person' || plan.channel === 'ivr_caregiver')) {
        await providers.voice.placeCall({
            incidentId,
            to: plan.target,
            flow: 'verify_cancel',
            language: person.languages[0] ?? 'en',
            expectPin: person.safePinSet || person.duressPinSet,
        });
    }
    else if (plan.target && plan.channel === 'message_person') {
        await providers.messaging.send({
            incidentId,
            to: plan.target,
            template: 'verify_cancel',
            channel: 'whatsapp',
            params: { prompt: 'Reply SAFE if you are safe, or HELP if you still need help.' },
        });
    }
    return plan;
}
/**
 * Interpret an outcome. Only one of three answers ends help; everything else
 * keeps the alert alive (section 6).
 */
export function interpretOutcome(outcome, attempt, requiresGuardCheck) {
    switch (outcome) {
        case 'safe':
            return requiresGuardCheck
                ? {
                    decision: 'continue',
                    duress: false,
                    rationale: 'Confirmed safe, but this profile still needs an in-person check before help stands down.',
                }
                : { decision: 'safe', rationale: 'Person pressed 1 and confirmed they are safe.' };
        case 'need_help':
            return {
                decision: 'continue',
                duress: false,
                rationale: 'Person pressed 9: they still need help.',
            };
        case 'wrong_pin':
            return {
                decision: 'continue',
                duress: true,
                rationale: 'Wrong safe PIN: treated as possible duress.',
            };
        case 'duress':
            return {
                decision: 'continue',
                duress: true,
                rationale: 'Duress PIN entered: alert continues at high priority.',
            };
        case 'no_answer':
            // One retry, then the alert is real. This is the attacker-forced-cancel case.
            return attempt >= 2
                ? {
                    decision: 'continue',
                    duress: true,
                    rationale: 'No answer after a retry: the cancel could not be verified, so the alert is treated as real.',
                }
                : {
                    decision: 'continue',
                    duress: false,
                    rationale: 'No answer on the first attempt: retrying.',
                };
    }
}
//# sourceMappingURL=verification.js.map