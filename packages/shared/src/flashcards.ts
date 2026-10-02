/**
 * Smart flashcard prediction (section 14, FR-BRF-5/6/7).
 *
 * The moment a volunteer accepts, the app predicts the 3 situations they are
 * most likely to find, from the person's profile, age and own incident history:
 *
 *   score(c) = w1*profile + w2*history + w3*context + w4*age + w5*population
 *
 * Two safety rules are absolute:
 *   - "Not breathing or unresponsive? Start CPR" is ALWAYS present, whatever
 *     the ranking says.
 *   - A card without a dated doctor review is never served.
 */
import { CARD_WEIGHTS } from './config.js';
import type {
  AgeBand,
  CaseType,
  FlashCard,
  HealthSummary,
  PersonProfile,
  RankedCard,
} from './types.js';

/** The card that must never be ranked away. */
export const CPR_CARD_KEY = 'cpr_hands_only';

/** Condition keyword -> card key. Drives the `profile` term. */
const CONDITION_CARDS: Array<{ match: string[]; card: string; label: string }> = [
  { match: ['diabet', 'insulin'], card: 'low_blood_sugar', label: 'diabetes on the profile' },
  { match: ['epilep', 'seizure'], card: 'seizure', label: 'epilepsy on the profile' },
  { match: ['cardiac', 'heart', 'angina'], card: 'chest_pain', label: 'heart condition on the profile' },
  { match: ['asthma', 'copd'], card: 'asthma_attack', label: 'asthma on the profile' },
  { match: ['dementia', 'alzheim'], card: 'wandering_person', label: 'dementia on the profile' },
  { match: ['allerg', 'anaphyla'], card: 'allergic_reaction', label: 'severe allergy on the profile' },
  { match: ['stroke'], card: 'stroke_be_fast', label: 'stroke history on the profile' },
];

/** Age band -> commonly-found situations. Drives the `age` term. */
const AGE_CARDS: Record<AgeBand, string[]> = {
  '0-12': ['lost_child', 'asthma_attack', 'choking'],
  '13-17': ['panic_attack', 'injury_head', 'asthma_attack'],
  '18-59': ['injury_head', 'severe_bleeding', 'chest_pain'],
  '60-74': ['fall_older_person', 'chest_pain', 'stroke_be_fast'],
  '75+': ['fall_older_person', 'stroke_be_fast', 'chest_pain'],
};

/** Check-in answer or caregiver words -> card. Drives the `context` term. */
const CONTEXT_CARDS: Record<string, string> = {
  fall: 'fall_older_person',
  medical: 'chest_pain',
  danger: 'harassment_bystander',
  unconscious: 'unconscious_breathing',
  'not breathing': CPR_CARD_KEY,
  'no pulse': CPR_CARD_KEY,
  bleeding: 'severe_bleeding',
  choking: 'choking',
  fit: 'seizure',
  seizure: 'seizure',
  confused: 'low_blood_sugar',
};

/**
 * Context phrases that describe a life threat. These are scored with
 * `criticalContext` rather than `context`, so they outrank every accumulated
 * prior instead of competing with them (section 14.4: the cards are guidance,
 * but the ORDER must not bury an airway or circulation problem).
 */
const CRITICAL_CONTEXT = new Set([
  'not breathing',
  'no pulse',
  'unconscious',
  'choking',
  'bleeding',
]);

/** Case type -> card, used when nothing more specific is known. */
const CASE_TYPE_CARDS: Partial<Record<CaseType, string>> = {
  fall: 'fall_older_person',
  collapse: 'unconscious_breathing',
  harassment: 'harassment_bystander',
  cognitive: 'wandering_person',
  child: 'lost_child',
  fire: 'building_fire',
};

export interface PredictionInputs {
  person: Pick<PersonProfile, 'ageBand' | 'health' | 'handling' | 'wanderingHistory'>;
  caseType: CaseType;
  /** Outcome card keys from this person's own closed incidents, newest first. */
  history: string[];
  /** Check-in answer, caregiver text, or a bystander note. */
  contextText?: string | null;
  /** Hour of day 0-23. Early morning raises low blood sugar for a diabetic. */
  localHour?: number;
  /** What incidents for this age band usually turn out to be, learned over time. */
  populationPriors?: Record<string, number>;
}

function conditionMatches(health: HealthSummary | undefined): Array<{ card: string; label: string }> {
  const conditions = (health?.conditions ?? []).map((c) => c.toLowerCase());
  const out: Array<{ card: string; label: string }> = [];
  for (const entry of CONDITION_CARDS) {
    if (conditions.some((c) => entry.match.some((m) => c.includes(m)))) {
      out.push({ card: entry.card, label: entry.label });
    }
  }
  return out;
}

/**
 * Rank every available card. Returns the full ordered list; the caller takes
 * the top 3 and always appends the CPR card.
 */
export function rankCards(
  available: FlashCard[],
  inputs: PredictionInputs,
): RankedCard[] {
  const servable = available.filter(isServable);
  const scores = new Map<string, { score: number; because: string[] }>();

  const bump = (card: string, weight: number, why: string) => {
    if (!servable.some((c) => c.key === card)) return;
    const entry = scores.get(card) ?? { score: 0, because: [] };
    entry.score += weight;
    entry.because.push(why);
    scores.set(card, entry);
  };

  // w1 profile conditions
  for (const m of conditionMatches(inputs.person.health)) {
    bump(m.card, CARD_WEIGHTS.profile, m.label);
  }
  if (inputs.person.wanderingHistory) {
    bump('wandering_person', CARD_WEIGHTS.profile, 'wandering history on the profile');
  }

  // w2 this person's own history, decaying with age so recent events matter more
  inputs.history.forEach((card, i) => {
    const decay = 1 / (1 + i * 0.5);
    bump(card, CARD_WEIGHTS.history * decay, `${i === 0 ? 'most recent' : 'earlier'} incident was this`);
  });

  // w3 trigger context, with life threats weighted far above everything else
  const text = (inputs.contextText ?? '').toLowerCase();
  for (const [needle, card] of Object.entries(CONTEXT_CARDS)) {
    if (!text.includes(needle)) continue;
    const critical = CRITICAL_CONTEXT.has(needle);
    bump(
      card,
      critical ? CARD_WEIGHTS.criticalContext : CARD_WEIGHTS.context,
      critical
        ? `the alert mentioned "${needle}" - treated as a life threat`
        : `the alert mentioned "${needle}"`,
    );
  }
  const caseCard = CASE_TYPE_CARDS[inputs.caseType];
  if (caseCard) {
    bump(caseCard, CARD_WEIGHTS.context * 0.5, `case type is ${inputs.caseType}`);
  }

  // w4 age band
  (AGE_CARDS[inputs.person.ageBand] ?? []).forEach((card, i) => {
    bump(card, CARD_WEIGHTS.ageBand * (1 - i * 0.25), `common for age ${inputs.person.ageBand}`);
  });

  // Dawn and a diabetic profile: low blood sugar rises (the worked example in
  // section 14.2 is a 6 am press).
  if (
    inputs.localHour !== undefined &&
    inputs.localHour >= 4 &&
    inputs.localHour <= 9 &&
    conditionMatches(inputs.person.health).some((m) => m.card === 'low_blood_sugar')
  ) {
    bump('low_blood_sugar', CARD_WEIGHTS.context * 0.5, 'early morning and diabetic');
  }

  // w5 population priors
  for (const [card, prior] of Object.entries(inputs.populationPriors ?? {})) {
    bump(card, CARD_WEIGHTS.population * prior, 'common for people like this');
  }

  const ranked: RankedCard[] = servable
    .map((c) => {
      const entry = scores.get(c.key);
      return {
        key: c.key,
        title: c.title,
        score: entry?.score ?? 0,
        because: entry?.because ?? [],
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  return ranked;
}

export interface FlashcardSet {
  /** The three large chips (section 14.1 step 3). */
  likely: RankedCard[];
  /** Always on screen, whatever the prediction said (section 14.1 step 4). */
  alwaysVisible: RankedCard;
  /** Handling instructions, rendered above everything (FR-BRF-4). */
  handlingBanner: string[];
  safetyLine: string;
}

/** A card with no dated doctor review must never be served (FR-BRF-7). */
export function isServable(card: FlashCard): boolean {
  return card.reviewedBy !== null && card.reviewedAt !== null;
}

export function buildFlashcardSet(
  available: FlashCard[],
  inputs: PredictionInputs,
): FlashcardSet {
  const ranked = rankCards(available, inputs);
  const cpr = available.find((c) => c.key === CPR_CARD_KEY && isServable(c));

  return {
    likely: ranked.filter((c) => c.key !== CPR_CARD_KEY).slice(0, 3),
    alwaysVisible: {
      key: CPR_CARD_KEY,
      title: cpr?.title ?? 'Not breathing or unresponsive? Start CPR',
      score: Number.POSITIVE_INFINITY,
      because: ['Always available, whatever the prediction says.'],
    },
    handlingBanner: handlingBanner(inputs.person.handling),
    safetyLine: 'Check for danger before you go in.',
  };
}

/**
 * Turn handling needs into short imperative lines. This is what a responder
 * reads first, so it is phrased as an instruction, never as a diagnosis.
 */
export function handlingBanner(
  handling: PersonProfile['handling'] | undefined,
): string[] {
  if (!handling) return [];
  const out: string[] = [];
  if (handling.hearing) out.push(handling.hearing);
  if (handling.vision) out.push(handling.vision);
  if (handling.speech) out.push(handling.speech);
  for (const a of handling.avoid ?? []) out.push(a);
  for (const c of handling.calmingSteps ?? []) out.push(c);
  return out;
}

/**
 * How the chosen card is reported onward. FR-BRF-6 requires careful wording:
 * a volunteer's tap is an observation, never a diagnosis.
 */
export function observedTypeWording(cardTitle: string): string {
  return `Volunteer reports possible ${cardTitle.toLowerCase()}`;
}
