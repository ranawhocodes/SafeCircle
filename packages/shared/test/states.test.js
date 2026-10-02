import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition, nextState, isOpen, isStale, IllegalTransitionError,
  canResolveFromVerifying, briefingStaysOpen, acceptsNewResponders,
} from '../dist/states.js';

test('FR-INC-4: the happy path walks new -> dispatching -> accepted -> en_route -> on_scene -> resolved', () => {
  let s = 'new';
  s = nextState(s, 'alerts_sent');       assert.equal(s, 'dispatching');
  s = nextState(s, 'responder_accepted'); assert.equal(s, 'accepted');
  s = nextState(s, 'responder_on_my_way'); assert.equal(s, 'en_route');
  s = nextState(s, 'responder_arrived'); assert.equal(s, 'on_scene');
  s = nextState(s, 'closed_by_responder'); assert.equal(s, 'resolved');
});

test('illegal transitions are refused, not silently ignored', () => {
  assert.equal(canTransition('new', 'responder_arrived'), false);
  assert.throws(() => nextState('new', 'responder_arrived'), IllegalTransitionError);
  assert.throws(() => nextState('resolved', 'responder_accepted'), IllegalTransitionError);
});

test('FR-CAN-2/4: only verified safety resolves a cancel; failure returns to dispatching', () => {
  assert.equal(nextState('cancel_verifying', 'verified_safe'), 'resolved');
  assert.equal(nextState('cancel_verifying', 'verification_failed'), 'dispatching');
});

test('a cancel cannot be resolved without a verification record on file', () => {
  assert.equal(canResolveFromVerifying(false), false);
  assert.equal(canResolveFromVerifying(true), true);
});

test('a cancel can be requested from any live state', () => {
  for (const s of ['new', 'dispatching', 'accepted', 'en_route']) {
    assert.equal(nextState(s, 'cancel_requested'), 'cancel_verifying', s);
  }
});

test('FR-INC-5: no trigger auto-closes an incident; a stale one is only flagged', () => {
  const lastEvent = new Date('2026-10-01T06:00:00Z');
  const later = new Date('2026-10-01T07:00:00Z');
  assert.equal(isStale('dispatching', lastEvent, later), true, 'flag it for a human');
  assert.equal(isOpen('dispatching'), true, 'but it is still open');
  assert.equal(isStale('resolved', lastEvent, later), false);
  assert.equal(isStale('dispatching', lastEvent, new Date('2026-10-01T06:10:00Z')), false);
});

test('all responders withdrawing re-opens the incident rather than closing it', () => {
  assert.equal(nextState('accepted', 'all_responders_withdrew'), 'dispatching');
  assert.equal(nextState('on_scene', 'all_responders_withdrew'), 'dispatching');
});

test('FR-CAN-5: while verifying, accepted responders keep their briefing but no new ones are added', () => {
  assert.equal(briefingStaysOpen('cancel_verifying'), true);
  assert.equal(acceptsNewResponders('cancel_verifying'), false);
  assert.equal(acceptsNewResponders('dispatching'), true);
});
