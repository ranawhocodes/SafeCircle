import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIAL_MODULES, QUIZ_QUESTIONS, gradeQuiz } from '../dist/tutorial.js';

test('F28: tutorial modules M1 through M6 are defined with required takeaways', () => {
  assert.equal(TUTORIAL_MODULES.length, 6);
  assert.equal(TUTORIAL_MODULES[0].id, 'm1_safety');
  assert.equal(TUTORIAL_MODULES[4].id, 'm5_quiz');
  assert.equal(TUTORIAL_MODULES[5].id, 'm6_drill');

  for (const m of TUTORIAL_MODULES) {
    assert.ok(m.title.length > 0);
    assert.ok(m.takeaways.length >= 3);
  }
});

test('F28: quiz requires at least 80% (4 out of 5) to pass', () => {
  // Perfect score
  const perfect = gradeQuiz({
    q1: 1,
    q2: 2,
    q3: 1,
    q4: 2,
    q5: 2,
  });
  assert.equal(perfect.score, 100);
  assert.equal(perfect.passed, true);
  assert.equal(perfect.correctCount, 5);

  // 4 out of 5 (80%) -> passes
  const fourOfFive = gradeQuiz({
    q1: 1,
    q2: 2,
    q3: 1,
    q4: 2,
    q5: 0, // wrong
  });
  assert.equal(fourOfFive.score, 80);
  assert.equal(fourOfFive.passed, true);
  assert.equal(fourOfFive.correctCount, 4);

  // 3 out of 5 (60%) -> fails
  const threeOfFive = gradeQuiz({
    q1: 1,
    q2: 2,
    q3: 1,
    q4: 0, // wrong
    q5: 0, // wrong
  });
  assert.equal(threeOfFive.score, 60);
  assert.equal(threeOfFive.passed, false);
  assert.equal(threeOfFive.correctCount, 3);
});
