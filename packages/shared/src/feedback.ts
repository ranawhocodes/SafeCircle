/**
 * Device feedback patterns (section 7, FR-FDB-1/3/4).
 *
 * The standard table reports every stage through three senses at once, so a
 * blind user, a deaf user and a child can each follow the same device. Profiles
 * then transform that table - and two of them deliberately remove senses:
 *
 *   discreet: vibration only. No light, no sound, no calls to the person.
 *   stealth:  LIGHT ONLY, dim and side-facing. No buzzer, no vibration, no
 *             calls. Nobody standing next to her can tell help is coming.
 *
 * `transformForProfile` is the single place those rules live, so firmware stays
 * dumb: it plays whatever the server hands it.
 */
import type {
  DeviceStage,
  FeedbackPattern,
  FeedbackProfile,
  LightPattern,
  SoundPattern,
  VibrationPattern,
} from './types.js';

const SILENT: SoundPattern = { tone: 'none', volume: 0 };
const NO_VIBRATION: VibrationPattern = { pulses: 0, length: 'none' };
const NO_LIGHT: LightPattern = { colour: 'none', motion: 'off', brightness: 1 };

/** Section 7.1, the standard profile. */
const STANDARD: Record<DeviceStage, FeedbackPattern> = {
  idle: {
    stage: 'idle',
    light: NO_LIGHT,
    sound: SILENT,
    vibration: NO_VIBRATION,
    meaning: 'Ready',
  },
  holding: {
    stage: 'holding',
    light: { colour: 'white', motion: 'fill', brightness: 3 },
    sound: { tone: 'rising_ticks', volume: 2 },
    vibration: { pulses: 1, length: 'gentle' },
    meaning: 'Keep holding',
  },
  sending: {
    stage: 'sending',
    light: { colour: 'blue', motion: 'fast_blink', brightness: 4 },
    sound: { tone: 'short_beep', repeatEveryMs: 1000, volume: 2 },
    vibration: { pulses: 1, length: 'short' },
    meaning: 'Sending your call for help',
  },
  received: {
    stage: 'received',
    light: { colour: 'blue', motion: 'slow_pulse', brightness: 4 },
    sound: { tone: 'two_tone_chime', volume: 3 },
    vibration: { pulses: 1, length: 'long' },
    meaning: 'We got it',
  },
  accepted: {
    stage: 'accepted',
    light: { colour: 'green', motion: 'slow_pulse', brightness: 4 },
    sound: { tone: 'three_rising_notes', volume: 3 },
    vibration: { pulses: 2, length: 'short' },
    meaning: 'Someone is on the way',
  },
  arriving: {
    stage: 'arriving',
    light: { colour: 'green', motion: 'fast_pulse', brightness: 5 },
    sound: { tone: 'fast_chime', volume: 3 },
    vibration: { pulses: 3, length: 'short' },
    meaning: 'They are almost here',
  },
  arrived: {
    stage: 'arrived',
    light: { colour: 'green', motion: 'solid', brightness: 4 },
    sound: { tone: 'long_soft_tone', volume: 2 },
    vibration: { pulses: 1, length: 'long' },
    meaning: 'Help is with you',
  },
  escalated: {
    stage: 'escalated',
    light: { colour: 'purple', motion: 'slow_pulse', brightness: 4 },
    sound: { tone: 'two_note_distinct', volume: 3 },
    vibration: { pulses: 2, length: 'long' },
    meaning: 'Police or ambulance are also coming',
  },
  still_working: {
    stage: 'still_working',
    light: { colour: 'blue', motion: 'brighten', brightness: 5 },
    sound: SILENT,
    vibration: { pulses: 1, length: 'gentle', repeatEveryMs: 45_000 },
    meaning: 'Your alert is still active',
  },
  cancel_verifying: {
    // Deliberately quiet: an attacker who forced the cancel must not be able to
    // tell that help is still coming (section 6.2, decision #2).
    stage: 'cancel_verifying',
    light: { colour: 'white', motion: 'single_flash', brightness: 2 },
    sound: SILENT,
    vibration: NO_VIBRATION,
    meaning: 'Checking whether you are safe',
  },
  failed: {
    stage: 'failed',
    light: { colour: 'red', motion: 'fast_blink', brightness: 5 },
    sound: { tone: 'triple_beep', volume: 3 },
    vibration: { pulses: 3, length: 'long' },
    meaning: 'Not sent, still trying',
  },
  low_battery: {
    stage: 'low_battery',
    light: { colour: 'red', motion: 'slow_pulse', brightness: 2 },
    sound: SILENT,
    vibration: NO_VIBRATION,
    meaning: 'Battery low - the caregiver has been told',
  },
};

function clampBrightness(n: number): LightPattern['brightness'] {
  return Math.min(5, Math.max(1, Math.round(n))) as LightPattern['brightness'];
}

/**
 * Stages whose silence is a SAFETY property, not a style choice.
 *
 * `cancel_verifying` must stay quiet because an attacker who forced the cancel
 * is standing next to the person: a buzz or a chime would tell them help is
 * still coming (section 6.2). `low_battery` is quiet because the caregiver is
 * told instead of alarming the person, and `idle` is quiet because nothing is
 * happening.
 *
 * A profile may change the LIGHT on these stages, but it may never add sound or
 * vibration - so an amplifying profile like `loud` cannot undo the rule.
 */
const QUIET_STAGES = new Set<DeviceStage>(['idle', 'cancel_verifying', 'low_battery']);

export function isQuietStage(stage: DeviceStage): boolean {
  return QUIET_STAGES.has(stage);
}

/** Section 7.2. Each profile states exactly which senses it keeps. */
export function transformForProfile(
  pattern: FeedbackPattern,
  profile: FeedbackProfile,
): FeedbackPattern {
  const transformed = applyProfile(pattern, profile);

  // A deliberately silent stage stays silent whatever the profile asks for.
  if (QUIET_STAGES.has(pattern.stage)) {
    return {
      ...transformed,
      sound: pattern.sound.tone === 'none' ? { ...SILENT } : transformed.sound,
      vibration:
        pattern.vibration.pulses === 0 ? { ...NO_VIBRATION } : transformed.vibration,
    };
  }
  return transformed;
}

function applyProfile(pattern: FeedbackPattern, profile: FeedbackProfile): FeedbackPattern {
  const p: FeedbackPattern = {
    ...pattern,
    light: { ...pattern.light },
    sound: { ...pattern.sound },
    vibration: { ...pattern.vibration },
  };

  switch (profile) {
    case 'standard':
      return p;

    case 'loud':
      // Seniors with hearing loss: everything at maximum, chimes repeated.
      p.sound.volume = 3;
      if (p.sound.tone !== 'none') p.sound.repeatEveryMs ??= 3000;
      p.vibration.pulses = Math.max(p.vibration.pulses, 2) as VibrationPattern['pulses'];
      p.vibration.length = p.vibration.length === 'none' ? 'long' : p.vibration.length;
      return p;

    case 'calm':
      // Autism, dementia, anxiety: no beeping, soft tones, slow fades.
      if (p.sound.tone === 'short_beep' || p.sound.tone === 'triple_beep' ||
          p.sound.tone === 'rising_ticks') {
        p.sound.tone = 'long_soft_tone';
      }
      p.sound.volume = Math.min(p.sound.volume, 1) as SoundPattern['volume'];
      delete p.sound.repeatEveryMs;
      if (p.light.motion === 'fast_blink' || p.light.motion === 'fast_pulse') {
        p.light.motion = 'slow_pulse';
      }
      p.light.brightness = clampBrightness(p.light.brightness - 1);
      return p;

    case 'child':
      // Friendly, never alarming.
      p.sound.volume = Math.min(p.sound.volume, 2) as SoundPattern['volume'];
      if (p.sound.tone === 'triple_beep') p.sound.tone = 'two_tone_chime';
      if (p.light.colour === 'red') p.light.colour = 'purple';
      return p;

    case 'visual_first':
      // Deaf users: brighter light, stronger vibration, sound optional.
      p.light.brightness = 5;
      p.vibration.pulses = Math.max(p.vibration.pulses, 2) as VibrationPattern['pulses'];
      if (p.vibration.length === 'none') p.vibration.length = 'long';
      p.sound.volume = Math.min(p.sound.volume, 1) as SoundPattern['volume'];
      return p;

    case 'touch_and_sound':
      // Blind users: colour is irrelevant, so counts and tones must be distinct.
      p.sound.volume = 3;
      if (p.vibration.length === 'none' && p.stage !== 'idle') {
        p.vibration = { pulses: 1, length: 'short' };
      }
      return p;

    case 'discreet':
      // Harassment, stalking, domestic risk: vibration only.
      p.light = NO_LIGHT;
      p.sound = SILENT;
      if (p.vibration.pulses === 0 && p.stage !== 'idle') {
        p.vibration = { pulses: 1, length: 'short' };
      }
      return p;

    case 'stealth':
      // Section 7.2: lights only, low brightness, on the side facing her.
      // No buzzer, no vibration, no calls to her phone.
      p.sound = SILENT;
      p.vibration = NO_VIBRATION;
      if (p.stage !== 'idle') {
        p.light.brightness = 1;
        if (p.light.colour === 'none') p.light.colour = 'blue';
        if (p.light.motion === 'off') p.light.motion = 'slow_pulse';
      }
      return p;
  }
}

export function patternFor(
  stage: DeviceStage,
  profile: FeedbackProfile = 'standard',
  opts?: { silentRequested?: boolean },
): FeedbackPattern {
  // F6: a silent_panic event forces the discreet transform regardless of the
  // person's configured profile — the gesture's purpose is silence (§7.2).
  const effectiveProfile = opts?.silentRequested ? 'discreet' : profile;
  return transformForProfile(STANDARD[stage], effectiveProfile);
}

export function allPatternsFor(profile: FeedbackProfile): FeedbackPattern[] {
  return (Object.keys(STANDARD) as DeviceStage[]).map((s) => patternFor(s, profile));
}

/** Profiles that must never trigger a call to the person (section 6.3). */
export function allowsCallToPerson(profile: FeedbackProfile): boolean {
  return profile !== 'discreet' && profile !== 'stealth';
}

/**
 * Ordering for FR-FDB-3: a late or duplicate status update must never move the
 * device backwards. The device compares sequence numbers, but the server also
 * refuses to emit a regression.
 *
 * `escalated`, `failed`, `still_working` and `low_battery` are transient
 * overlays that can legitimately appear at any point, so they are left out of
 * the ordering entirely rather than given a rank.
 */
const STAGE_ORDER: DeviceStage[] = [
  'idle',
  'holding',
  'sending',
  'received',
  'cancel_verifying',
  'accepted',
  'arriving',
  'arrived',
];

export function stageRank(stage: DeviceStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function isRegression(current: DeviceStage, incoming: DeviceStage): boolean {
  const a = stageRank(current);
  const b = stageRank(incoming);
  if (a === -1 || b === -1) return false;
  return b < a;
}
