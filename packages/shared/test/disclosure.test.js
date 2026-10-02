import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedViewKind, buildPreAcceptView, buildAcceptedView, buildGuardView,
  findForbiddenKeys, FORBIDDEN_PRE_ACCEPT_KEYS, DisclosureDeniedError,
} from '../dist/disclosure.js';
import { lakshmi, meera, eastOf } from './helpers.js';

const incident = {
  id: 'inc-1',
  severity: 'P2',
  caseType: 'fall',
  flags: {},
  location: { lat: 13.0827, lng: 80.2707, accuracyM: 8, source: 'gps', at: new Date('2026-10-01T06:00:00Z') },
  respondersSoFar: 0,
  openedAt: new Date('2026-10-01T06:00:00Z'),
  alertTtlS: 300,
};

const nearbyVolunteer = (over = {}) => ({
  type: 'volunteer', id: 'v1', transport: 'walk',
  ...eastOf(13.0827, 80.2707, 420), ...over,
});

test('FR-BRF-1: a volunteer who has not accepted gets only the pre-accept view', () => {
  assert.equal(allowedViewKind(nearbyVolunteer()), 'pre_accept');
  assert.equal(allowedViewKind(nearbyVolunteer({ hasAcceptedThisIncident: false })), 'pre_accept');
});

test('FR-BRF-1: accepting unlocks the full briefing', () => {
  assert.equal(allowedViewKind(nearbyVolunteer({ hasAcceptedThisIncident: true })), 'accepted');
});

test('FR-BRF-2: only an ON-DUTY guard gets the guard view', () => {
  assert.equal(allowedViewKind({ type: 'guard', id: 'g1', isOnDutyForSociety: true }), 'guard');
  assert.equal(allowedViewKind({ type: 'guard', id: 'g1', isOnDutyForSociety: false }), 'pre_accept');
});

test('FR-BRF-1: the pre-accept payload contains NO identifying field at all', () => {
  const view = buildPreAcceptView(lakshmi, incident, 1, nearbyVolunteer());
  const leaked = findForbiddenKeys(view);
  assert.deepEqual(leaked, [], `leaked: ${leaked.join(', ')}`);
  // Belt and braces: the serialised form must not contain her name or address.
  const json = JSON.stringify(view);
  assert.ok(!json.includes('Lakshmi'), 'name must not appear even in a nested string');
  assert.ok(!json.includes('Gandhi Street'));
  assert.ok(!json.includes('B-204'));
  assert.ok(!json.includes('diabetes') && !json.includes('Metformin'));
});

test('the pre-accept view still carries everything needed to decide in seconds', () => {
  const view = buildPreAcceptView(lakshmi, incident, 1, nearbyVolunteer());
  assert.equal(view.tier, 1);
  assert.equal(view.category, 'fall');
  assert.equal(view.ageBand, '75+');
  assert.ok(view.etaS > 0);
  assert.ok(view.distanceBandM > 0);
  assert.ok(view.expiresAt > incident.openedAt);
});

test('pre-accept distance is banded, so repeated alerts cannot triangulate an address', () => {
  const a = buildPreAcceptView(lakshmi, incident, 1, nearbyVolunteer({ ...eastOf(13.0827, 80.2707, 412) }));
  const b = buildPreAcceptView(lakshmi, incident, 1, nearbyVolunteer({ ...eastOf(13.0827, 80.2707, 437) }));
  assert.equal(a.distanceBandM, b.distanceBandM, 'both round to the same band');
  assert.equal(a.distanceBandM % 100, 0);
});

test('a stealth profile is flagged pre-accept and told to arrive quietly', () => {
  const view = buildPreAcceptView(meera, { ...incident, caseType: 'harassment' }, 1, nearbyVolunteer());
  assert.equal(view.stealth, true);
  assert.match(view.safetyNotice, /quietly/);
  assert.match(view.safetyNotice, /Do not confront/);
  assert.deepEqual(findForbiddenKeys(view), []);
});

test('a drill is labelled pre-accept, so nobody treats it as real', () => {
  const view = buildPreAcceptView(lakshmi, { ...incident, flags: { drill: true } }, 2, nearbyVolunteer());
  assert.equal(view.isDrill, true);
});

test('the accepted view releases identity, location and handling notes', () => {
  const view = buildAcceptedView(lakshmi, incident, { family: '+91-xxxxx-1234' });
  assert.equal(view.person.name, 'Lakshmi Raman');
  assert.equal(view.person.respondsToName, 'Paati');
  assert.equal(view.flat, 'B-204');
  assert.match(view.handlingBanner[0], /Hard of hearing/);
  assert.equal(view.health.bloodGroup, 'B+');
  assert.equal(view.location.source, 'gps');
});

test('FR-BRF-2: access secrets are absent from the accepted view and present only for a guard', () => {
  const accepted = buildAcceptedView(lakshmi, incident);
  assert.equal('accessSecrets' in accepted, false, 'a volunteer never receives door codes');

  const guard = buildGuardView(lakshmi, incident, { gateCode: '4821', spareKeyHolder: 'B-205' });
  assert.equal(guard.viewKind, 'guard');
  assert.equal(guard.accessSecrets.gateCode, '4821');
  assert.equal(guard.accessSecrets.spareKeyHolder, 'B-205');
  assert.equal(guard.person.name, 'Lakshmi Raman');
});

test('the accepted view falls back to the registered address when no fix has arrived yet', () => {
  const view = buildAcceptedView(lakshmi, { ...incident, location: null });
  assert.equal(view.location.source, 'registry');
  assert.equal(view.location.lat, lakshmi.lat);
});

test('findForbiddenKeys walks nested objects and arrays, not just the top level', () => {
  assert.deepEqual(findForbiddenKeys({ a: { b: [{ name: 'x' }] } }), ['name']);
  assert.deepEqual(findForbiddenKeys({ ok: 1, nested: { fine: true } }), []);
  assert.deepEqual(findForbiddenKeys(null), []);
  assert.ok(FORBIDDEN_PRE_ACCEPT_KEYS.includes('health'));
  assert.ok(FORBIDDEN_PRE_ACCEPT_KEYS.includes('lat'), 'an exact position is identifying too');
});

test('DisclosureDeniedError carries the context an audit log needs', () => {
  const err = new DisclosureDeniedError({ type: 'volunteer', id: 'v9' }, 'inc-1', 'accepted');
  assert.equal(err.name, 'DisclosureDeniedError');
  assert.equal(err.viewer.id, 'v9');
  assert.equal(err.incidentId, 'inc-1');
  assert.match(err.message, /Accept the alert first/);
});
