import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleForNewIncident, scheduleOnAccept, scheduleOnCancelRequest,
  scaleSeconds, isDemoSpeed,
} from '../dist/timers.js';

const openedAt = new Date('2026-10-01T06:00:00Z');
const secondsAfter = (t) => (t.fireAt.getTime() - openedAt.getTime()) / 1000;

test('FR-INC-6: a P2 arms the 30s upgrade, the 60s family call and the 90s escalation', () => {
  const timers = scheduleForNewIncident({ severity: 'P2', openedAt });
  const byKind = Object.fromEntries(timers.map((t) => [t.kind, secondsAfter(t)]));
  assert.deepEqual(byKind, { upgradeAll: 30, familyVoiceCall: 60, escalate112: 90 });
});

test('FR-INC-8: a P1 has already told 112, so it arms no escalation timer', () => {
  const kinds = scheduleForNewIncident({ severity: 'P1', openedAt }).map((t) => t.kind);
  assert.ok(kinds.includes('upgradeAll'));
  assert.ok(!kinds.includes('escalate112'));
});

test('a P3 never escalates to 112 automatically', () => {
  const kinds = scheduleForNewIncident({ severity: 'P3', openedAt }).map((t) => t.kind);
  assert.ok(!kinds.includes('escalate112'));
});

test('FR-SET-8: a drill arms no timers at all, because it alerts nobody', () => {
  assert.deepEqual(scheduleForNewIncident({ severity: 'P2', openedAt, isDrill: true }), []);
});

test('an unverified incident gets a human nudge but no volunteer upgrade', () => {
  const kinds = scheduleForNewIncident({ severity: 'unverified', openedAt }).map((t) => t.kind);
  assert.deepEqual(kinds, ['familyVoiceCall']);
});

test('FR-INC-7: demo scale 0.333 compresses the 30s upgrade to 10s', () => {
  const timers = scheduleForNewIncident({ severity: 'P2', openedAt, timeScale: 0.333 });
  const upgrade = timers.find((t) => t.kind === 'upgradeAll');
  assert.equal(secondsAfter(upgrade), 10);
  const escalate = timers.find((t) => t.kind === 'escalate112');
  assert.equal(secondsAfter(escalate), 30);
});

test('a scaled timer never rounds down to zero', () => {
  assert.equal(scaleSeconds(1, 0.01), 1);
});

test('an invalid or zero time scale falls back to real time rather than firing instantly', () => {
  assert.equal(scaleSeconds(30, 0), 30);
  assert.equal(scaleSeconds(30, -5), 30);
});

test('demo speed is reported so every surface can label it honestly', () => {
  assert.equal(isDemoSpeed(1), false);
  assert.equal(isDemoSpeed(0.333), true);
});

test('accepting arms the "still coming?" check at 3 minutes', () => {
  const t = scheduleOnAccept(openedAt);
  assert.equal(t[0].kind, 'stillComing');
  assert.equal(secondsAfter(t[0]), 180);
});

test('FR-CAN-1/4: a cancel arms one retry and a hard deadline so help can never hang', () => {
  const kinds = scheduleOnCancelRequest(openedAt).map((t) => t.kind);
  assert.deepEqual(kinds, ['verificationRetry', 'verificationDeadline']);
});
