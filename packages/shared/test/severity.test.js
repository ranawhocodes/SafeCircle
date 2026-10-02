import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSeverity, escalatesImmediately, autoEscalatesOnTimeout } from '../dist/severity.js';
import { lakshmi, arjun, meera, panic } from './helpers.js';

test('FR-INC-3: a plain press from a registered person is P2', () => {
  const r = scoreSeverity({ event: panic(), person: lakshmi });
  assert.equal(r.severity, 'P2');
  assert.ok(r.reasons.length > 0, 'must explain itself');
});

test('FR-TRG-6: an unknown sender is unverified and never reaches volunteers', () => {
  const r = scoreSeverity({ event: panic({ source: 'whatsapp', sender: '+919999999999' }), person: null });
  assert.equal(r.severity, 'unverified');
  assert.equal(r.flags.unverified, true);
  assert.match(r.reasons.join(' '), /guard desk/i);
});

test('FR-CAN-3: an unverifiable cancel is P1 and flagged as possible duress', () => {
  const r = scoreSeverity({ event: panic(), person: lakshmi, possibleDuress: true });
  assert.equal(r.severity, 'P1');
  assert.equal(r.flags.possibleDuress, true);
});

test('a caregiver reporting unconsciousness is P1 collapse', () => {
  const r = scoreSeverity({
    event: panic({ source: 'whatsapp' }),
    person: lakshmi,
    caregiverReport: 'She is unconscious on the bathroom floor',
  });
  assert.equal(r.severity, 'P1');
  assert.equal(r.caseType, 'collapse');
});

test('cardiac history plus no answer to the check-in call is P1', () => {
  const cardiac = { ...lakshmi, health: { conditions: ['Cardiac arrhythmia'] } };
  const r = scoreSeverity({ event: panic(), person: cardiac, checkInAnswer: 'no_answer' });
  assert.equal(r.severity, 'P1');
});

test('the same cardiac history with no check-in call stays P2', () => {
  const cardiac = { ...lakshmi, health: { conditions: ['Cardiac arrhythmia'] } };
  const r = scoreSeverity({ event: panic(), person: cardiac });
  assert.equal(r.severity, 'P2', 'absence of a call answer must not be read as a non-answer');
});

test('check-in "3 danger" is P1 harassment', () => {
  const r = scoreSeverity({ event: panic(), person: lakshmi, checkInAnswer: 'danger' });
  assert.equal(r.severity, 'P1');
  assert.equal(r.caseType, 'harassment');
});

test('a stealth press is P1 so 112 is told at once, and carries the stealth flag', () => {
  const r = scoreSeverity({ event: panic(), person: meera });
  assert.equal(r.severity, 'P1');
  assert.equal(r.caseType, 'harassment');
  assert.equal(r.flags.stealth, true);
});

test('a child pendant moving at vehicle speed is P1 with possible abduction', () => {
  const r = scoreSeverity({ event: panic(), person: arjun, speedMps: 14 });
  assert.equal(r.severity, 'P1');
  assert.equal(r.flags.possibleAbduction, true);
});

test('a child pendant moving at walking speed is not an abduction', () => {
  const r = scoreSeverity({ event: panic(), person: arjun, speedMps: 1.3 });
  assert.notEqual(r.flags.possibleAbduction, true);
});

test('an adult moving at vehicle speed is not an abduction', () => {
  const r = scoreSeverity({ event: panic(), person: lakshmi, speedMps: 20 });
  assert.notEqual(r.flags.possibleAbduction, true);
});

test('check-in "4 pressed by mistake" drops to P3', () => {
  const r = scoreSeverity({ event: panic(), person: lakshmi, checkInAnswer: 'mistake' });
  assert.equal(r.severity, 'P3');
});

test('a drill is flagged as a drill whatever the severity', () => {
  const r = scoreSeverity({ event: panic({ isDrill: true }), person: lakshmi });
  assert.equal(r.flags.drill, true);
});

test('a caregiver-raised alarm is flagged so responders do not go to the caregiver', () => {
  const r = scoreSeverity({ event: panic({ source: 'caregiver_link', onBehalfOfPersonId: 'p-arjun' }), person: arjun });
  assert.equal(r.flags.raisedByCaregiver, true);
});

test('only P1 escalates immediately; only P2 escalates on timeout; P3 never does', () => {
  assert.equal(escalatesImmediately('P1'), true);
  assert.equal(escalatesImmediately('P2'), false);
  assert.equal(autoEscalatesOnTimeout('P2'), true);
  assert.equal(autoEscalatesOnTimeout('P1'), false, 'P1 already told 112 at dispatch');
  assert.equal(autoEscalatesOnTimeout('P3'), false);
});
