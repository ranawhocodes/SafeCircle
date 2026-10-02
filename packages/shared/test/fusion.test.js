import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFrom, bestOf, fuse, describeAccuracy } from '../dist/fusion.js';

const at = new Date('2026-10-01T06:00:00Z');
const loc = (source, accuracyM, ageS = 0) => ({
  lat: 13.08, lng: 80.27, accuracyM, source,
  at: new Date(at.getTime() - ageS * 1000),
});

test('FR-INC-9: GPS beats a Wi-Fi estimate beats a cell tower beats the registry', () => {
  const best = bestOf([loc('registry', 25), loc('cell', 900), loc('wifi', 60), loc('gps', 8)]);
  assert.equal(best.source, 'gps');
  assert.equal(bestOf([loc('registry', 25), loc('cell', 900), loc('wifi', 60)]).source, 'wifi');
  assert.equal(bestOf([loc('registry', 25), loc('cell', 900)]).source, 'cell');
});

test('a known place beats a Wi-Fi estimate, because it names a building', () => {
  assert.equal(bestOf([loc('wifi', 60), loc('known_place', 50)]).source, 'known_place');
});

test('a stale GPS fix is dropped entirely rather than trusted', () => {
  const fresh = candidatesFrom({
    report: { gps: { lat: 13.08, lng: 80.27, acc_m: 8, age_s: 5 } }, at,
  });
  assert.equal(fresh.length, 1);
  const stale = candidatesFrom({
    report: { gps: { lat: 13.08, lng: 80.27, acc_m: 8, age_s: 600 } },
    resolved: { lat: 13.081, lng: 80.271, accuracyM: 60, from: 'wifi' }, at,
  });
  assert.deepEqual(stale.map((c) => c.source), ['wifi'], 'a 10-minute-old fix must not win');
});

test('a Go pendant report yields every source it supports, in one pass', () => {
  const cands = candidatesFrom({
    report: {
      gps: { lat: 13.0827, lng: 80.2707, acc_m: 8, age_s: 3 },
      wifi: [{ bssid: 'a4:2b', rssi: -61 }],
    },
    resolved: { lat: 13.0828, lng: 80.2709, accuracyM: 55, from: 'wifi' },
    knownPlace: { lat: 13.09, lng: 80.28, radiusM: 40, label: 'Hillside School' },
    registry: { lat: 13.07, lng: 80.26 },
    at,
  });
  assert.deepEqual(cands.map((c) => c.source).sort(), ['gps', 'known_place', 'registry', 'wifi']);
  assert.equal(bestOf(cands).source, 'gps');
});

test('FR-INC-9 never-degrade: a worse later fix does not replace a good fresh one', () => {
  const good = loc('gps', 8);
  const worse = loc('cell', 900);
  const kept = fuse(good, worse, at);
  assert.equal(kept.source, 'gps', 'the responder map must never get worse mid-incident');
});

test('a better later fix does replace the current one', () => {
  const kept = fuse(loc('wifi', 60), loc('gps', 8), at);
  assert.equal(kept.source, 'gps');
});

test('a tighter fix of the same source wins', () => {
  const kept = fuse(loc('gps', 40), loc('gps', 6), at);
  assert.equal(kept.accuracyM, 6);
});

test('once the held position goes stale, anything fresh replaces it', () => {
  const held = loc('gps', 8, 5000);
  const kept = fuse(held, loc('cell', 900), at);
  assert.equal(kept.source, 'cell', 'a very old GPS fix is worse than knowing the cell now');
});

test('fuse tolerates missing inputs on either side', () => {
  assert.equal(fuse(null, loc('gps', 8), at).source, 'gps');
  assert.equal(fuse(loc('gps', 8), null, at).source, 'gps');
  assert.equal(fuse(null, null, at), null);
});

test('FR-INC-10: every position describes its source and accuracy honestly', () => {
  assert.equal(describeAccuracy(loc('gps', 8)), 'GPS, about 8 m');
  assert.equal(describeAccuracy(loc('wifi', 60)), 'Wi-Fi estimate, about 60 m');
  assert.match(describeAccuracy({ ...loc('known_place', 40), label: 'Hillside School' }), /Hillside School/);
});

test('a report with no usable location yields no candidates rather than a guess at 0,0', () => {
  assert.deepEqual(candidatesFrom({ report: { wifi: [] }, at }), []);
  assert.equal(bestOf([]), null);
});
