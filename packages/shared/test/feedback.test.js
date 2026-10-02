import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patternFor, allPatternsFor, allowsCallToPerson, isRegression, isQuietStage,
} from '../dist/feedback.js';

const ALL_PROFILES = [
  'standard', 'loud', 'calm', 'child', 'visual_first', 'touch_and_sound', 'discreet', 'stealth',
];

const STAGES = ['sending', 'received', 'accepted', 'arriving', 'arrived', 'escalated'];

test('FR-FDB-1: every live stage reaches all three senses on the standard profile', () => {
  for (const stage of STAGES) {
    const p = patternFor(stage, 'standard');
    assert.notEqual(p.light.colour, 'none', `${stage} light`);
    assert.notEqual(p.sound.tone, 'none', `${stage} sound`);
    assert.notEqual(p.vibration.pulses, 0, `${stage} vibration`);
    assert.ok(p.meaning.length > 0, `${stage} needs a plain-language meaning`);
  }
});

test('every stage has a distinct colour-and-motion combination, so colour-blind users can still tell them apart by motion', () => {
  const seen = new Set();
  for (const stage of STAGES) {
    const p = patternFor(stage, 'standard');
    const key = `${p.light.colour}:${p.light.motion}`;
    assert.ok(!seen.has(key), `${stage} duplicates ${key}`);
    seen.add(key);
  }
});

test('FR-FDB-4 stealth: light only. No buzzer, no vibration, no call to her phone', () => {
  for (const stage of STAGES) {
    const p = patternFor(stage, 'stealth');
    assert.equal(p.sound.tone, 'none', `${stage} must be silent`);
    assert.equal(p.sound.volume, 0, `${stage} volume`);
    assert.equal(p.vibration.pulses, 0, `${stage} must not vibrate`);
    assert.notEqual(p.light.colour, 'none', `${stage} still needs its light`);
    assert.equal(p.light.brightness, 1, `${stage} must stay dim`);
  }
  assert.equal(allowsCallToPerson('stealth'), false);
});

test('FR-FDB-4 discreet: vibration only, so nothing can be seen or heard', () => {
  for (const stage of STAGES) {
    const p = patternFor(stage, 'discreet');
    assert.equal(p.light.colour, 'none', `${stage} must show no light`);
    assert.equal(p.sound.tone, 'none', `${stage} must be silent`);
    assert.ok(p.vibration.pulses >= 1, `${stage} must still vibrate`);
  }
  assert.equal(allowsCallToPerson('discreet'), false);
});

test('calm never beeps and never blinks fast, for autism, dementia and anxiety', () => {
  for (const p of allPatternsFor('calm')) {
    assert.ok(!['short_beep', 'triple_beep', 'rising_ticks'].includes(p.sound.tone), p.stage);
    assert.ok(!['fast_blink', 'fast_pulse'].includes(p.light.motion), p.stage);
    assert.ok(p.sound.volume <= 1, p.stage);
  }
});

test('loud maximises volume and vibration for seniors with hearing loss', () => {
  const p = patternFor('accepted', 'loud');
  assert.equal(p.sound.volume, 3);
  assert.ok(p.vibration.pulses >= 2);
});

test('visual_first brightens the light and strengthens vibration for deaf users', () => {
  const p = patternFor('accepted', 'visual_first');
  assert.equal(p.light.brightness, 5);
  assert.ok(p.vibration.pulses >= 2);
  assert.ok(p.sound.volume <= 1);
});

test('touch_and_sound gives a blind user a distinct count and tone at every stage', () => {
  for (const stage of STAGES) {
    const p = patternFor(stage, 'touch_and_sound');
    assert.ok(p.vibration.pulses >= 1, stage);
    assert.equal(p.sound.volume, 3, stage);
  }
});

test('child never shows red and never uses the harsh triple beep', () => {
  for (const p of allPatternsFor('child')) {
    assert.notEqual(p.light.colour, 'red', p.stage);
    assert.notEqual(p.sound.tone, 'triple_beep', p.stage);
  }
});

test('the cancel-verifying pattern stays deliberately quiet, so an attacker is not tipped off', () => {
  const p = patternFor('cancel_verifying', 'standard');
  assert.equal(p.sound.tone, 'none');
  assert.equal(p.vibration.pulses, 0);
});

test('NO profile can add sound or vibration to cancel_verifying - an amplifying profile must not tip off an attacker', () => {
  // The regression this guards: `loud` forces vibration to at least 2 pulses,
  // which would buzz in the hand of someone who was just made to cancel.
  for (const profile of ALL_PROFILES) {
    const p = patternFor('cancel_verifying', profile);
    assert.equal(p.sound.tone, 'none', `${profile} added sound`);
    assert.equal(p.sound.volume, 0, `${profile} added volume`);
    assert.equal(p.vibration.pulses, 0, `${profile} added vibration`);
    assert.equal(p.vibration.length, 'none', `${profile} added a vibration length`);
  }
});

test('the quiet stages stay silent under every profile', () => {
  for (const stage of ['idle', 'cancel_verifying', 'low_battery']) {
    assert.equal(isQuietStage(stage), true, `${stage} should be a quiet stage`);
    for (const profile of ALL_PROFILES) {
      const p = patternFor(stage, profile);
      assert.equal(p.sound.tone, 'none', `${stage}/${profile} added sound`);
      assert.equal(p.vibration.pulses, 0, `${stage}/${profile} added vibration`);
    }
  }
  assert.equal(isQuietStage('accepted'), false, 'a live stage must still reach the senses');
});

test('a quiet stage may still change its LIGHT, so a deaf or stealth user is served', () => {
  // Quiet means silent, not invisible: stealth still needs its dim light.
  assert.equal(patternFor('cancel_verifying', 'stealth').light.brightness, 1);
  assert.notEqual(patternFor('cancel_verifying', 'standard').light.colour, 'none');
  // Discreet removes light by design, leaving nothing at all on this stage.
  assert.equal(patternFor('cancel_verifying', 'discreet').light.colour, 'none');
});

test('FR-FDB-5: a send failure is unmistakable on the standard profile', () => {
  const p = patternFor('failed', 'standard');
  assert.equal(p.light.colour, 'red');
  assert.equal(p.sound.tone, 'triple_beep');
  assert.equal(p.vibration.pulses, 3);
});

test('FR-FDB-3: a late or duplicate update never moves the device backwards', () => {
  assert.equal(isRegression('accepted', 'sending'), true);
  assert.equal(isRegression('accepted', 'arrived'), false);
  assert.equal(isRegression('arrived', 'arrived'), false);
  assert.equal(isRegression('accepted', 'failed'), false, 'transient overlays may appear any time');
  assert.equal(isRegression('accepted', 'low_battery'), false);
});
