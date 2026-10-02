/** Shared fixtures for the domain tests. */

/** Lakshmi, 78: the worked example in master document section 14.2. */
export const lakshmi = {
  id: 'p-lakshmi',
  name: 'Lakshmi Raman',
  respondsToName: 'Paati',
  ageBand: '75+',
  languages: ['ta', 'en'],
  feedbackProfile: 'loud',
  preSendCountdownS: 0,
  lat: 13.0827,
  lng: 80.2707,
  address: '12 Gandhi Street',
  flat: 'B-204',
  health: {
    conditions: ['Type 2 diabetes', 'Hypertension'],
    medicines: ['Metformin'],
    bloodGroup: 'B+',
  },
  handling: { hearing: 'Hard of hearing: face her and speak slowly.' },
  protected: false,
  hasOwnPhone: true,
  safePinSet: false,
  duressPinSet: false,
};

/** Arjun, 9: non-verbal autistic child with a Go pendant on a bag tag. */
export const arjun = {
  id: 'p-arjun',
  name: 'Arjun Kumar',
  ageBand: '0-12',
  languages: ['ta'],
  feedbackProfile: 'calm',
  preSendCountdownS: 0,
  lat: 13.09,
  lng: 80.28,
  health: {},
  handling: { speech: 'Non-verbal. Do not touch. Keep voices low.', avoid: ['No loud voices'] },
  protected: true,
  wanderingHistory: true,
  hasOwnPhone: false,
  safePinSet: false,
  duressPinSet: false,
};

/** Meera: a woman using Stealth mode in public. */
export const meera = {
  id: 'p-meera',
  name: 'Meera S',
  ageBand: '18-59',
  languages: ['ta', 'en', 'hi'],
  feedbackProfile: 'stealth',
  preSendCountdownS: 0,
  lat: 13.06,
  lng: 80.26,
  health: {},
  handling: {},
  protected: true,
  hasOwnPhone: true,
  safePinSet: true,
  duressPinSet: true,
};

export function volunteer(over = {}) {
  return {
    id: 'v1',
    name: 'Volunteer One',
    trustLevel: 2,
    skills: ['none'],
    languages: ['ta', 'en'],
    transport: 'walk',
    maxDistanceM: 3000,
    optedOutCaseTypes: [],
    reliabilityScore: 0.5,
    lat: 13.0827,
    lng: 80.2707,
    locationAgeS: 60,
    alertsToday: 0,
    ...over,
  };
}

/** Offset a position by roughly `metres` to the east. */
export function eastOf(lat, lng, metres) {
  return { lat, lng: lng + metres / (111_320 * Math.cos((lat * Math.PI) / 180)) };
}

export function panic(over = {}) {
  return {
    source: 'go_pendant',
    sender: 'GO-021',
    type: 'panic',
    at: new Date('2026-10-01T06:00:00Z'),
    ...over,
  };
}

export function card(key, title, over = {}) {
  return {
    key,
    version: 1,
    title,
    group: 'medical',
    body: { whatToCheck: [], steps: [], doNot: [], whenToCall112: [], tellTheCrew: [] },
    source: 'Indian Red Cross',
    reviewedBy: 'Dr A Rao',
    reviewedAt: new Date('2026-06-01T00:00:00Z'),
    reviewDue: new Date('2027-06-01T00:00:00Z'),
    ...over,
  };
}

export const CARDS = [
  card('cpr_hands_only', 'Hands-only CPR', { group: 'life_threatening' }),
  card('fall_older_person', 'Fall in an older person', { group: 'injury' }),
  card('low_blood_sugar', 'Low blood sugar'),
  card('stroke_be_fast', 'Stroke (BE FAST)'),
  card('chest_pain', 'Suspected heart attack'),
  card('seizure', 'Seizure'),
  card('asthma_attack', 'Asthma attack'),
  card('unconscious_breathing', 'Unconscious but breathing'),
  card('severe_bleeding', 'Severe bleeding'),
  card('choking', 'Choking'),
  card('lost_child', 'Lost child', { group: 'people' }),
  card('wandering_person', 'Wandering person with dementia', { group: 'people' }),
  card('harassment_bystander', 'Harassment as a bystander', { group: 'people' }),
  card('panic_attack', 'Panic attack', { group: 'people' }),
  card('injury_head', 'Head injury', { group: 'injury' }),
  card('allergic_reaction', 'Severe allergic reaction', { group: 'life_threatening' }),
  card('building_fire', 'Fire in the building', { group: 'building' }),
];
