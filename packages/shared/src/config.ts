/**
 * Tunable constants. Every value the master document marks "(est.)" or
 * "Decision needed" lives here with a comment naming the section, so a team
 * decision is a one-line change and never a hunt through logic.
 *
 * See docs/07-decision-log.md for the status of each.
 */

/** Press timings in milliseconds (section 6.1). */
export const PRESS = {
  /** Hold to raise an SOS. Shorter is a brush and is ignored. */
  sosHoldMs: 2000,
  /** Hold to request cancel. Deliberately longer than the trigger so the two
   *  cannot be confused. */
  cancelHoldMs: 4000,
  /** Taps for a silent SOS on discreet/stealth profiles. */
  silentPressCount: 3,
  silentPressWindowMs: 1200,
} as const;

/** Timer schedule in seconds for a P2 incident (section 8.4). All est. */
export const TIMERS_S = {
  /** No Tier 1 accept by now: upgrade everyone and widen the radius. */
  upgradeAll: 30,
  /** Family message unopened by now: place an automated call, then next contact. */
  familyVoiceCall: 60,
  /** Nobody accepted by now: tell 112. */
  escalate112: 90,
  /** After accept: is the responder actually moving closer? */
  stillComing: 180,
  /** After arrival: nudge for an update. */
  onSceneCheckin: 1800,
  /** Verification call retry after no answer (section 6.2). */
  verificationRetry: 10,
  /** Hard deadline for deciding a cancel (section 6.2, "about 60 s at most"). */
  verificationDeadline: 60,
} as const;

export type TimerKind = keyof typeof TIMERS_S;

/** Dispatch shape (sections 9.1, 9.2). Decision needed on all of these. */
export const DISPATCH = {
  /** How many nearest verified volunteers get the high-priority alarm. */
  tier1Size: 3,
  /** Close-proximity radius (F16 Priority 1): only volunteers within this
   *  distance are considered for the initial top-3 selection during the first
   *  30 seconds. Verified are picked first, unverified backfill the rest.
   *  Set to 750 m to cover the ~707 m maximum coarse-cell quantization
   *  offset so volunteers in the local 1 km neighborhood cell qualify. */
  closeProximityM: 750,
  /** If the initial top 3 don't respond within 30 s, ALL volunteers within
   *  this radius are alerted at Tier 1 (section 9.1, F16). */
  escalationRadiusM: 1000,
  /** Radius steps in metres when there are too few verified volunteers nearby. */
  radiusStepsM: [1500, 3000, 5000],
  /** Alerts per volunteer per day before they are rested (section 9.2). */
  dailyAlertCap: 4,
  /** Re-rank candidates when the person has moved this far (section 9.2). */
  reRankOnMoveM: 200,
  /** How long a pre-accept alert stays actionable before it is withdrawn.
   *  GoodSAM drops an unanswered alert after 15 s; we keep it longer because
   *  Tier 2 is a normal notification, not a siren. */
  alertTtlS: 300,
  /** A fix older than this is treated as a zone, not a position. */
  staleLocationS: 3600,
} as const;

/** Ranking weights (section 9.3). Bonuses are in seconds of effective ETA. */
export const RANKING = {
  walkingSpeedMps: 1.4,
  twoWheelerSpeedMps: 6.9,
  /** Below this distance everyone is assumed to walk, whatever their transport. */
  walkUnderM: 1000,
  skillBonusS: { doctor: 60, nurse: 60, paramedic: 60, first_aider: 30 },
  /** Full reliability (1.0) is worth this many seconds. */
  maxReliabilityBonusS: 20,
  /** Added when the profile asked for a woman responder and this one is not. */
  responderPreferencePenaltyS: 90,
  /** Added when no language is shared with the person. */
  languagePenaltyS: 45,
} as const;

/** How many responders a case should attract (section 8.5). Decision needed. */
export const TEAM_CAPS = {
  collapse: 3,
  medical: 2,
  fall: 2,
  child: 1,
  cognitive: 1,
  harassment: 3,
  fire: 3,
  unknown: 2,
} as const;

/** Flashcard prediction weights (section 14.2). Hand-set until pilot data exists. */
export const CARD_WEIGHTS = {
  profile: 5,
  history: 4,
  context: 6,
  ageBand: 2,
  population: 1,
  /**
   * Life-threatening words in the trigger context ("not breathing",
   * "unconscious", "choking", "bleeding heavily") must dominate every accumulated
   * prior. A diabetic with a fall history who has stopped breathing needs CPR
   * first, and no amount of history should push that below a chip.
   */
  criticalContext: 30,
} as const;

/** Location fusion (section 18.2). */
export const FUSION = {
  /** Precedence when two sources are equally fresh. Higher wins. */
  sourceRank: {
    gps: 50,
    known_place: 40,
    wifi: 30,
    bystander: 25,
    cell: 20,
    registry: 10,
  } as Record<string, number>,
  /** A GPS fix older than this stops counting as GPS-grade. */
  gpsFreshS: 120,
  /** Pendant update cadence while an incident is open (section 18.2). */
  updateMovingS: 10,
  updateStillS: 60,
  /** Speed above this on a child or cognitive profile suggests a vehicle
   *  (section 8.2, 16.7 #31). Decision needed - flagged for ethics review. */
  vehicleSpeedMps: 8,
} as const;

/** Retention in hours (section 20.2). Decision needed. */
export const RETENTION_H = {
  locationFixes: 72,
  responderChat: 24 * 7,
  maskedCallLogs: 24 * 7,
  incidentRecord: 24 * 365,
  auditLog: 24 * 365,
} as const;
