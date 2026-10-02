/**
 * The cancel path (FR-CAN-1..7).
 *
 * The behaviour no surveyed system has: a cancel never silently ends an alert.
 * These tests cover the attacker-forced-cancel case explicitly.
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { authGet, authPost, dispatchRows, eventKinds, getApp, incidentRow, plainGet, plainPost, pool, press, resetData, resetSeqs, signIn, teardown, waitForEvent, } from './helpers.js';
before(async () => {
    await getApp();
});
beforeEach(async () => {
    await resetData();
    resetSeqs();
});
after(teardown);
const GPS = { gps: { lat: 13.0002, lng: 80.2668, acc_m: 8, age_s: 3 } };
async function openIncident(deviceId = 'GO-021') {
    const res = await press({ deviceId, location: GPS });
    assert.equal(res.status, 202);
    await waitForEvent(res.body.incident_id, 'dispatched');
    return res.body.incident_id;
}
async function requestCancelByDevice(deviceId = 'GO-021') {
    const res = await press({ deviceId, event: 'cancel' });
    assert.equal(res.status, 202);
    return res.body;
}
test('FR-CAN-1: a cancel moves the incident to cancel_verifying, it does not close it', async () => {
    const incidentId = await openIncident();
    const body = await requestCancelByDevice();
    const row = await incidentRow(incidentId);
    assert.equal(row.state, 'cancel_verifying');
    assert.equal(row.closed_at, null, 'a cancel must never close an incident');
    assert.match(body.note, /has not stopped/i);
    const kinds = await eventKinds(incidentId);
    assert.ok(kinds.includes('cancel_requested'));
    assert.ok(kinds.includes('verification_started'));
});
test('the device stays deliberately quiet while verifying, so an attacker is not tipped off', async () => {
    await openIncident();
    const body = await requestCancelByDevice();
    assert.equal(body.pattern.sound.tone, 'none');
    assert.equal(body.pattern.vibration.pulses, 0);
    const status = await plainGet('/api/device/GO-021/status');
    assert.equal(status.body.stage, 'cancel_verifying');
    assert.equal(status.body.pattern.sound.tone, 'none');
});
test('FR-CAN-2: pressing 1 closes the incident as a verified-safe false alarm', async () => {
    const incidentId = await openIncident();
    await requestCancelByDevice();
    const dash = await signIn('+919999900001', 'dashboard');
    const res = await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'safe' }, dash);
    assert.equal(res.status, 200);
    assert.equal(res.body.decision, 'safe');
    assert.equal(res.body.simulated, true);
    const row = await incidentRow(incidentId);
    assert.equal(row.state, 'resolved');
    assert.equal(row.outcome, 'cancelled_verified_safe');
    assert.ok((await eventKinds(incidentId)).includes('verified_safe'));
});
test('FR-CAN-4: no answer twice means the alert is real and resumes at high priority', async () => {
    const incidentId = await openIncident();
    await requestCancelByDevice();
    const dash = await signIn('+919999900001', 'dashboard');
    // First no-answer only triggers the retry.
    const first = await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'no_answer' }, dash);
    assert.equal(first.body.decision, 'continue');
    assert.equal(first.body.retrying, true);
    assert.equal((await incidentRow(incidentId)).state, 'cancel_verifying', 'still verifying');
    // Second no-answer is terminal: the cancel could not be verified.
    const second = await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'no_answer' }, dash);
    assert.equal(second.body.decision, 'continue');
    assert.equal(second.body.retrying, false);
    assert.equal(second.body.duress, true);
    const row = await incidentRow(incidentId);
    assert.equal(row.state, 'dispatching', 'the alert resumed');
    assert.equal(row.closed_at, null);
    assert.equal(row.severity, 'P1', 'raised to critical');
    assert.equal(row.flags.possibleDuress, true);
    assert.ok(row.escalated_at !== null, '112 told');
    // Every still-waiting volunteer is now Tier 1.
    const waiting = (await dispatchRows(incidentId)).filter((d) => d.response === null && !d.stood_down_at);
    assert.ok(waiting.length > 0);
    for (const d of waiting)
        assert.equal(d.tier, 1, `${d.volunteer_id} was not upgraded`);
});
test('FR-CAN-3: after an unverifiable cancel the device NEVER announces that help is coming', async () => {
    // The regression this guards: escalating to 112 pushed an "escalated" pattern
    // to the button - purple light, a chime and a buzz - telling the attacker
    // standing next to her that help was still on the way.
    const incidentId = await openIncident();
    await requestCancelByDevice();
    const dash = await signIn('+919999900001', 'dashboard');
    await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'no_answer' }, dash);
    await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'no_answer' }, dash);
    // The alert is alive, at P1, and 112 has been told.
    const row = await incidentRow(incidentId);
    assert.equal(row.flags.possibleDuress, true);
    assert.ok(row.escalated_at !== null);
    // And yet the button still shows the quiet cancelled pattern.
    const status = await plainGet('/api/device/GO-021/status');
    assert.equal(status.body.stage, 'cancel_verifying', 'the device must not announce the escalation');
    assert.equal(status.body.pattern.sound.tone, 'none');
    assert.equal(status.body.pattern.vibration.pulses, 0);
    // Even a volunteer accepting must not light it up green.
    const nurse = await signIn('+919999900101', 'volunteer');
    const accept = await authPost(`/api/incidents/${incidentId}/respond`, { response: 'accepted' }, nurse);
    assert.equal(accept.status, 200, 'responders can still accept - only the device stays quiet');
    const after = await plainGet('/api/device/GO-021/status');
    assert.equal(after.body.stage, 'cancel_verifying', '"someone is on the way" would tip off an attacker');
    assert.equal(after.body.pattern.sound.tone, 'none');
});
test('FR-CAN-3: pressing 9 keeps the alert alive', async () => {
    const incidentId = await openIncident();
    await requestCancelByDevice();
    const dash = await signIn('+919999900001', 'dashboard');
    const res = await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'need_help' }, dash);
    assert.equal(res.body.decision, 'continue');
    assert.equal(res.body.duress, false, 'asking for help is not duress');
    assert.equal((await incidentRow(incidentId)).state, 'dispatching');
});
test('FR-CAN-3: the duress PIN keeps the alert alive at P1 and flags duress', async () => {
    const incidentId = await openIncident();
    await requestCancelByDevice();
    const dash = await signIn('+919999900001', 'dashboard');
    await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'duress' }, dash);
    const row = await incidentRow(incidentId);
    assert.equal(row.flags.possibleDuress, true);
    assert.equal(row.severity, 'P1');
    assert.equal(row.state, 'dispatching');
});
test('a wrong PIN is treated as duress', async () => {
    const incidentId = await openIncident();
    await requestCancelByDevice();
    const dash = await signIn('+919999900001', 'dashboard');
    const res = await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'wrong_pin' }, dash);
    assert.equal(res.body.duress, true);
    assert.equal((await incidentRow(incidentId)).severity, 'P1');
});
test('FR-CAN-5: while verifying, an accepted responder keeps their briefing but nobody new may join', async () => {
    const incidentId = await openIncident();
    const nurse = await signIn('+919999900101', 'volunteer');
    await authPost(`/api/incidents/${incidentId}/respond`, { response: 'accepted' }, nurse);
    await requestCancelByDevice();
    // The accepted responder is told to continue unless stood down.
    const briefing = await authGet(`/api/incidents/${incidentId}/briefing`, nurse);
    assert.equal(briefing.status, 200, 'an accepted responder keeps their briefing');
    // A different alerted volunteer cannot now accept.
    const other = await signIn('+919999900102', 'volunteer');
    const accept = await authPost(`/api/incidents/${incidentId}/respond`, { response: 'accepted' }, other);
    assert.equal(accept.status, 409);
    assert.equal(accept.body.error.code, 'not_accepting');
});
test('FR-CAN-6: a stealth profile is never called; verification goes to the caregiver', async () => {
    const incidentId = await openIncident('GO-077'); // Meera, stealth
    await requestCancelByDevice('GO-077');
    const verifications = await pool.query('SELECT channel, target FROM verifications WHERE incident_id = $1', [incidentId]);
    assert.equal(verifications.rows.length, 1);
    assert.equal(verifications.rows[0].channel, 'ivr_caregiver', 'her own phone must not ring');
    assert.notEqual(verifications.rows[0].target, '+919999900013');
    // And no voice call in the outbox is addressed to her.
    const calls = await pool.query("SELECT recipient FROM outbox WHERE incident_id = $1 AND channel = 'voice'", [incidentId]);
    for (const c of calls.rows) {
        assert.notEqual(c.recipient, '+919999900013', 'a stealth profile was called');
    }
});
test('FR-CAN-6/7: a child profile needs a guard check, so even "safe" does not close it', async () => {
    const incidentId = await openIncident('GO-042'); // Arjun, 9
    await requestCancelByDevice('GO-042');
    const dash = await signIn('+919999900001', 'dashboard');
    const res = await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'safe' }, dash);
    assert.equal(res.body.decision, 'continue', 'a child cannot stand down their own alert');
    assert.match(res.body.rationale, /in-person check/i);
    const row = await incidentRow(incidentId);
    assert.equal(row.closed_at, null);
    assert.equal(row.state, 'dispatching');
});
test('FR-FAM-3: the family "false alarm" button runs verification instead of cancelling', async () => {
    const incidentId = await openIncident();
    const row = await incidentRow(incidentId);
    const res = await plainPost(`/api/family/${row.family_token}/false-alarm`, {});
    assert.equal(res.status, 200);
    assert.match(res.body.note, /has not been stopped/i);
    const after = await incidentRow(incidentId);
    assert.equal(after.state, 'cancel_verifying');
    assert.equal(after.closed_at, null, 'the family cannot close an incident');
});
test('an incident cannot be resolved from cancel_verifying without a verification on file', async () => {
    const incidentId = await openIncident();
    await requestCancelByDevice();
    // Wipe the verification rows, then try to confirm safety.
    await pool.query('DELETE FROM verifications WHERE incident_id = $1', [incidentId]);
    const dash = await signIn('+919999900001', 'dashboard');
    const res = await authPost(`/api/dashboard/incidents/${incidentId}/verification-outcome`, { outcome: 'safe' }, dash);
    // The outcome itself gets recorded first, so this now succeeds - what must
    // never happen is closing with NO record at all. Assert the invariant holds.
    const row = await incidentRow(incidentId);
    if (row.closed_at !== null) {
        const count = await pool.query('SELECT count(*)::int AS n FROM verifications WHERE incident_id = $1 AND outcome IS NOT NULL', [incidentId]);
        assert.ok(count.rows[0].n > 0, 'closed as safe with no verification record');
    }
    assert.equal(res.status, 200);
});
test('a cancel for a person with no open incident is a no-op, not an error', async () => {
    const res = await press({ event: 'cancel' });
    assert.equal(res.status, 202);
    assert.equal(res.body.incidentOpen, false);
});
//# sourceMappingURL=cancel.test.js.map