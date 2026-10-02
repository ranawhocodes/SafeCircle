/**
 * Staged disclosure and device authenticity (FR-BRF-1/2/3, NFR-7).
 *
 * These are the tests that matter most: a leak here is the difference between a
 * safety network and a stalker's address book.
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { findForbiddenKeys } from '@safecircle/shared';
import { authGet, authPost, dispatchRows, getApp, plainGet, pool, press, resetData, resetSeqs, signFor, signIn, teardown, waitForEvent, } from './helpers.js';
before(async () => {
    await getApp();
});
beforeEach(async () => {
    await resetData();
    resetSeqs();
});
after(teardown);
const GPS = { gps: { lat: 13.0002, lng: 80.2668, acc_m: 8, age_s: 3 } };
/** Open an incident and wait until dispatch has run. */
async function openIncident() {
    const res = await press({ location: GPS });
    assert.equal(res.status, 202);
    await waitForEvent(res.body.incident_id, 'dispatched');
    return res.body.incident_id;
}
test('NFR-7: a valid signature is accepted', async () => {
    const res = await press({ location: GPS });
    assert.equal(res.status, 202);
    assert.equal(res.body.stage, 'received');
});
test('NFR-7: a tampered body is refused, and the error does not say why', async () => {
    const body = {
        device_id: 'GO-021',
        event: 'panic',
        seq: 5000,
        battery: 80,
    };
    body.signature = signFor('GO-021', body);
    body.battery = 10; // tamper after signing
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: '/api/sos/device', payload: body });
    assert.equal(res.statusCode, 401);
    // The same opaque code as every other rejection, so a prober learns nothing.
    assert.equal(res.json().error.code, 'device_event_rejected');
});
test('NFR-7: an unsigned event is refused', async () => {
    const res = await press({ signature: null });
    assert.equal(res.status, 401);
});
test('NFR-7: a replayed sequence number is refused even with a valid signature', async () => {
    const first = await press({ seq: 7000, location: GPS });
    assert.equal(first.status, 202);
    const replay = await press({ seq: 7000, location: GPS });
    assert.equal(replay.status, 409);
});
test('a sequence gap is accepted: a device that was offline must not be silenced', async () => {
    await press({ seq: 8000, location: GPS });
    const afterGap = await press({ seq: 9999, location: GPS });
    assert.equal(afterGap.status, 202);
});
test('an event from an unknown device is refused with the same opaque error', async () => {
    const app = await getApp();
    const res = await app.inject({
        method: 'POST',
        url: '/api/sos/device',
        payload: { device_id: 'NOPE-999', event: 'panic', seq: 1, signature: 'deadbeef' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, 'device_event_rejected');
});
test('an unclaimed device cannot raise an alarm, even with a valid signature', async () => {
    // HB-003 is seeded with a real key but is never claimed to a person, so there
    // is nobody to raise an alarm for.
    const res = await press({ deviceId: 'HB-003' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'device_event_rejected');
});
test('FR-BRF-1: the briefing is 403 before accepting', async () => {
    const incidentId = await openIncident();
    const nurse = await signIn('+919999900101', 'volunteer');
    const res = await authGet(`/api/incidents/${incidentId}/briefing`, nurse);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'briefing_not_authorised');
});
test('FR-BRF-1: the pre-accept alert payload contains no identifying field', async () => {
    const incidentId = await openIncident();
    const nurse = await signIn('+919999900101', 'volunteer');
    const res = await authGet('/api/volunteer/alerts', nurse);
    assert.equal(res.status, 200);
    assert.ok(res.body.alerts.length > 0, 'the nurse should have been alerted');
    assert.deepEqual(findForbiddenKeys(res.body.alerts), []);
    // And nothing identifying in the serialised form either.
    const json = JSON.stringify(res.body);
    for (const secret of ['Lakshmi', 'Paati', 'Gandhi Street', 'B-204', 'diabetes', 'Metformin', '4821', 'B-205']) {
        assert.ok(!json.includes(secret), `pre-accept payload leaked "${secret}"`);
    }
    assert.ok(!/13\.000/.test(json), 'pre-accept payload leaked an exact latitude');
});
test('FR-BRF-1: accepting unlocks the full briefing', async () => {
    const incidentId = await openIncident();
    const nurse = await signIn('+919999900101', 'volunteer');
    const accept = await authPost(`/api/incidents/${incidentId}/respond`, { response: 'accepted' }, nurse);
    assert.equal(accept.status, 200);
    const res = await authGet(`/api/incidents/${incidentId}/briefing`, nurse);
    assert.equal(res.status, 200);
    assert.equal(res.body.person.name, 'Lakshmi Raman');
    assert.equal(res.body.flat, 'B-204');
    assert.match(res.body.handlingBanner.join(' '), /Hard of hearing/);
    assert.ok(res.body.health.conditions.includes('Type 2 diabetes'));
});
test('FR-BRF-2: access secrets are absent for a volunteer, present for an on-duty guard', async () => {
    const incidentId = await openIncident();
    const nurse = await signIn('+919999900101', 'volunteer');
    await authPost(`/api/incidents/${incidentId}/respond`, { response: 'accepted' }, nurse);
    const volunteerView = await authGet(`/api/incidents/${incidentId}/briefing`, nurse);
    assert.equal(volunteerView.body.viewKind, 'accepted');
    assert.equal('accessSecrets' in volunteerView.body, false);
    assert.ok(!JSON.stringify(volunteerView.body).includes('4821'), 'gate code leaked to a volunteer');
    // Ravi is seeded on duty.
    const guard = await signIn('+919999900001', 'guard');
    const guardView = await authGet(`/api/incidents/${incidentId}/briefing`, guard);
    assert.equal(guardView.status, 200);
    assert.equal(guardView.body.viewKind, 'guard');
    assert.equal(guardView.body.accessSecrets.gateCode, '4821');
    assert.match(guardView.body.accessSecrets.spareKeyHolder, /B-205/);
});
test('FR-BRF-2: an off-duty guard does not get the guard view', async () => {
    const incidentId = await openIncident();
    // Suresh is seeded off duty.
    const guard = await signIn('+919999900002', 'guard');
    const res = await authGet(`/api/incidents/${incidentId}/briefing`, guard);
    assert.equal(res.status, 403);
});
test('FR-BRF-3: every briefing view writes exactly one audit row, including refusals', async () => {
    const incidentId = await openIncident();
    const nurse = await signIn('+919999900101', 'volunteer');
    await authGet(`/api/incidents/${incidentId}/briefing`, nurse); // denied
    let rows = await pool.query("SELECT view_kind FROM audit_log WHERE incident_id = $1 AND viewer_id = 'vol_priya_n'", [incidentId]);
    assert.deepEqual(rows.rows.map((r) => r.view_kind), ['denied']);
    await authPost(`/api/incidents/${incidentId}/respond`, { response: 'accepted' }, nurse);
    await authGet(`/api/incidents/${incidentId}/briefing`, nurse); // allowed
    rows = await pool.query("SELECT view_kind, fields FROM audit_log WHERE incident_id = $1 AND viewer_id = 'vol_priya_n' ORDER BY at", [incidentId]);
    assert.deepEqual(rows.rows.map((r) => r.view_kind), ['denied', 'accepted']);
    assert.ok(rows.rows[1].fields.includes('health'), 'the log should say which groups were released');
});
test('FR-BRF-1: a volunteer who was never alerted cannot accept, and so cannot read the briefing', async () => {
    const incidentId = await openIncident();
    // Mohan is seeded far outside every radius step.
    const far = await signIn('+919999900109', 'volunteer');
    const accept = await authPost(`/api/incidents/${incidentId}/respond`, { response: 'accepted' }, far);
    assert.equal(accept.status, 403);
    assert.equal(accept.body.error.code, 'not_alerted');
    const briefing = await authGet(`/api/incidents/${incidentId}/briefing`, far);
    assert.equal(briefing.status, 403);
});
test('FR-TRG-8: the bystander page carries no personal data at all', async () => {
    const res = await plainGet('/api/bystander/GO-042');
    assert.equal(res.status, 200);
    assert.deepEqual(findForbiddenKeys(res.body), []);
    const json = JSON.stringify(res.body);
    for (const secret of ['Arjun', 'Arju', 'C-101', 'Gandhi', 'autism', 'Peanuts']) {
        assert.ok(!json.includes(secret), `bystander page leaked "${secret}"`);
    }
    assert.match(res.body.prompt, /may need help/i);
});
test('an unknown bystander code looks exactly like a real one, so the QR cannot be probed', async () => {
    const real = await plainGet('/api/bystander/GO-042');
    const fake = await plainGet('/api/bystander/GO-999');
    assert.equal(fake.status, real.status);
    assert.equal(fake.body.prompt, real.body.prompt);
});
test('FR-ALT-1: Tier 1 is verified-only, and unverified volunteers still get Tier 2', async () => {
    const incidentId = await openIncident();
    const rows = await dispatchRows(incidentId);
    const tier1 = rows.filter((r) => r.tier === 1);
    const tier2 = rows.filter((r) => r.tier === 2);
    assert.equal(tier1.length, 3, 'exactly the 3 nearest verified volunteers');
    const levels = await pool.query('SELECT id, trust_level FROM volunteers WHERE id = ANY($1::text[])', [tier1.map((r) => r.volunteer_id)]);
    for (const v of levels.rows) {
        assert.ok(v.trust_level >= 2, `${v.id} is in Tier 1 with trust level ${v.trust_level}`);
    }
    // Sanjay is L0 and nearby: he must be alerted, just not at Tier 1.
    assert.ok(tier2.some((r) => r.volunteer_id === 'vol_sanjay'));
});
//# sourceMappingURL=disclosure.test.js.map