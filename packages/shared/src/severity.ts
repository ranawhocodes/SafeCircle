/**
 * Severity scoring (section 8.2, FR-INC-3).
 *
 * Rules only. An AI triage layer may later add a *suggestion* alongside this,
 * but it must never change the level a rule produced: a life-safety dispatch
 * decision has to be explainable after the fact.
 */
import { FUSION } from './config.js';
import type {
  CaseType,
  IncidentFlags,
  NormalisedEvent,
  PersonProfile,
  Severity,
} from './types.js';

export interface SeverityInputs {
  event: NormalisedEvent;
  person: PersonProfile | null;
  /** Answer to the optional start-of-alert check-in call, if one came back. */
  checkInAnswer?: 'medical' | 'fall' | 'danger' | 'mistake' | 'no_answer' | null;
  /** Free-text report from a caregiver, e.g. "she is unconscious". */
  caregiverReport?: string | null;
  /** Set once a cancel could not be verified (section 6.2). */
  possibleDuress?: boolean;
  /** Current speed from the pendant, m/s. */
  speedMps?: number | null;
}

export interface SeverityResult {
  severity: Severity;
  caseType: CaseType;
  flags: IncidentFlags;
  /** Every rule that fired, in order, for the dashboard and the audit log. */
  reasons: string[];
}

const CRITICAL_CONDITIONS = [
  'cardiac',
  'heart',
  'seizure',
  'epilepsy',
  'arrhythmia',
  'copd',
];

const UNCONSCIOUS_WORDS = ['unconscious', 'not breathing', 'collapsed', 'no pulse'];

function hasCriticalCondition(person: PersonProfile | null): boolean {
  const conditions = person?.health?.conditions ?? [];
  return conditions.some((c) =>
    CRITICAL_CONDITIONS.some((k) => c.toLowerCase().includes(k)),
  );
}

/** A profile that may not be left to an unverified volunteer (FR-ALT-7). */
export function caseTypeFor(
  person: PersonProfile | null,
  inputs: SeverityInputs,
): CaseType {
  if (inputs.checkInAnswer === 'danger') return 'harassment';
  if (inputs.checkInAnswer === 'fall') return 'fall';
  if (inputs.checkInAnswer === 'medical') return 'medical';
  if (!person) return 'unknown';
  if (person.feedbackProfile === 'discreet' || person.feedbackProfile === 'stealth') {
    return 'harassment';
  }
  if (person.ageBand === '0-12' || person.ageBand === '13-17') return 'child';
  if (person.handling?.avoid?.length && person.wanderingHistory) return 'cognitive';
  if (hasCriticalCondition(person)) return 'medical';
  if (person.ageBand === '75+') return 'fall';
  return 'unknown';
}

export function scoreSeverity(inputs: SeverityInputs): SeverityResult {
  const { event, person } = inputs;
  const reasons: string[] = [];
  const flags: IncidentFlags = {};
  const caseType = caseTypeFor(person, inputs);

  if (event.isDrill) flags.drill = true;
  if (event.onBehalfOfPersonId) flags.raisedByCaregiver = true;
  if (person?.feedbackProfile === 'stealth') flags.stealth = true;

  // An unknown sender never reaches volunteers automatically (FR-TRG-6).
  if (!person) {
    flags.unverified = true;
    reasons.push('Sender is not in the registry: guard desk and dashboard only.');
    return { severity: 'unverified', caseType: 'unknown', flags, reasons };
  }

  // --- P1 rules, most serious first --------------------------------------
  if (inputs.possibleDuress) {
    flags.possibleDuress = true;
    reasons.push('A cancel could not be verified: treating as duress.');
    return { severity: 'P1', caseType, flags, reasons };
  }

  const report = (inputs.caregiverReport ?? '').toLowerCase();
  if (UNCONSCIOUS_WORDS.some((w) => report.includes(w))) {
    reasons.push('Caregiver reports the person is unconscious or not breathing.');
    return { severity: 'P1', caseType: 'collapse', flags, reasons };
  }

  if (inputs.checkInAnswer === 'danger') {
    reasons.push('Check-in call answered "3 danger".');
    return { severity: 'P1', caseType: 'harassment', flags, reasons };
  }

  if (hasCriticalCondition(person) && inputs.checkInAnswer === 'no_answer') {
    reasons.push(
      'Cardiac or seizure history and no answer to the check-in call.',
    );
    return { severity: 'P1', caseType: 'collapse', flags, reasons };
  }

  // Possible abduction: a child or cognitive profile moving at vehicle speed.
  // Decision needed (section 8.2) and flagged for ethics review before a pilot.
  const protectedProfile = caseType === 'child' || caseType === 'cognitive';
  if (
    protectedProfile &&
    (inputs.speedMps ?? 0) >= FUSION.vehicleSpeedMps
  ) {
    flags.possibleAbduction = true;
    reasons.push(
      'A protected profile is moving at vehicle speed: possible abduction.',
    );
    return { severity: 'P1', caseType, flags, reasons };
  }

  // Stealth and discreet presses are violence risks, so 112 is told at once
  // (section 16.3 #11).
  if (person.feedbackProfile === 'stealth' || person.feedbackProfile === 'discreet') {
    reasons.push('Stealth or discreet profile: treated as a danger to the person.');
    return { severity: 'P1', caseType: 'harassment', flags, reasons };
  }

  // --- P3: an explicit "help, not an emergency" press --------------------
  if (event.type === 'panic' && inputs.checkInAnswer === 'mistake') {
    reasons.push('Check-in call answered "4 pressed by mistake".');
    return { severity: 'P3', caseType, flags, reasons };
  }

  // --- P2 is the default for any press or HELP (section 8.2) -------------
  reasons.push('Registered person raised an alarm: default urgent.');
  return { severity: 'P2', caseType, flags, reasons };
}

/** P1 tells 112 at once; P2 only after nobody accepts; P3 never automatically. */
export function escalatesImmediately(severity: Severity): boolean {
  return severity === 'P1';
}

export function autoEscalatesOnTimeout(severity: Severity): boolean {
  return severity === 'P2';
}
