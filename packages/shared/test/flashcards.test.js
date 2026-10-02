import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFlashcardSet, rankCards, isServable, handlingBanner,
  observedTypeWording, CPR_CARD_KEY,
} from '../dist/flashcards.js';
import { lakshmi, arjun, CARDS, card } from './helpers.js';

/** The worked example from master document section 14.2. */
test('FR-BRF-5: Lakshmi at 6am ranks Fall, Low blood sugar, Stroke', () => {
  const set = buildFlashcardSet(CARDS, {
    person: lakshmi,
    caseType: 'fall',
    history: ['fall_older_person', 'fall_older_person'],
    localHour: 6,
  });
  assert.deepEqual(set.likely.map((c) => c.key), ['fall_older_person', 'low_blood_sugar', 'stroke_be_fast']);
});

test('the banner leads with how to speak to her, taken from the profile', () => {
  const set = buildFlashcardSet(CARDS, { person: lakshmi, caseType: 'fall', history: [] });
  assert.match(set.handlingBanner[0], /Hard of hearing/);
  assert.match(set.safetyLine, /danger before you go in/i);
});

test('FR-BRF-5: the CPR card is always present, whatever the ranking says', () => {
  for (const caseType of ['fall', 'child', 'harassment', 'unknown']) {
    const set = buildFlashcardSet(CARDS, { person: lakshmi, caseType, history: [] });
    assert.equal(set.alwaysVisible.key, CPR_CARD_KEY, caseType);
    assert.ok(!set.likely.some((c) => c.key === CPR_CARD_KEY), 'and is not duplicated in the chips');
  }
});

test('exactly three chips are offered, even when many cards score', () => {
  const set = buildFlashcardSet(CARDS, {
    person: { ...lakshmi, health: { conditions: ['diabetes', 'epilepsy', 'heart disease', 'asthma'] } },
    caseType: 'medical',
    history: ['stroke_be_fast', 'chest_pain', 'seizure'],
  });
  assert.equal(set.likely.length, 3);
});

test("a child's profile ranks the situations a child is actually found in", () => {
  const set = buildFlashcardSet(CARDS, { person: arjun, caseType: 'child', history: [] });
  const keys = set.likely.map((c) => c.key);
  assert.ok(keys.includes('lost_child'), keys.join(','));
  assert.ok(!keys.includes('fall_older_person'), 'not an older-person card');
});

test('a wandering history surfaces the dementia card for a cognitive profile', () => {
  const set = buildFlashcardSet(CARDS, { person: arjun, caseType: 'cognitive', history: [] });
  assert.ok(set.likely.some((c) => c.key === 'wandering_person'));
});

test('trigger context outweighs the profile: "not breathing" promotes CPR above everything', () => {
  const ranked = rankCards(CARDS, {
    person: lakshmi, caseType: 'fall', history: ['fall_older_person'],
    contextText: 'caregiver says she is not breathing',
  });
  assert.equal(ranked[0].key, CPR_CARD_KEY);
});

test('history is weighted by recency AND by frequency', () => {
  // Recency: a single most-recent event outranks a single older one.
  const recency = rankCards(CARDS, {
    person: { ...lakshmi, health: {} }, caseType: 'unknown',
    history: ['seizure', 'choking'],
  });
  assert.ok(
    recency.find((c) => c.key === 'seizure').score > recency.find((c) => c.key === 'choking').score,
    'the more recent incident should weigh more',
  );

  // Frequency: repeats accumulate. The master document's own signal is
  // "4 of her last 6 incidents were falls", so a repeated pattern must be able
  // to outweigh a single newer one-off.
  const frequency = rankCards(CARDS, {
    person: { ...lakshmi, health: {} }, caseType: 'unknown',
    history: ['seizure', 'choking', 'choking', 'choking'],
  });
  assert.ok(
    frequency.find((c) => c.key === 'choking').score > frequency.find((c) => c.key === 'seizure').score,
    'a repeated pattern should outweigh a single newer one-off',
  );
});

test('every suggestion explains itself', () => {
  const set = buildFlashcardSet(CARDS, { person: lakshmi, caseType: 'fall', history: ['fall_older_person'], localHour: 6 });
  for (const c of set.likely) assert.ok(c.because.length > 0, `${c.key} has no reason`);
});

test('FR-BRF-7: a card with no dated doctor review is never served', () => {
  const unreviewed = card('low_blood_sugar', 'Low blood sugar', { reviewedBy: null, reviewedAt: null });
  assert.equal(isServable(unreviewed), false);
  const pool = CARDS.filter((c) => c.key !== 'low_blood_sugar').concat(unreviewed);
  const set = buildFlashcardSet(pool, { person: lakshmi, caseType: 'fall', history: [], localHour: 6 });
  assert.ok(!set.likely.some((c) => c.key === 'low_blood_sugar'), 'an unreviewed card must not reach a responder');
});

test('an unreviewed CPR card falls back to a safe label rather than serving unchecked content', () => {
  const pool = CARDS.filter((c) => c.key !== CPR_CARD_KEY)
    .concat(card(CPR_CARD_KEY, 'Hands-only CPR', { reviewedBy: null, reviewedAt: null }));
  const set = buildFlashcardSet(pool, { person: lakshmi, caseType: 'fall', history: [] });
  assert.equal(set.alwaysVisible.key, CPR_CARD_KEY);
  assert.match(set.alwaysVisible.title, /Start CPR/);
});

test('a card that scores nothing is left out rather than padded in', () => {
  const ranked = rankCards(CARDS, { person: { ageBand: '18-59', health: {}, handling: {} }, caseType: 'unknown', history: [] });
  for (const c of ranked) assert.ok(c.score > 0, `${c.key} scored ${c.score}`);
});

test('handlingBanner collects every handling need and tolerates an empty profile', () => {
  assert.deepEqual(handlingBanner(undefined), []);
  const lines = handlingBanner({ hearing: 'Face her', avoid: ['Do not touch'], calmingSteps: ['Count slowly'] });
  assert.deepEqual(lines, ['Face her', 'Do not touch', 'Count slowly']);
});

test('FR-BRF-6: the observed type is worded as a report, never a diagnosis', () => {
  assert.equal(observedTypeWording('Low blood sugar'), 'Volunteer reports possible low blood sugar');
});
