/**
 * Mandatory Volunteer Training & Tutorial Modules (F28).
 *
 * M1-M6 ensure every neighbourhood responder knows the golden rules before
 * receiving their first live emergency alert:
 *   - M1: The Safety-First Principle (Never confront, personal safety comes first)
 *   - M2: Speed & The 3-Minute Window (Tier 1 vs Tier 2, accepting only if attending)
 *   - M3: Approaching the Scene (Quiet arrival, medical flashcards, CPR guidance)
 *   - M4: Privacy & The Golden Rule (No photos, masked numbers, audit logging)
 *   - M5: Knowledge Check (Quiz with 80% pass threshold)
 *   - M6: Practice Alert Drill (Real siren, accept slider, briefing, completion)
 */

export interface TutorialModule {
  id: string;
  title: string;
  subtitle: string;
  durationMinutes: number;
  summary: string;
  takeaways: string[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export const TUTORIAL_MODULES: TutorialModule[] = [
  {
    id: 'm1_safety',
    title: 'The Safety-First Principle',
    subtitle: 'Your personal safety always comes before anything else',
    durationMinutes: 3,
    summary:
      'As a community responder, your job is to support and de-escalate, never to act as armed enforcement or put yourself in harm’s way.',
    takeaways: [
      'Never confront an aggressive individual or armed attacker.',
      'Always call 112 immediately if violence or weapons are present.',
      'Stay in well-lit public view whenever possible.',
      'You are never penalized for withdrawing if a scene becomes dangerous.',
    ],
  },
  {
    id: 'm2_speed',
    title: 'Speed & The 3-Minute Window',
    subtitle: 'Why immediate response saves lives in cardiac and falls',
    durationMinutes: 3,
    summary:
      'Brain damage begins within 4 minutes of cardiac arrest. Being 200 metres away makes you the fastest help on earth.',
    takeaways: [
      'Tier 1 alerts are sent to the 3 nearest verified volunteers with a loud siren.',
      'Only accept if you are prepared to leave immediately.',
      'If you cannot go, tap "Can’t go" instantly so the next nearest person is alerted.',
      'The slide-to-accept gesture prevents accidental accepts in pockets.',
    ],
  },
  {
    id: 'm3_scene',
    title: 'Approaching the Scene',
    subtitle: 'Quiet arrival, situational awareness, and medical flashcards',
    durationMinutes: 4,
    summary:
      'Arriving calmly reassures victims and prevents escalating tensions, especially in harassment or cognitive distress.',
    takeaways: [
      'For harassment or stealth alarms, arrive quietly without shouting or sirens.',
      'Speak calmly and introduce yourself: "Hello, I am a SafeCircle volunteer neighbour here to help."',
      'Use the live Flashcards on your mission screen for step-by-step guidance.',
      'For CPR, use the built-in 110 bpm metronome to maintain optimal compression rate.',
    ],
  },
  {
    id: 'm4_privacy',
    title: 'Privacy & The Golden Rule',
    subtitle: 'Treat vulnerable neighbours with absolute confidentiality',
    durationMinutes: 3,
    summary:
      'People trust SafeCircle in their most vulnerable moments. Respecting privacy is strictly audited and non-negotiable.',
    takeaways: [
      'Never take photos or videos of the person or scene.',
      'Never discuss the person’s identity or medical condition with neighbours or online groups.',
      'Phone numbers are masked to protect both your identity and theirs.',
      'Every briefing view and location access is cryptographically audit-logged.',
    ],
  },
  {
    id: 'm5_quiz',
    title: 'Volunteer Knowledge Check',
    subtitle: 'Demonstrate understanding of safety and privacy standards',
    durationMinutes: 5,
    summary:
      'A quick 5-question test. You must achieve at least 80% (4 out of 5) to qualify for active duty.',
    takeaways: [
      '5 multiple choice questions covering safety, speed, and privacy.',
      'Requires 80% score to pass.',
      'Retakes are permitted if needed.',
    ],
  },
  {
    id: 'm6_drill',
    title: 'Practice Alert Drill',
    subtitle: 'Experience a live simulated emergency alert',
    durationMinutes: 3,
    summary:
      'Trigger a practice alert to your own device. Experience the alarm, slide to accept, review the mission briefing, and mark resolved.',
    takeaways: [
      'Triggers a practice siren on your screen.',
      'Practice using the slide-to-accept control.',
      'Inspect medical flashcards and the CPR metronome.',
      'Marks your onboarding complete so you can go on duty.',
    ],
  },
];

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1',
    question: 'You receive an alert for a harassment incident nearby. How should you approach?',
    options: [
      'Shout loudly from a distance to scare the perpetrator.',
      'Approach quietly and observe from safety; do not confront.',
      'Directly tackle the suspicious individual.',
      'Call your neighbours to form a crowd first.',
    ],
    correctIndex: 1,
    explanation: 'Safety-first rule: arrive quietly and observe from a safe vantage point without confrontation.',
  },
  {
    id: 'q2',
    question: 'You accepted an alert but suddenly realize you are unable to leave your home. What should you do?',
    options: [
      'Wait for the family to call you.',
      'Do nothing and let the timer expire.',
      'Tap "Can\'t attend after all" immediately so backup is dispatched.',
      'Mark the incident as resolved.',
    ],
    correctIndex: 2,
    explanation: 'Tapping "Can\'t attend after all" immediately alerts dispatch to promote the next nearest volunteer without delay.',
  },
  {
    id: 'q3',
    question: 'During a cardiac emergency, what is the target compression rate for Hands-Only CPR?',
    options: [
      '60 compressions per minute.',
      '100 to 120 compressions per minute (110 bpm metronome).',
      '180 compressions per minute as fast as possible.',
      'Only deliver rescue breaths without chest compressions.',
    ],
    correctIndex: 1,
    explanation: 'Clinical guidelines recommend 100–120 compressions/minute; SafeCircle includes a 110 bpm metronome.',
  },
  {
    id: 'q4',
    question: 'Is it acceptable to take a photo of the incident scene to update your apartment WhatsApp group?',
    options: [
      'Yes, to keep the community informed.',
      'Only if the victim gave verbal consent.',
      'Never; recording or sharing photos violates privacy rules and is audit-logged.',
      'Yes, if you blur the faces.',
    ],
    correctIndex: 2,
    explanation: 'Strict zero-photography rule: safeguarding personal dignity and confidentiality is paramount.',
  },
  {
    id: 'q5',
    question: 'Who sees your personal phone number when you place a call through the mission screen?',
    options: [
      'The victim and their family.',
      'Only the security guard.',
      'Nobody; phone calls are relayed through masked numbers.',
      'Anyone in the society dashboard.',
    ],
    correctIndex: 2,
    explanation: 'Number masking protects both the responder and victim from unwanted contact outside the incident.',
  },
];

export interface QuizResult {
  score: number;
  correctCount: number;
  total: number;
  passed: boolean;
  answers: Record<string, { selected?: number; correct: number; isCorrect: boolean }>;
}

export function gradeQuiz(userAnswers: Record<string, number>): QuizResult {
  let correctCount = 0;
  const answers: QuizResult['answers'] = {};

  for (const q of QUIZ_QUESTIONS) {
    const selected = userAnswers[q.id];
    const isCorrect = selected === q.correctIndex;
    if (isCorrect) correctCount++;
    answers[q.id] = {
      selected,
      correct: q.correctIndex,
      isCorrect,
    };
  }

  const total = QUIZ_QUESTIONS.length;
  const score = Math.round((correctCount / total) * 100);
  const passed = score >= 80;

  return {
    score,
    correctCount,
    total,
    passed,
    answers,
  };
}
