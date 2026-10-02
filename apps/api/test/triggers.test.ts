/**
 * Trigger channels, merging, drills, never_inform and the escalation timers
 * (FR-TRG-5/6/7, FR-INC-2/6/8, FR-SET-8, FR-FAM-4).
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  authGet,
  authPost,
  dispatchRows,
  eventKinds,
  fireTimerNow,
  getApp,
  incidentRow,
  outboxFor,
  plainPost,
  pool,
  press,
  resetData,
  resetSeqs,
  signIn,
  teardown,
  waitFor,
  waitForEvent,
} from './helpers.js';
import { TimerRunner } from '../src/scheduler/runner.js';

before(async () => {
  await getApp();
});
beforeEach(async () => {
  await resetData();
  resetSeqs();
});
after(teardown);

const GPS = { gps: { lat: 13.0002, lng: 80.2668, acc_m: 8, age_s: 3 } };

/** Drive the runner by hand so a 90-second rule can be tested in milliseconds. */
async function runTimersOnce(): Promise<void> {
  const runner = new TimerRunner();
  await runner.tick(new Date());
}

// --- WhatsApp -------------------------------------------------------------

test('FR-TRG-5: HELP from a registered number raises a full incident', async () => {
  const res = await plainPost('/webhooks/whatsapp', { from: '+919999900011', text: 'HELP' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.raised_for, 'Lakshmi Raman');
  assert.equal(res.body.severity, 'P2');

  await waitForEvent(res.body.incident_id, 'dispatched');
  const rows = await dispatchRows(res.body.incident_id);
  assert.ok(rows.length > 0, 'volunteers were alerted');

  // Located from the registry, because a message carries no position.
  const row = await incidentRow(res.body.incident_id);
  assert.equal(row.source, 'whatsapp');
  const loc = await pool.query('SELECT source FROM person_locations WHERE incident_id = $1', [
    res.body.incident_id,
  ]);
  assert.equal(loc.rows[0]?.source, 'registry');
});

test('FR-TRG-6: HELP from an unknown number reaches the guard desk and NO volunteer', async () => {
  const res = await plainPost('/webhooks/whatsapp', { from: '+918888800000', text: 'HELP' });
  assert.equal(res.status, 200);
  assert.equal(res.body.severity, 'unverified');
  assert.equal(res.body.routed_to, 'guard_desk_and_dashboard_only');

  await waitForEvent(res.body.incident_id, 'dispatch_withheld');
  const rows = await dispatchRows(res.body.incident_id);
  assert.equal(rows.length, 0, 'an unknown sender must never reach volunteers automatically');

  // The guard was still told.
  const out = await outboxFor(res.body.incident_id);
  assert.ok(out.some((o) => o.template === 'guard_alert'), 'the guard desk was not alerted');
});

test('FR-TRG-7: a caregiver raises the alarm for the named dependent, at the dependent’s address', async () => {
  const res = await plainPost('/webhooks/whatsapp', { from: '+919999900010', text: 'HELP Arjun' });
  assert.equal(res.status, 200);
  assert.equal(res.body.raised_for, 'Arjun Kumar');

  const row = await incidentRow(res.body.incident_id);
  assert.equal(row.person_id, 'per_arjun');
  assert.equal(row.flags.raisedByCaregiver, true);
});

test('a caregiver with several dependents is asked which one, rather than guessing', async () => {
  const res = await plainPost('/webhooks/whatsapp', { from: '+919999900010', text: 'HELP' });
  assert.equal(res.status, 200);
  assert.equal(res.body.awaiting, 'dependent_name');
  assert.equal(res.body.incident_id, undefined, 'no incident is opened on a guess');
});

test('a CANCEL reply from a permitted number starts verification, not a cancellation', async () => {
  const open = await plainPost('/webhooks/whatsapp', { from: '+919999900011', text: 'HELP' });
  await waitForEvent(open.body.incident_id, 'dispatched');

  const res = await plainPost('/webhooks/whatsapp', { from: '+919999900011', text: 'CANCEL' });
  assert.equal(res.body.state, 'cancel_verifying');
  const row = await incidentRow(open.body.incident_id);
  assert.equal(row.closed_at, null);
});

test('a SAFE reply confirms safety - the route for a deaf or speech-impaired person', async () => {
  const open = await plainPost('/webhooks/whatsapp', { from: '+919999900011', text: 'HELP' });
  await waitForEvent(open.body.incident_id, 'dispatched');
  await plainPost('/webhooks/whatsapp', { from: '+919999900011', text: 'CANCEL' });

  const res = await plainPost('/webhooks/whatsapp', { from: '+919999900011', text: 'SAFE' });
  assert.equal(res.body.verified, 'safe');
  const row = await incidentRow(open.body.incident_id);
  assert.equal(row.state, 'resolved');
  assert.equal(row.outcome, 'cancelled_verified_safe');
});

// --- merging --------------------------------------------------------------

test('FR-INC-2: a second press within the window joins the open incident', async () => {
  const first = await press({ location: GPS });
  await waitForEvent(first.body.incident_id, 'dispatched');

  const second = await press({ location: GPS });
  assert.equal(second.body.incident_id, first.body.incident_id);
  assert.equal(second.body.merged, true);

  const count = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM incidents WHERE person_id = 'per_lakshmi' AND closed_at IS NULL",
  );
  assert.equal(count.rows[0]!.n, 1, 'one open incident per person');
  assert.ok((await eventKinds(first.body.incident_id)).includes('merged_event'));
});

test('FR-INC-2: a WhatsApp message joins an incident opened by the button', async () => {
  const button = await press({ location: GPS });
  await waitForEvent(button.body.incident_id, 'dispatched');

  const message = await plainPost('/webhooks/whatsapp', { from: '+919999900011', text: 'HELP' });
  assert.equal(message.body.incident_id, button.body.incident_id);
  assert.equal(message.body.merged, true);
});

// --- drills ---------------------------------------------------------------

test('FR-SET-8: a drill runs the whole chain, alerts no volunteer, and tells the caregiver', async () => {
  const caregiver = await signIn('+919999900010', 'caregiver');
  const res = await authPost('/api/portal/people/per_lakshmi/drill', {}, caregiver);
  assert.equal(res.status, 200);
  assert.equal(res.body.isDrill, true);
  assert.match(res.body.note, /No volunteer has been alerted/i);
  // The caregiver can preview every pattern the person will feel.
  assert.ok(res.body.patterns.length > 5);

  await waitForEvent(res.body.incident_id, 'dispatch_withheld');
  assert.equal((await dispatchRows(res.body.incident_id)).length, 0);

  const row = await incidentRow(res.body.incident_id);
  assert.equal(row.flags.drill, true);

  // The family still gets a sample message, clearly marked.
  const out = await outboxFor(res.body.incident_id);
  assert.ok(out.some((o) => o.template === 'family_alert'), 'the caregiver got no sample message');

  // And a drill arms no escalation timers at all.
  const timers = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM incident_timers WHERE incident_id = $1',
    [res.body.incident_id],
  );
  assert.equal(timers.rows[0]!.n, 0, 'a drill must not escalate to 112');
});

// --- never_inform --------------------------------------------------------

test('FR-FAM-4: a never_inform contact receives nothing, for the whole lifecycle', async () => {
  // Meera's ex-partner is flagged never_inform.
  const res = await press({ deviceId: 'GO-077', location: GPS });
  await waitForEvent(res.body.incident_id, 'dispatched');

  const nurse = await signIn('+919999900101', 'volunteer');
  await authPost(`/api/incidents/${res.body.incident_id}/respond`, { response: 'accepted' }, nurse);
  await authPost(`/api/incidents/${res.body.incident_id}/status`, { status: 'arrived' }, nurse);

  const all = await pool.query<{ recipient: string }>('SELECT recipient FROM outbox');
  for (const row of all.rows) {
    assert.notEqual(row.recipient, '+919999900015', 'the never_inform contact was messaged');
  }
  // While the sister was told.
  const out = await outboxFor(res.body.incident_id);
  assert.ok(out.some((o) => o.recipient === '+919999900014'), 'the sister should have been told');
});

// --- severity and escalation ---------------------------------------------

test('FR-INC-8: a stealth press is P1 and tells 112 at once', async () => {
  const res = await press({ deviceId: 'GO-077', location: GPS });
  assert.equal(res.body.severity, 'P1');
  await waitForEvent(res.body.incident_id, 'escalated_112');

  const row = await incidentRow(res.body.incident_id);
  assert.ok(row.escalated_at !== null);
  assert.equal(row.flags.stealth, true);
  assert.equal(row.flags.escalated, true);

  // `escalated` is a flag, not a terminal state.
  assert.notEqual(row.state, 'resolved');
  assert.equal(row.closed_at, null);

  const out = await outboxFor(res.body.incident_id);
  assert.ok(out.some((o) => o.channel === 'authority_112'));
});

test('a P1 arms no escalate112 timer, because 112 has already been told', async () => {
  const res = await press({ deviceId: 'GO-077', location: GPS });
  await waitForEvent(res.body.incident_id, 'dispatched');
  const timers = await pool.query<{ kind: string }>(
    'SELECT kind FROM incident_timers WHERE incident_id = $1',
    [res.body.incident_id],
  );
  assert.ok(!timers.rows.some((t) => t.kind === 'escalate112'));
});

test('FR-INC-6: the 30s timer upgrades everyone still waiting to Tier 1', async () => {
  const res = await press({ location: GPS });
  await waitForEvent(res.body.incident_id, 'dispatched');

  const before = await dispatchRows(res.body.incident_id);
  assert.ok(before.some((d) => d.tier === 2), 'there should be Tier 2 volunteers to upgrade');

  await fireTimerNow(res.body.incident_id, 'upgradeAll');
  await runTimersOnce();
  await waitForEvent(res.body.incident_id, 'upgraded_all');

  const after = await dispatchRows(res.body.incident_id);
  for (const d of after) {
    if (d.response === null && !d.stood_down_at) {
      assert.equal(d.tier, 1, `${d.volunteer_id} was not upgraded`);
    }
  }
});

test('FR-INC-6/8: the 90s timer escalates to 112 when nobody accepted', async () => {
  const res = await press({ location: GPS });
  await waitForEvent(res.body.incident_id, 'dispatched');

  await fireTimerNow(res.body.incident_id, 'escalate112');
  await runTimersOnce();
  await waitForEvent(res.body.incident_id, 'escalated_112');

  const row = await incidentRow(res.body.incident_id);
  assert.ok(row.escalated_at !== null);
  assert.equal(row.closed_at, null, 'telling 112 does not end the incident');
});

test('the 90s escalation does NOT fire once someone has accepted', async () => {
  const res = await press({ location: GPS });
  await waitForEvent(res.body.incident_id, 'dispatched');

  const nurse = await signIn('+919999900101', 'volunteer');
  await authPost(`/api/incidents/${res.body.incident_id}/respond`, { response: 'accepted' }, nurse);

  // Accepting cancels the timer; force any survivor to be due and run anyway.
  await fireTimerNow(res.body.incident_id, 'escalate112');
  await runTimersOnce();

  const row = await incidentRow(res.body.incident_id);
  assert.equal(row.escalated_at, null, 'nobody needed 112 - a responder was already coming');
});

test('a timer for a closed incident is a no-op, not a crash', async () => {
  const res = await press({ location: GPS });
  await waitForEvent(res.body.incident_id, 'dispatched');

  const dash = await signIn('+919999900001', 'dashboard');
  await authPost(
    `/api/dashboard/incidents/${res.body.incident_id}/close`,
    { outcome: 'no_help_needed' },
    dash,
  );

  await pool.query(
    `UPDATE incident_timers SET fire_at = now() - interval '1 second', cancelled_at = NULL, fired_at = NULL
     WHERE incident_id = $1`,
    [res.body.incident_id],
  );
  await runTimersOnce();
  assert.equal((await incidentRow(res.body.incident_id)).state, 'resolved');
});

// --- decline and the rolling top 3 ---------------------------------------

test('FR-ALT-4: a decline needs a reason, and the reason is recorded', async () => {
  const res = await press({ location: GPS });
  await waitForEvent(res.body.incident_id, 'dispatched');
  const nurse = await signIn('+919999900101', 'volunteer');

  const noReason = await authPost(
    `/api/incidents/${res.body.incident_id}/respond`,
    { response: 'declined' },
    nurse,
  );
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error.code, 'reason_required');

  const withReason = await authPost(
    `/api/incidents/${res.body.incident_id}/respond`,
    { response: 'declined', reason: 'not_safe' },
    nurse,
  );
  assert.equal(withReason.status, 200);

  const row = await pool.query<{ decline_reason: string }>(
    "SELECT decline_reason FROM dispatches WHERE incident_id = $1 AND volunteer_id = 'vol_priya_n'",
    [res.body.incident_id],
  );
  assert.equal(row.rows[0]!.decline_reason, 'not_safe');
});

test('a volunteer cannot respond twice: the first answer wins', async () => {
  const res = await press({ location: GPS });
  await waitForEvent(res.body.incident_id, 'dispatched');
  const nurse = await signIn('+919999900101', 'volunteer');

  const first = await authPost(`/api/incidents/${res.body.incident_id}/respond`, { response: 'accepted' }, nurse);
  assert.equal(first.status, 200);
  const second = await authPost(
    `/api/incidents/${res.body.incident_id}/respond`,
    { response: 'declined', reason: 'busy' },
    nurse,
  );
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'already_responded');
});

// --- availability gate ---------------------------------------------------

test('FR-VOL-8: a volunteer who has not finished the tutorial cannot go available', async () => {
  const newbie = await signIn('+919999900108', 'volunteer');
  const res = await authPost('/api/volunteer/availability', { mode: 'available_now' }, newbie);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'tutorial_required');

  await authPost('/api/volunteer/tutorial/complete', {}, newbie);
  const after = await authPost('/api/volunteer/availability', { mode: 'available_now' }, newbie);
  assert.equal(after.status, 200);
});

test('a volunteer location update between incidents stores only a coarse zone', async () => {
  const nurse = await signIn('+919999900101', 'volunteer');
  const res = await authPost('/api/volunteer/location', { lat: 13.0123, lng: 80.2456 }, nurse);
  assert.equal(res.body.stored, 'coarse_zone');
  assert.match(res.body.note, /No movement history/i);

  // Exactly one row, updated in place - never a history.
  const rows = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM volunteer_zones WHERE volunteer_id = 'vol_priya_n'",
  );
  assert.equal(rows.rows[0]!.n, 1);

  const zone = await pool.query<{ cell_lat: number }>(
    "SELECT cell_lat FROM volunteer_zones WHERE volunteer_id = 'vol_priya_n'",
  );
  assert.notEqual(zone.rows[0]!.cell_lat, 13.0123, 'the exact latitude must not be stored');
});

// --- location refinement -------------------------------------------------

test('FR-INC-9: a Wi-Fi-only report is dispatched on the registry, then refined', async () => {
  const res = await press({
    location: { wifi: [{ bssid: 'a4:2b:b0:11:22:33', rssi: -61 }] },
  });
  assert.equal(res.status, 202);
  // Dispatch did not wait for the lookup.
  assert.equal(res.body.location_source, 'registry');

  await waitForEvent(res.body.incident_id, 'location_refined');
  const sources = await pool.query<{ source: string }>(
    'SELECT source FROM person_locations WHERE incident_id = $1 ORDER BY id',
    [res.body.incident_id],
  );
  assert.deepEqual(
    sources.rows.map((r) => r.source),
    ['registry', 'wifi'],
    'the Wi-Fi estimate should arrive as a refinement',
  );
});

test('FR-INC-9: a GPS fix is not replaced by a worse later estimate', async () => {
  const res = await press({ location: GPS });
  await waitForEvent(res.body.incident_id, 'dispatched');

  // A later cell-only report, much less accurate.
  await press({
    event: 'location_update',
    location: { cell: { mcc: 404, mnc: 0, tac: 0, cell_id: 12345 } },
  });

  const dash = await signIn('+919999900001', 'dashboard');
  const detail = await authGet(`/api/dashboard/incidents/${res.body.incident_id}`, dash);
  // The dashboard shows the best position, which is still the GPS fix.
  const best = detail.body.locations.at(-1);
  assert.ok(best !== undefined);
  const row = await incidentRow(res.body.incident_id);
  assert.equal(row.closed_at, null);

  const fam = await pool.query<{ family_token: string }>(
    'SELECT family_token FROM incidents WHERE id = $1',
    [res.body.incident_id],
  );
  const famView = await authGet(`/api/family/${fam.rows[0]!.family_token}/status`, dash);
  assert.equal(famView.body.personLocation.source, 'gps', 'the map must never get worse');
  assert.equal(famView.body.personLocation.accuracyM, 8);
});
