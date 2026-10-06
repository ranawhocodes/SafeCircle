import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankCandidate, planTiers, nextRadius, promoteAfterDecline,
  safetyNoticeFor, teamCapFor, isVerified, ineligibleReason, inQuietHours,
} from '../dist/ranking.js';
import { haversineM, distanceBand, etaSeconds, coarseCell } from '../dist/geo.js';
import { lakshmi, arjun, volunteer, eastOf } from './helpers.js';

const person = { lat: 13.0827, lng: 80.2707, languages: ['ta', 'en'], protected: false, responderPreference: null };
const ctx = { caseType: 'medical', localHour: 10, onDuty: false };

test('FR-ALT-5: a nurse 350 m away outranks a student 300 m away on a medical case', () => {
  const nurse = volunteer({ id: 'nurse', skills: ['nurse'], ...eastOf(person.lat, person.lng, 350) });
  const student = volunteer({ id: 'student', skills: ['none'], ...eastOf(person.lat, person.lng, 300) });
  const a = rankCandidate(nurse, person, 'medical');
  const b = rankCandidate(student, person, 'medical');
  assert.ok(a.score < b.score, `nurse ${a.score} should beat student ${b.score}`);
  assert.match(a.because.join(' '), /skill bonus/);
});

test('the same skill bonus does not apply to a harassment case', () => {
  const nurse = volunteer({ skills: ['nurse'], ...eastOf(person.lat, person.lng, 350) });
  assert.equal(rankCandidate(nurse, person, 'harassment').inputs.skillBonusS, 0);
});

test('a woman-responder preference flips an otherwise tied pair', () => {
  const wanted = { ...person, responderPreference: 'woman_first' };
  const pos = eastOf(person.lat, person.lng, 400);
  const woman = volunteer({ id: 'w', isWoman: true, ...pos });
  const man = volunteer({ id: 'm', isWoman: false, ...pos });
  assert.ok(rankCandidate(woman, wanted, 'medical').score < rankCandidate(man, wanted, 'medical').score);
  assert.equal(rankCandidate(man, person, 'medical').inputs.preferencePenaltyS, 0, 'no penalty without the preference');
});

test('no shared language is a penalty, not an exclusion', () => {
  const pos = eastOf(person.lat, person.lng, 400);
  const sameLang = volunteer({ id: 'a', languages: ['ta'], ...pos });
  const noLang = volunteer({ id: 'b', languages: ['bn'], ...pos });
  assert.ok(rankCandidate(sameLang, person, 'medical').score < rankCandidate(noLang, person, 'medical').score);
  assert.ok(rankCandidate(noLang, person, 'medical').score > 0, 'still rankable');
});

test('a more reliable volunteer wins a tie', () => {
  const pos = eastOf(person.lat, person.lng, 400);
  const good = volunteer({ id: 'g', reliabilityScore: 1, ...pos });
  const poor = volunteer({ id: 'p', reliabilityScore: 0, ...pos });
  assert.ok(rankCandidate(good, person, 'medical').score < rankCandidate(poor, person, 'medical').score);
});

test('FR-ALT-5: every ranking records the inputs that produced it', () => {
  const r = rankCandidate(volunteer({ skills: ['doctor'] }), person, 'medical');
  for (const k of ['distanceM', 'etaS', 'skillBonusS', 'reliabilityBonusS', 'preferencePenaltyS', 'languagePenaltyS', 'locationAgeS']) {
    assert.ok(k in r.inputs, `missing ${k}`);
  }
  assert.ok(r.because.length > 0, 'and an explanation a human can read');
});

test('FR-ALT-1: Tier 1 is exactly the 3 nearest VERIFIED volunteers', () => {
  const candidates = [
    volunteer({ id: 'u1', trustLevel: 0, ...eastOf(person.lat, person.lng, 50) }),
    volunteer({ id: 'u2', trustLevel: 1, ...eastOf(person.lat, person.lng, 60) }),
    volunteer({ id: 'v1', trustLevel: 2, ...eastOf(person.lat, person.lng, 200) }),
    volunteer({ id: 'v2', trustLevel: 2, ...eastOf(person.lat, person.lng, 300) }),
    volunteer({ id: 'v3', trustLevel: 3, ...eastOf(person.lat, person.lng, 400) }),
    volunteer({ id: 'v4', trustLevel: 2, ...eastOf(person.lat, person.lng, 500) }),
  ];
  const plan = planTiers(candidates, person, ctx, 1500);
  assert.deepEqual(plan.tier1.map((r) => r.volunteer.id), ['v1', 'v2', 'v3']);
  assert.deepEqual(plan.tier2.map((r) => r.volunteer.id).sort(), ['u1', 'u2', 'v4']);
  assert.equal(plan.sparse, false);
});

test('F16 two-priority: unverified volunteers backfill Tier 1 when verified are sparse within close proximity', () => {
  const candidates = [
    volunteer({ id: 'u1', trustLevel: 0, ...eastOf(person.lat, person.lng, 50) }),
    volunteer({ id: 'v1', trustLevel: 2, ...eastOf(person.lat, person.lng, 200) }),
    volunteer({ id: 'v2', trustLevel: 2, ...eastOf(person.lat, person.lng, 900) }),
  ];
  const plan = planTiers(candidates, person, ctx, 1500);
  // v1 (verified within 500m) fills slot 1; u1 (unverified within 500m) fills slot 2 (backfill).
  // v2 (at 900m) is beyond closeProximityM (500m), so it is placed in Tier 2.
  assert.deepEqual(plan.tier1.map((r) => r.volunteer.id), ['v1', 'u1']);
  assert.deepEqual(plan.tier2.map((r) => r.volunteer.id), ['v2']);
  assert.equal(plan.tier1.length + plan.tier2.length, 3, 'nobody nearby is left out');
});

test('FR-ALT-6: fewer than 3 verified volunteers marks the plan sparse so the radius widens', () => {
  const plan = planTiers([volunteer({ trustLevel: 2 })], person, ctx, 1500);
  assert.equal(plan.sparse, true);
  assert.equal(nextRadius(1500), 3000);
  assert.equal(nextRadius(3000), 5000);
  assert.equal(nextRadius(5000), null, 'the largest step is the last');
});

test('FR-ALT-7: a protected profile with no verified volunteer nearby is flagged at risk', () => {
  const protectedPerson = { ...person, protected: true };
  const unverifiedOnly = [volunteer({ id: 'u1', trustLevel: 1 })];
  assert.equal(planTiers(unverifiedOnly, protectedPerson, { ...ctx, caseType: 'child' }, 1500).protectedProfileAtRisk, true);
  const withVerified = [...unverifiedOnly, volunteer({ id: 'v1', trustLevel: 2 })];
  assert.equal(planTiers(withVerified, protectedPerson, { ...ctx, caseType: 'child' }, 1500).protectedProfileAtRisk, false);
});

test('exclusions are explained rather than silently dropped, so thin coverage is visible', () => {
  const candidates = [
    volunteer({ id: 'optout', optedOutCaseTypes: ['medical'] }),
    volunteer({ id: 'tooFar', maxDistanceM: 100, ...eastOf(person.lat, person.lng, 900) }),
    volunteer({ id: 'capped', alertsToday: 9 }),
    volunteer({ id: 'outside', ...eastOf(person.lat, person.lng, 9000) }),
  ];
  const plan = planTiers(candidates, person, ctx, 1500);
  assert.equal(plan.tier1.length + plan.tier2.length, 0);
  assert.equal(plan.excluded.length, 4);
  for (const e of plan.excluded) assert.ok(e.reason.length > 0, `${e.volunteer.id} needs a reason`);
});

test('quiet hours are opt-in: a volunteer who set none is alertable at 3am', () => {
  // Section 16.5 #22 is "3 am, nobody available" - the system must still try.
  const noQuietHours = volunteer();
  assert.equal(ineligibleReason(noQuietHours, 200, { caseType: 'medical', localHour: 3, onDuty: false }), null);
});

test('a volunteer who set quiet hours is excluded inside them unless on duty', () => {
  const v = volunteer({ quietHoursStart: 22, quietHoursEnd: 6 });
  assert.match(ineligibleReason(v, 200, { caseType: 'medical', localHour: 3, onDuty: false }), /quiet hours/i);
  assert.match(ineligibleReason(v, 200, { caseType: 'medical', localHour: 23, onDuty: false }), /quiet hours/i);
  assert.equal(ineligibleReason(v, 200, { caseType: 'medical', localHour: 12, onDuty: false }), null);
  assert.equal(ineligibleReason(v, 200, { caseType: 'medical', localHour: 3, onDuty: true }), null,
    'on duty overrides quiet hours');
});

test('a quiet-hours window that does not wrap midnight works too', () => {
  const v = volunteer({ quietHoursStart: 13, quietHoursEnd: 15 });
  assert.equal(inQuietHours(v, 12), false);
  assert.equal(inQuietHours(v, 13), true);
  assert.equal(inQuietHours(v, 14), true);
  assert.equal(inQuietHours(v, 15), false, 'the end hour is exclusive');
  assert.equal(inQuietHours(v, 23), false);
});

test('inQuietHours is false when no window is set, and for a zero-length window', () => {
  assert.equal(inQuietHours({ quietHoursStart: null, quietHoursEnd: null }, 3), false);
  assert.equal(inQuietHours({}, 3), false);
  assert.equal(inQuietHours({ quietHoursStart: 9, quietHoursEnd: 9 }, 9), false);
});

test('FR-ALT-3: a Tier 1 decline promotes the next nearest verified volunteer immediately', () => {
  const candidates = [
    volunteer({ id: 'v1', trustLevel: 2, ...eastOf(person.lat, person.lng, 100) }),
    volunteer({ id: 'v2', trustLevel: 2, ...eastOf(person.lat, person.lng, 200) }),
    volunteer({ id: 'v3', trustLevel: 2, ...eastOf(person.lat, person.lng, 300) }),
    volunteer({ id: 'v4', trustLevel: 2, ...eastOf(person.lat, person.lng, 400) }),
    volunteer({ id: 'u5', trustLevel: 0, ...eastOf(person.lat, person.lng, 150) }),
  ];
  const plan = planTiers(candidates, person, ctx, 1500);
  const { promoted, tier1 } = promoteAfterDecline(plan, 'v2');
  assert.equal(promoted.volunteer.id, 'v4', 'the next VERIFIED volunteer, not the closer unverified one');
  assert.deepEqual(tier1.map((r) => r.volunteer.id), ['v1', 'v3', 'v4']);
});

test('F17: when no verified volunteer remains in Tier 2, an unverified one is promoted', () => {
  // Only 3 verified and 1 unverified — all verified start in Tier 1.
  const candidates = [
    volunteer({ id: 'v1', trustLevel: 2, ...eastOf(person.lat, person.lng, 100) }),
    volunteer({ id: 'v2', trustLevel: 2, ...eastOf(person.lat, person.lng, 200) }),
    volunteer({ id: 'v3', trustLevel: 2, ...eastOf(person.lat, person.lng, 300) }),
    volunteer({ id: 'u1', trustLevel: 1, ...eastOf(person.lat, person.lng, 150) }),
  ];
  const plan = planTiers(candidates, person, ctx, 1500);
  // v1, v2, v3 fill Tier 1 (verified); u1 is in Tier 2.
  assert.deepEqual(plan.tier1.map((r) => r.volunteer.id), ['v1', 'v2', 'v3']);
  const { promoted, tier1 } = promoteAfterDecline(plan, 'v2');
  // No verified left in Tier 2, so the unverified u1 is promoted.
  assert.equal(promoted.volunteer.id, 'u1', 'falls back to an unverified volunteer');
  assert.deepEqual(tier1.map((r) => r.volunteer.id), ['v1', 'v3', 'u1']);
});

test('FR-VOL-4: a harassment case warns against confronting; stealth adds arriving quietly', () => {
  assert.match(safetyNoticeFor('harassment', false), /Do not confront/);
  assert.match(safetyNoticeFor('harassment', true), /quietly/);
  assert.match(safetyNoticeFor('fall', true), /quietly/);
  assert.equal(safetyNoticeFor('fall', false), null);
});

test('team caps follow the case type, and a P1 allows one extra pair of hands', () => {
  assert.equal(teamCapFor('collapse', 'P2'), 3);
  assert.equal(teamCapFor('collapse', 'P1'), 4);
  assert.equal(teamCapFor('child', 'P2'), 1, 'never crowd a frightened child');
  assert.equal(teamCapFor('fall', 'P2'), 2);
});

test('L2 and above counts as verified; L0 and L1 do not', () => {
  assert.equal(isVerified(volunteer({ trustLevel: 1 })), false);
  assert.equal(isVerified(volunteer({ trustLevel: 2 })), true);
  assert.equal(isVerified(volunteer({ trustLevel: 4 })), true);
});

test('geo: haversine, bands, ETA and coarse cells behave', () => {
  const d = haversineM(13.0827, 80.2707, ...Object.values(eastOf(13.0827, 80.2707, 1000)));
  assert.ok(Math.abs(d - 1000) < 5, `expected ~1000 m, got ${d}`);
  assert.equal(haversineM(13, 80, 13, 80), 0);
  assert.equal(distanceBand(42), 100, 'never reveal a sub-100 m distance pre-accept');
  assert.equal(distanceBand(340), 300);
  assert.equal(distanceBand(2300), 2500);
  assert.ok(etaSeconds(900, 'two_wheeler') === etaSeconds(900, 'walk'), 'short hops are walked');
  assert.ok(etaSeconds(3000, 'two_wheeler') < etaSeconds(3000, 'walk'));
  const cell = coarseCell(13.0827, 80.2707);
  assert.ok(Math.abs(cell.cellLat - 13.0827) < 0.009, 'a ~1 km cell, not a precise point');
});
