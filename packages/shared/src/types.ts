/**
 * SafeCircle shared domain types.
 *
 * These describe the vocabulary the whole system speaks: the API, the web faces,
 * the device simulator and the tests. Nothing here touches I/O.
 */

// ---------------------------------------------------------------------------
// Channels and events (master document section 4, 8.1)
// ---------------------------------------------------------------------------

/** Every way an alarm can reach us. Face A is everything except `volunteer_app`. */
export type EventSource =
  | 'home_button'
  | 'go_pendant'
  | 'whatsapp'
  | 'sms'
  | 'missed_call'
  | 'caregiver_link'
  | 'bystander_qr'
  | 'volunteer_app'
  | 'dashboard';

export type DeviceEvent =
  | 'panic'
  | 'cancel'
  | 'silent_panic'
  | 'location_update'
  | 'heartbeat'
  | 'low_battery';

/**
 * What every channel collapses to before the pipeline runs (section 8.1 step 2).
 * Routing must never depend on which channel produced the event.
 */
export interface NormalisedEvent {
  source: EventSource;
  /** Device id, phone number in E.164, or QR code - whatever identifies the sender. */
  sender: string;
  type: DeviceEvent;
  at: Date;
  location?: RawLocationReport;
  /** Free text from WhatsApp/SMS or a bystander note. Never used for routing. */
  text?: string;
  /** Set when a caregiver raises an alarm on a dependent's behalf. */
  onBehalfOfPersonId?: string;
  battery?: number;
  seq?: number;
  isDrill?: boolean;
}

// ---------------------------------------------------------------------------
// Location (sections 18.2, 19.2)
// ---------------------------------------------------------------------------

export type LocationSource =
  | 'gps'
  | 'wifi'
  | 'cell'
  | 'known_place'
  | 'registry'
  | 'bystander';

export interface GpsFix {
  lat: number;
  lng: number;
  acc_m: number;
  /** Seconds since the fix was taken. A stale fix must lose to a fresh estimate. */
  age_s: number;
}

export interface WifiObservation {
  bssid: string;
  rssi: number;
}

export interface CellObservation {
  mcc: number;
  mnc: number;
  tac: number;
  cell_id: number;
}

/** Exactly what a Go pendant puts on the wire (section 18.7). */
export interface RawLocationReport {
  gps?: GpsFix | null;
  wifi?: WifiObservation[] | null;
  cell?: CellObservation | null;
  known_place?: string | null;
}

/**
 * A resolved position. `source` and `accuracyM` are mandatory because
 * FR-INC-10 forbids hiding uncertainty from anyone.
 */
export interface FusedLocation {
  lat: number;
  lng: number;
  accuracyM: number;
  source: LocationSource;
  at: Date;
  speedMps?: number;
  /** Human label for a known place, e.g. "Hillside School". */
  label?: string;
}

// ---------------------------------------------------------------------------
// Incidents (section 8)
// ---------------------------------------------------------------------------

export type Severity = 'P1' | 'P2' | 'P3' | 'unverified';

export type IncidentState =
  | 'new'
  | 'dispatching'
  | 'accepted'
  | 'en_route'
  | 'on_scene'
  | 'cancel_verifying'
  | 'resolved';

/**
 * Flags are orthogonal to state. `escalated` in particular is a flag and not a
 * terminal state: 112 being told does not stop anything else (section 8.3).
 */
export interface IncidentFlags {
  drill?: boolean;
  unverified?: boolean;
  escalated?: boolean;
  possibleDuress?: boolean;
  raisedByCaregiver?: boolean;
  possibleAbduction?: boolean;
  stealth?: boolean;
  /**
   * Set when the triggering event was `silent_panic` (the discreet triple-press
   * gesture). Forces the device to use the discreet feedback transform regardless
   * of the person's configured feedback profile — because the gesture's whole
   * purpose is silence (section 7.2, F6).
   */
  silentRequested?: boolean;
  /** Set when an accepted responder has not moved closer - section 16.4 #16/#17. */
  responderNotMoving?: boolean;
  /** Set when this incident is a volunteer onboarding practice drill alert (F28). */
  practice?: boolean;
  practiceVolunteerId?: string;
  /** Check-in answer to the start-of-alert IVR call (F15). */
  checkInAnswer?: 'medical' | 'fall' | 'danger' | 'mistake' | 'no_answer';
  /** Caregiver report text from trigger or portal. */
  caregiverReport?: string;
}

export type CaseType =
  | 'medical'
  | 'collapse'
  | 'fall'
  | 'child'
  | 'cognitive'
  | 'harassment'
  | 'fire'
  | 'unknown';

export type IncidentOutcome =
  | 'false_alarm'
  | 'no_help_needed'
  | 'helped_on_scene'
  | 'handed_to_ambulance'
  | 'handed_to_police'
  | 'person_not_found'
  | 'cancelled_verified_safe';

// ---------------------------------------------------------------------------
// People (section 5.2)
// ---------------------------------------------------------------------------

export type AgeBand = '0-12' | '13-17' | '18-59' | '60-74' | '75+';

export type FeedbackProfile =
  | 'standard'
  | 'loud'
  | 'calm'
  | 'child'
  | 'visual_first'
  | 'touch_and_sound'
  | 'discreet'
  | 'stealth';

export interface HandlingNeeds {
  hearing?: string;
  vision?: string;
  speech?: string;
  calmingSteps?: string[];
  avoid?: string[];
}

export interface HealthSummary {
  conditions?: string[];
  medicines?: string[];
  allergies?: string[];
  bloodGroup?: string;
  mobilityAids?: string[];
  doctor?: string;
  hospital?: string;
}

/**
 * The dispatch-relevant projection of a person. Deliberately not the DB row:
 * nothing here is a secret that staged disclosure must withhold except
 * `health` and `handling`, which only reach an accepted responder.
 */
export interface PersonProfile {
  id: string;
  name: string;
  respondsToName?: string;
  ageBand: AgeBand;
  languages: string[];
  photoUrl?: string;
  societyId?: string;
  address?: string;
  flat?: string;
  landmark?: string;
  lat?: number;
  lng?: number;
  feedbackProfile: FeedbackProfile;
  preSendCountdownS: number;
  health?: HealthSummary;
  handling?: HandlingNeeds;
  /** True for children, cognitive disabilities and discreet cases (FR-ALT-7). */
  protected: boolean;
  wanderingHistory?: boolean;
  responderPreference?: 'woman_first' | null;
  hasOwnPhone: boolean;
  safePinSet: boolean;
  duressPinSet: boolean;
}

// ---------------------------------------------------------------------------
// Volunteers (sections 10, 12)
// ---------------------------------------------------------------------------

/** L0 Registered, L1 ID-checked, L2 Verified, L3 Professional, L4 Police-verified. */
export type TrustLevel = 0 | 1 | 2 | 3 | 4;

export type VolunteerSkill =
  | 'doctor'
  | 'nurse'
  | 'paramedic'
  | 'pharmacist'
  | 'first_aider'
  | 'police'
  | 'fire'
  | 'ex_serviceman'
  | 'security'
  | 'none';

export type Transport = 'walk' | 'cycle' | 'two_wheeler';

export type AvailabilityMode =
  | 'off'
  | 'available_now'
  | 'available_until'
  | 'duty_windows'
  | 'home_only'
  | 'auto_pause';

export type DeclineReason = 'too_far' | 'busy' | 'not_safe' | 'not_trained';

export interface VolunteerCandidate {
  id: string;
  name: string;
  trustLevel: TrustLevel;
  skills: VolunteerSkill[];
  languages: string[];
  transport: Transport;
  maxDistanceM: number;
  optedOutCaseTypes: CaseType[];
  /**
   * The volunteer's own quiet hours, if they set any. Opt-in: a volunteer who
   * has not configured them can be alerted at any hour, which is what makes the
   * "3 a.m., nobody available" path in section 16.5 #22 work at all.
   */
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  /** 0..1, from past accept and arrive rates. */
  reliabilityScore: number;
  /** Last known position: a coarse zone between incidents, a fresh fix during one. */
  lat: number;
  lng: number;
  locationAgeS: number;
  isWoman?: boolean;
  alertsToday: number;
}

export type Tier = 1 | 2;

// ---------------------------------------------------------------------------
// Device feedback (section 7)
// ---------------------------------------------------------------------------

export type DeviceStage =
  | 'idle'
  | 'holding'
  | 'sending'
  | 'received'
  | 'accepted'
  | 'arriving'
  | 'arrived'
  | 'escalated'
  | 'still_working'
  | 'cancel_verifying'
  | 'failed'
  | 'low_battery';

export type LightColour =
  | 'white'
  | 'blue'
  | 'green'
  | 'purple'
  | 'red'
  | 'none';

export type LightMotion =
  | 'fill'
  | 'fast_blink'
  | 'solid'
  | 'slow_pulse'
  | 'fast_pulse'
  | 'brighten'
  | 'single_flash'
  | 'off';

export interface LightPattern {
  colour: LightColour;
  motion: LightMotion;
  /** 1 (dimmest, used by stealth) to 5 (brightest, used by visual_first). */
  brightness: 1 | 2 | 3 | 4 | 5;
}

export interface SoundPattern {
  /** `none` means silence - required for discreet and stealth profiles. */
  tone:
    | 'none'
    | 'rising_ticks'
    | 'short_beep'
    | 'two_tone_chime'
    | 'three_rising_notes'
    | 'fast_chime'
    | 'long_soft_tone'
    | 'two_note_distinct'
    | 'triple_beep';
  repeatEveryMs?: number;
  volume: 0 | 1 | 2 | 3;
}

export interface VibrationPattern {
  /** `0` means no vibration - required for stealth. */
  pulses: 0 | 1 | 2 | 3;
  length: 'none' | 'short' | 'long' | 'gentle';
  repeatEveryMs?: number;
}

/** What the firmware plays. Already transformed for the person's profile. */
export interface FeedbackPattern {
  stage: DeviceStage;
  light: LightPattern;
  sound: SoundPattern;
  vibration: VibrationPattern;
  /** Plain-language meaning, for the portal preview and accessibility docs. */
  meaning: string;
}

// ---------------------------------------------------------------------------
// Verification (section 6)
// ---------------------------------------------------------------------------

export type VerificationOutcome =
  | 'safe'
  | 'need_help'
  | 'no_answer'
  | 'wrong_pin'
  | 'duress';

export type VerificationChannel =
  | 'ivr_person'
  | 'ivr_caregiver'
  | 'message_person'
  | 'device_confirm'
  | 'guard_check';

// ---------------------------------------------------------------------------
// Disclosure (section 19.4, FR-BRF-1)
// ---------------------------------------------------------------------------

export type ViewKind = 'pre_accept' | 'accepted' | 'guard';

/**
 * Everything a volunteer may see BEFORE accepting. There is nothing to strip:
 * the identifying fields do not exist on this type.
 */
export interface PreAcceptView {
  viewKind: 'pre_accept';
  incidentId: string;
  tier: Tier;
  category: CaseType;
  severity: Severity;
  ageBand: AgeBand;
  /** Rounded to a band so an exact position cannot be inferred. */
  distanceBandM: number;
  etaS: number;
  respondersSoFar: number;
  safetyNotice: string | null;
  stealth: boolean;
  isDrill: boolean;
  expiresAt: Date;
}

export interface AcceptedView {
  viewKind: 'accepted';
  incidentId: string;
  person: {
    name: string;
    respondsToName?: string;
    ageBand: AgeBand;
    photoUrl?: string;
    languages: string[];
  };
  location: FusedLocation;
  address?: string;
  flat?: string;
  landmark?: string;
  handlingBanner: string[];
  health?: HealthSummary;
  familyContactMasked?: string;
  guardContactMasked?: string;
  isDrill: boolean;
}

export interface GuardView extends Omit<AcceptedView, 'viewKind'> {
  viewKind: 'guard';
  accessSecrets: {
    gateCode?: string;
    doorCode?: string;
    spareKeyHolder?: string;
  };
}

export type PersonView = PreAcceptView | AcceptedView | GuardView;

// ---------------------------------------------------------------------------
// Flashcards (section 14)
// ---------------------------------------------------------------------------

export interface CardBody {
  whatToCheck: string[];
  steps: string[];
  doNot: string[];
  whenToCall112: string[];
  tellTheCrew: string[];
}

export interface FlashCard {
  key: string;
  version: number;
  title: string;
  group: string;
  body: CardBody;
  source: string;
  /** A card with no doctor review must never be served (FR-BRF-7). */
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewDue: Date | null;
}

export interface RankedCard {
  key: string;
  title: string;
  score: number;
  /** Why this card was suggested, for the dashboard and for debugging dispatch. */
  because: string[];
}
