/**
 * Flashcard content (section 13.2, 14).
 *
 * Every card names a recognised source and carries a doctor review date, because
 * `servableCards()` refuses to serve one without it (FR-BRF-7).
 *
 * IMPORTANT, and stated in the card text itself: this is first-aid guidance, not
 * a diagnosis, and it contains no medicine doses. The `reviewedBy` values below
 * are PLACEHOLDERS for the demo - a real deployment needs a named doctor to sign
 * each card off (decision log, pilot partners).
 */
import type { FlashCard } from '@safecircle/shared';

const REVIEWED_AT = new Date('2026-09-01T00:00:00Z');
const REVIEW_DUE = new Date('2027-09-01T00:00:00Z');
/** Placeholder. A pilot must replace this with a real reviewer. */
const REVIEWER = 'PLACEHOLDER - not yet reviewed by a named doctor';

function card(
  key: string,
  title: string,
  group: string,
  source: string,
  body: FlashCard['body'],
): FlashCard {
  return {
    key,
    version: 1,
    title,
    group,
    body,
    source,
    reviewedBy: REVIEWER,
    reviewedAt: REVIEWED_AT,
    reviewDue: REVIEW_DUE,
  };
}

export const SEED_CARDS: FlashCard[] = [
  card(
    'cpr_hands_only',
    'Hands-only CPR',
    'life_threatening',
    'American Heart Association (verify against current AHA/ILCOR/IRC guidance)',
    {
      whatToCheck: [
        'Shout and shake the shoulders gently. No response?',
        'Look for normal breathing for no more than 10 seconds.',
        'Gasping is not normal breathing.',
      ],
      steps: [
        'Call 112 now, or ask someone else to, and put the phone on speaker.',
        'Lay them flat on their back on a firm surface.',
        'Heel of one hand in the centre of the chest, other hand on top, fingers interlocked.',
        'Push hard and fast: 100 to 120 compressions a minute.',
        'Press 5 to 6 cm deep for an average adult, letting the chest come all the way back up.',
        'Do not stop until help arrives or the person starts breathing normally.',
        'If another trained helper is there, swap every 2 minutes - this is exhausting.',
      ],
      doNot: [
        'Do not stop to check for a pulse.',
        'Do not give rescue breaths if you are untrained: compressions alone are what is advised.',
        'Do not delay compressions to look for an AED if you are alone.',
      ],
      whenToCall112: ['Immediately, before you start compressions if at all possible.'],
      tellTheCrew: [
        'When they collapsed.',
        'How long you have been doing compressions.',
        'Whether they ever responded or breathed.',
      ],
    },
  ),

  card(
    'fall_older_person',
    'Fall in an older person',
    'injury',
    'St John Ambulance / Indian Red Cross',
    {
      whatToCheck: [
        'Are they awake and talking?',
        'Any pain in the hip, thigh or back?',
        'Is one leg turned outwards or shorter than the other? That suggests a hip fracture.',
        'Any bleeding or a head knock?',
      ],
      steps: [
        'Introduce yourself and tell them help is on the way.',
        'Keep them still and warm where they are.',
        'Support the head and neck if they hit their head.',
        'Put a cushion or folded cloth under the head if it is comfortable.',
        'Stay with them and keep talking.',
      ],
      doNot: [
        'Do not lift them or help them stand if there is any hip, back or leg pain.',
        'Do not give food or water.',
        'Do not move them to a bed or chair "to be comfortable".',
      ],
      whenToCall112: [
        'Any suspected hip or back injury.',
        'They hit their head, are confused, or are on blood thinners.',
        'They cannot be roused, or pain is severe.',
      ],
      tellTheCrew: [
        'How they fell and from what height.',
        'Whether they lost consciousness.',
        'Which leg or hip hurts.',
        'What medicines they take.',
      ],
    },
  ),

  card(
    'low_blood_sugar',
    'Low blood sugar',
    'medical',
    'Indian Red Cross / St John Ambulance',
    {
      whatToCheck: [
        'Shaky, sweaty, pale, confused or unusually irritable?',
        'Known diabetes on the profile?',
        'Can they sit up and swallow safely?',
      ],
      steps: [
        'If they are awake and can swallow, give something sugary they can drink or chew.',
        'Sit them down while they take it.',
        'Wait about 10 to 15 minutes and see if they improve.',
        'Once better, offer a proper snack such as a biscuit or a banana.',
        'If they use their own glucose gel or tablets, help them take their own.',
      ],
      doNot: [
        'Do not put anything in the mouth of someone who is drowsy or unconscious.',
        'Do not give insulin.',
        'Do not leave them alone until they are fully back to normal.',
      ],
      whenToCall112: [
        'They cannot swallow, are drowsy or unconscious.',
        'No improvement after about 15 minutes.',
        'They have a fit.',
      ],
      tellTheCrew: [
        'That they are diabetic.',
        'What sugar you gave and when.',
        'Whether they improved at all.',
      ],
    },
  ),

  card(
    'stroke_be_fast',
    'Stroke (BE FAST)',
    'medical',
    'American Heart Association / Indian Stroke Association',
    {
      whatToCheck: [
        'Balance: sudden loss of balance or coordination?',
        'Eyes: sudden trouble seeing?',
        'Face: ask them to smile. Does one side droop?',
        'Arms: ask them to raise both arms. Does one drift down?',
        'Speech: ask them to repeat a sentence. Is it slurred or odd?',
        'Time: note the time the first symptom appeared.',
      ],
      steps: [
        'Call 112 immediately. Stroke treatment is time-critical.',
        'Note and write down the exact time symptoms started.',
        'Sit them up slightly with the head and shoulders supported.',
        'Loosen tight clothing.',
        'Stay with them and keep them calm.',
      ],
      doNot: [
        'Do not give food, drink or any medicine, including aspirin.',
        'Do not let them "lie down and sleep it off".',
        'Do not drive them yourself if an ambulance is coming.',
      ],
      whenToCall112: ['At once, on any single one of these signs.'],
      tellTheCrew: [
        'The exact time symptoms started.',
        'Which signs you saw.',
        'What medicines they take, especially blood thinners.',
      ],
    },
  ),

  card(
    'chest_pain',
    'Suspected heart attack',
    'medical',
    'American Heart Association',
    {
      whatToCheck: [
        'Central chest pain, tightness or heaviness?',
        'Pain spreading to the arm, jaw, neck or back?',
        'Sweating, nausea, breathlessness?',
      ],
      steps: [
        'Call 112 immediately.',
        'Sit them down, leaning back, knees bent up - do not let them walk about.',
        'Loosen tight clothing.',
        'If they have their own prescribed GTN spray or tablets, help them take their own.',
        'Stay with them. Be ready to start CPR if they stop responding.',
      ],
      doNot: [
        'Do not let them walk or drive.',
        'Do not give any medicine that is not already prescribed to them.',
        'Do not leave them alone.',
      ],
      whenToCall112: ['At once. Do not wait to see whether it passes.'],
      tellTheCrew: [
        'When the pain started and what it feels like.',
        'Any heart history on the profile.',
        'Anything they have already taken.',
      ],
    },
  ),

  card('seizure', 'Seizure', 'medical', 'Indian Red Cross / St John Ambulance', {
    whatToCheck: ['Are they jerking or stiff?', 'How long has it lasted?', 'Anything hard or sharp nearby?'],
    steps: [
      'Note the time it started.',
      'Clear hard or sharp objects away from them.',
      'Cushion the head with something soft.',
      'Once the jerking stops, roll them onto their side into the recovery position.',
      'Stay with them while they come round and tell them where they are.',
    ],
    doNot: [
      'Do not hold them down or try to stop the movements.',
      'Do not put anything in their mouth.',
      'Do not give food or drink until they are fully alert.',
    ],
    whenToCall112: [
      'The fit lasts more than 5 minutes.',
      'A second fit follows quickly.',
      'They do not come round, are injured, or this is their first ever fit.',
    ],
    tellTheCrew: ['How long it lasted.', 'Whether they have epilepsy.', 'Any injury during the fit.'],
  }),

  card('asthma_attack', 'Asthma attack', 'medical', 'St John Ambulance', {
    whatToCheck: ['Wheezing, struggling to speak a full sentence?', 'Do they have their own inhaler?'],
    steps: [
      'Help them sit upright and lean slightly forward. Do not lie them down.',
      'Help them use their OWN reliever inhaler as they normally would.',
      'Encourage slow, steady breaths.',
      'Keep them calm - panic makes it worse.',
    ],
    doNot: [
      'Do not lie them down.',
      'Do not use someone else’s inhaler.',
      'Do not decide the dose for them: help them do what they normally do.',
    ],
    whenToCall112: [
      'The inhaler is not helping.',
      'They cannot speak, are going blue, or are becoming exhausted.',
      'They have no inhaler with them.',
    ],
    tellTheCrew: ['How long the attack has lasted.', 'How much reliever they have used.'],
  }),

  card('unconscious_breathing', 'Unconscious but breathing', 'life_threatening', 'Indian Red Cross', {
    whatToCheck: ['No response to shouting or a gentle shake?', 'Breathing normally?'],
    steps: [
      'Call 112.',
      'Roll them onto their side into the recovery position so the airway stays clear.',
      'Tilt the head back slightly and lift the chin.',
      'Keep checking that they are still breathing.',
      'Keep them warm and stay with them.',
    ],
    doNot: [
      'Do not leave them on their back unattended.',
      'Do not put anything in their mouth.',
      'Do not move them more than you need to if you suspect a neck injury.',
    ],
    whenToCall112: ['At once.'],
    tellTheCrew: ['How long they have been unconscious.', 'Anything that happened before.'],
  }),

  card('severe_bleeding', 'Severe bleeding', 'life_threatening', 'St John Ambulance', {
    whatToCheck: ['Where is the blood coming from?', 'Is it spurting or soaking through quickly?'],
    steps: [
      'Call 112.',
      'Press firmly on the wound with a clean cloth or pad.',
      'Keep pressing. Add another pad on top if it soaks through.',
      'Raise the injured part above the level of the heart if you can.',
      'Lie them down and keep them warm.',
    ],
    doNot: [
      'Do not remove the first pad to look.',
      'Do not use a tourniquet unless you have been trained.',
      'Do not try to pull out an embedded object - press around it instead.',
    ],
    whenToCall112: ['Any bleeding you cannot control quickly.'],
    tellTheCrew: ['How much blood has been lost.', 'How long pressure has been applied.'],
  }),

  card('choking', 'Choking', 'life_threatening', 'St John Ambulance / AHA', {
    whatToCheck: ['Can they cough, speak or breathe at all?', 'Adult, child or infant?'],
    steps: [
      'If they can cough, encourage them to keep coughing.',
      'If they cannot: 5 sharp back blows between the shoulder blades with the heel of your hand.',
      'If that fails, 5 abdominal thrusts for an adult or older child.',
      'Alternate 5 back blows and 5 thrusts.',
      'If they become unresponsive, call 112 and start CPR.',
    ],
    doNot: [
      'Do not give abdominal thrusts to an infant under one year - use chest thrusts.',
      'Do not put your fingers blindly into the mouth to fish for the object.',
    ],
    whenToCall112: ['If the blockage does not clear after the first cycle, or they become unresponsive.'],
    tellTheCrew: ['What they choked on.', 'What you did and whether anything came out.'],
  }),

  card('allergic_reaction', 'Severe allergic reaction', 'life_threatening', 'St John Ambulance', {
    whatToCheck: [
      'Swelling of the lips, tongue or throat?',
      'Widespread rash, wheeze, or sudden collapse?',
      'Do they carry their own adrenaline auto-injector?',
    ],
    steps: [
      'Call 112 and say you think it is anaphylaxis.',
      'Help them use their OWN auto-injector as they have been taught.',
      'Lie them flat with their legs raised. Sit them up only if breathing is hard.',
      'If no better after about 5 minutes and they have a second injector, help them use it.',
    ],
    doNot: [
      'Do not let them stand or walk.',
      'Do not use an injector prescribed to someone else.',
      'Do not wait to see if it settles.',
    ],
    whenToCall112: ['At once, every time.'],
    tellTheCrew: ['The likely trigger.', 'What time the injector was used, and how many.'],
  }),

  card('lost_child', 'Lost child', 'people', 'Child-safeguarding good practice', {
    whatToCheck: ['Do they know their own name?', 'Any injury or distress?', 'Any adult nearby who should have them?'],
    steps: [
      'Get down to their eye level and introduce yourself calmly.',
      'Stay in a visible, busy public place with them.',
      'Call the parent number in the alert, and the local security desk.',
      'Keep them talking about something ordinary while you wait.',
      'Hand over only to the named parent or guardian, or to the police.',
    ],
    doNot: [
      'NEVER take the child anywhere - not to your home, your car, or a quieter room.',
      'Do not let them wander off to look for the parent.',
      'Do not hand them to anyone who simply claims to be family.',
    ],
    whenToCall112: ['If no parent is reachable, the child is hurt, or anything about the situation worries you.'],
    tellTheCrew: ['Where you found them.', 'What they have told you.', 'Who you have contacted.'],
  }),

  card('wandering_person', 'Wandering person with dementia', 'people', 'Alzheimer’s and Related Disorders Society of India', {
    whatToCheck: ['Do they seem frightened or disoriented?', 'Are they dressed for the weather?', 'Any injury?'],
    steps: [
      'Approach slowly from the front and introduce yourself.',
      'Use their name from the alert, and the name they respond to.',
      'Speak slowly in short sentences. Give them time to answer.',
      'Walk with them to a safe, quiet place nearby - do not take them away.',
      'Call the family contact and the guard.',
    ],
    doNot: [
      'Do not argue, correct or quiz them.',
      'Do not grab their arm or restrain them.',
      'Do not take them to your own home.',
    ],
    whenToCall112: ['If they are injured, very cold, near traffic, or will not stay in a safe place.'],
    tellTheCrew: ['Where you found them and which way they were heading.', 'How oriented they seem.'],
  }),

  card('harassment_bystander', 'Harassment as a bystander', 'people', 'Bystander-intervention good practice (the five Ds)', {
    whatToCheck: ['Is it safe for you to be here at all?', 'How many people are involved?', 'Is a weapon visible?'],
    steps: [
      'Call 112 first.',
      'Observe from a safe distance. Note what you can see.',
      'Distract if it is safe: ask the person being targeted an ordinary question.',
      'Delegate: get a guard, a shopkeeper or other people involved.',
      'Stay with the person afterwards if they want you to.',
      'If the alert says arrive quietly, do not mention SafeCircle out loud.',
    ],
    doNot: [
      'NEVER confront or physically intervene.',
      'Do not film the person being targeted.',
      'Do not follow anyone.',
    ],
    whenToCall112: ['Immediately, before anything else.'],
    tellTheCrew: ['Descriptions and direction of travel.', 'What you saw, not what you assume.'],
  }),

  card('panic_attack', 'Panic attack', 'people', 'St John Ambulance', {
    whatToCheck: ['Fast breathing, trembling, fear of dying?', 'Any chest pain or heart history that could mean something else?'],
    steps: [
      'Move them somewhere quieter if they are willing.',
      'Speak calmly and tell them they are safe and it will pass.',
      'Encourage slow breathing - in through the nose, out slowly through the mouth.',
      'Stay with them until it eases.',
    ],
    doNot: [
      'Do not tell them to calm down or that there is nothing wrong.',
      'Do not assume it is panic if there is chest pain or a heart history - treat that as a heart problem.',
      'Do not crowd them.',
    ],
    whenToCall112: ['Chest pain, a heart history, or it does not ease within about 20 minutes.'],
    tellTheCrew: ['How long it has lasted.', 'Whether this has happened before.'],
  }),

  card('injury_head', 'Head injury', 'injury', 'St John Ambulance', {
    whatToCheck: ['Did they lose consciousness, even briefly?', 'Confused, vomiting, or a bad headache?', 'Any fluid from the ear or nose?'],
    steps: [
      'Sit them down and keep them still.',
      'Hold a cold pack wrapped in cloth against the bump.',
      'Keep checking how awake and oriented they are.',
      'Stay with them - symptoms can appear later.',
    ],
    doNot: [
      'Do not let them carry on as normal.',
      'Do not give them anything to eat or drink in case surgery is needed.',
      'Do not let them sleep it off unobserved.',
    ],
    whenToCall112: [
      'Any loss of consciousness, confusion, repeated vomiting or fit.',
      'Fluid from the ear or nose, or unequal pupils.',
      'They are on blood thinners.',
    ],
    tellTheCrew: ['How the injury happened.', 'Whether they blacked out and for how long.'],
  }),

  card('building_fire', 'Fire in the building', 'building', 'Fire-safety good practice', {
    whatToCheck: ['Where is the smoke coming from?', 'Is the escape route clear?', 'Anyone who cannot evacuate alone?'],
    steps: [
      'Call 112 immediately.',
      'Raise the alarm and get everyone out.',
      'Use the stairs. Close doors behind you.',
      'Tell the guard which flats hold people who need help evacuating.',
      'Wait outside at the assembly point for the fire service.',
    ],
    doNot: [
      'NEVER use the lift.',
      'Do not go back inside for belongings.',
      'Do not try to fight anything beyond a very small, contained fire.',
    ],
    whenToCall112: ['At once.'],
    tellTheCrew: ['Which floor and flat.', 'Who may still be inside.', 'Where the gas connection is.'],
  }),
];
