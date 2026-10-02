/**
 * Volunteer ranking and tiering (sections 9.1-9.3, FR-ALT-1/5/6/7).
 *
 * Distance alone picks the wrong person when a nurse is 50 m further away than
 * a student, so candidates are ordered by an EFFECTIVE ETA:
 *
 *   score = eta_seconds - skill_bonus - reliability_bonus + preference_penalty
 *
 * Every input that produced a score is returned alongside it. FR-ALT-5 requires
 * that a dispatch decision can be explained months later, which is impossible
 * if only the final number is stored.
 */
import { DISPATCH, RANKING } from './config.js';
import { distanceBand, etaSeconds, haversineM } from './geo.js';
import type {
  CaseType,
  PersonProfile,
  Severity,
  Tier,
  VolunteerCandidate,
  VolunteerSkill,
} from './types.js';

export interface RankInputs {
  distanceM: number;
  etaS: number;
  skillBonusS: number;
  reliabilityBonusS: number;
  preferencePenaltyS: number;
  languagePenaltyS: number;
  locationAgeS: number;
}

export interface RankedVolunteer {
  volunteer: VolunteerCandidate;
  score: number;
  inputs: RankInputs;
  /** Human sentences for the dashboard, one per term that moved the score. */
  because: string[];
}

const MEDICAL_CASES: CaseType[] = ['medical', 'collapse', 'fall'];

function skillBonusFor(skills: VolunteerSkill[], caseType: CaseType): number {
  if (!MEDICAL_CASES.includes(caseType)) return 0;
  let best = 0;
  for (const s of skills) {
    const bonus = (RANKING.skillBonusS as Record<string, number>)[s] ?? 0;
    if (bonus > best) best = bonus;
  }
  return best;
}

export function rankCandidate(
  v: VolunteerCandidate,
  person: Pick<PersonProfile, 'languages' | 'responderPreference'> & { lat: number; lng: number },
  caseType: CaseType,
): RankedVolunteer {
  const distanceM = haversineM(v.lat, v.lng, person.lat, person.lng);
  const etaS = etaSeconds(distanceM, v.transport);

  const skillBonusS = skillBonusFor(v.skills, caseType);
  const reliabilityBonusS = Math.round(
    Math.min(1, Math.max(0, v.reliabilityScore)) * RANKING.maxReliabilityBonusS,
  );

  const wantsWoman = person.responderPreference === 'woman_first';
  const preferencePenaltyS = wantsWoman && v.isWoman !== true
    ? RANKING.responderPreferencePenaltyS
    : 0;

  const sharesLanguage = v.languages.some((l) => person.languages.includes(l));
  const languagePenaltyS = sharesLanguage ? 0 : RANKING.languagePenaltyS;

  const score =
    etaS - skillBonusS - reliabilityBonusS + preferencePenaltyS + languagePenaltyS;

  const because: string[] = [
    `About ${distanceBand(distanceM)} m away, roughly ${Math.round(etaS / 60)} min by ${v.transport.replace('_', ' ')}.`,
  ];
  if (skillBonusS > 0) {
    because.push(`${skillBonusS} s skill bonus for a medical case.`);
  }
  if (reliabilityBonusS > 0) {
    because.push(`${reliabilityBonusS} s reliability bonus from past responses.`);
  }
  if (preferencePenaltyS > 0) {
    because.push('Profile asked for a woman responder first.');
  }
  if (languagePenaltyS > 0) {
    because.push('No shared language with the person.');
  }
  if (v.locationAgeS > 600) {
    because.push(`Location is ${Math.round(v.locationAgeS / 60)} min old.`);
  }

  return {
    volunteer: v,
    score,
    inputs: {
      distanceM,
      etaS,
      skillBonusS,
      reliabilityBonusS,
      preferencePenaltyS,
      languagePenaltyS,
      locationAgeS: v.locationAgeS,
    },
    because,
  };
}

export interface EligibilityContext {
  caseType: CaseType;
  /** Local hour 0-23, for quiet hours. */
  localHour: number;
  onDuty?: boolean;
}

export interface Ineligible {
  volunteer: VolunteerCandidate;
  reason: string;
}

/**
 * Reasons a nearby volunteer is not alerted at all. Returned rather than
 * silently dropped, so the dashboard can explain thin coverage.
 */
export function ineligibleReason(
  v: VolunteerCandidate,
  distanceM: number,
  ctx: EligibilityContext,
): string | null {
  if (v.optedOutCaseTypes.includes(ctx.caseType)) {
    return `Opted out of ${ctx.caseType} cases.`;
  }
  if (distanceM > v.maxDistanceM) {
    return `Further than their ${v.maxDistanceM} m limit.`;
  }
  if (v.alertsToday >= DISPATCH.dailyAlertCap) {
    return `Already had ${v.alertsToday} alerts today (cap ${DISPATCH.dailyAlertCap}).`;
  }
  if (!ctx.onDuty && inQuietHours(v, ctx.localHour)) {
    return `In their quiet hours (${v.quietHoursStart}:00-${v.quietHoursEnd}:00) and not on duty.`;
  }
  return null;
}

/**
 * Quiet hours are OPT-IN (section 9.2: "respect quiet hours unless the volunteer
 * is on duty"). A volunteer who never set any has none - applying a default
 * night-time window to everybody would silently empty the roster at exactly the
 * hour section 16.5 #22 is about.
 *
 * A window that wraps midnight (22 to 6) is handled explicitly.
 */
export function inQuietHours(
  v: Pick<VolunteerCandidate, 'quietHoursStart' | 'quietHoursEnd'>,
  localHour: number,
): boolean {
  const start = v.quietHoursStart;
  const end = v.quietHoursEnd;
  if (start === null || start === undefined || end === null || end === undefined) return false;
  if (start === end) return false;
  return start < end
    ? localHour >= start && localHour < end
    : localHour >= start || localHour < end;
}

export interface TierPlan {
  tier1: RankedVolunteer[];
  tier2: RankedVolunteer[];
  excluded: Ineligible[];
  /** Set when fewer than tier1Size verified volunteers were found. */
  sparse: boolean;
  radiusM: number;
  /** True when a protected profile has no verified responder available. */
  protectedProfileAtRisk: boolean;
}

export function isVerified(v: VolunteerCandidate): boolean {
  return v.trustLevel >= 2;
}

/**
 * Build the tiers for one incident.
 *
 * Tier 1 is the nearest `tier1Size` VERIFIED volunteers and gets the
 * full-screen alarm. Everyone else eligible gets a normal Tier 2 alert at the
 * same moment - the difference is urgency, not timing (section 9.1).
 */
export function planTiers(
  candidates: VolunteerCandidate[],
  person: Pick<PersonProfile, 'languages' | 'responderPreference' | 'protected'> & {
    lat: number;
    lng: number;
  },
  ctx: EligibilityContext,
  radiusM: number,
): TierPlan {
  const excluded: Ineligible[] = [];
  const eligible: RankedVolunteer[] = [];

  for (const v of candidates) {
    const distanceM = haversineM(v.lat, v.lng, person.lat, person.lng);
    if (distanceM > radiusM) {
      excluded.push({ volunteer: v, reason: 'Outside the search radius.' });
      continue;
    }
    const reason = ineligibleReason(v, distanceM, ctx);
    if (reason) {
      excluded.push({ volunteer: v, reason });
      continue;
    }
    eligible.push(rankCandidate(v, person, ctx.caseType));
  }

  eligible.sort((a, b) => a.score - b.score);

  const verified = eligible.filter((r) => isVerified(r.volunteer));
  const tier1 = verified.slice(0, DISPATCH.tier1Size);
  const tier1Ids = new Set(tier1.map((r) => r.volunteer.id));
  const tier2 = eligible.filter((r) => !tier1Ids.has(r.volunteer.id));

  return {
    tier1,
    tier2,
    excluded,
    sparse: verified.length < DISPATCH.tier1Size,
    radiusM,
    // FR-ALT-7: an unverified volunteer may never be the sole responder for a
    // child, a person with a cognitive disability or a discreet case.
    protectedProfileAtRisk: person.protected && verified.length === 0,
  };
}

/**
 * Widen the radius a step at a time when verified volunteers are sparse
 * (section 9.2). Returns null when the largest step has been used.
 */
export function nextRadius(currentM: number): number | null {
  for (const step of DISPATCH.radiusStepsM) {
    if (step > currentM) return step;
  }
  return null;
}

/**
 * Rolling top 3 (FR-ALT-3): when a Tier 1 volunteer declines, the next nearest
 * verified volunteer is promoted immediately rather than at the 30 s upgrade.
 */
export function promoteAfterDecline(
  plan: TierPlan,
  declinedVolunteerId: string,
): { promoted: RankedVolunteer | null; tier1: RankedVolunteer[] } {
  const tier1 = plan.tier1.filter((r) => r.volunteer.id !== declinedVolunteerId);
  const promoted =
    plan.tier2.find(
      (r) => isVerified(r.volunteer) && !tier1.some((t) => t.volunteer.id === r.volunteer.id),
    ) ?? null;
  if (promoted) tier1.push(promoted);
  return { promoted, tier1 };
}

/** Everyone is upgraded to high priority at the 30 s mark (FR-ALT-2). */
export function upgradeTier(_current: Tier): Tier {
  return 1;
}

/** The safety notice a volunteer sees BEFORE accepting (FR-VOL-4). */
export function safetyNoticeFor(caseType: CaseType, stealth: boolean): string | null {
  const lines: string[] = [];
  if (caseType === 'harassment') {
    lines.push(
      'Do not confront anyone. Observe from a safe distance and call 112.',
    );
  }
  if (caseType === 'fire') {
    lines.push('Do not enter. Help people out and keep clear of lifts.');
  }
  if (stealth) {
    lines.push('Arrive quietly. Do not mention SafeCircle or the alert out loud.');
  }
  return lines.length ? lines.join(' ') : null;
}

/** How many responders this case should attract before others stand by. */
export function teamCapFor(caseType: CaseType, severity: Severity): number {
  const caps: Record<CaseType, number> = {
    collapse: 3,
    medical: 2,
    fall: 2,
    child: 1,
    cognitive: 1,
    harassment: 3,
    fire: 3,
    unknown: 2,
  };
  const base = caps[caseType];
  // A P1 always allows one extra pair of hands.
  return severity === 'P1' ? base + 1 : base;
}
