/**
 * Incident state machine (section 8.3, FR-INC-4/5).
 *
 * Two properties matter more than the diagram:
 *   - `escalated` is a FLAG, not a state. Telling 112 does not stop volunteers.
 *   - Nothing auto-closes an unresolved incident. A stale one is flagged for a
 *     human on the dashboard instead.
 */
import type { IncidentState } from './types.js';

export type StateTrigger =
  | 'identified'
  | 'alerts_sent'
  | 'responder_accepted'
  | 'responder_on_my_way'
  | 'responder_arrived'
  | 'cancel_requested'
  | 'verified_safe'
  | 'verification_failed'
  | 'closed_by_responder'
  | 'closed_by_guard'
  | 'closed_by_dashboard'
  | 'all_responders_withdrew';

const TRANSITIONS: Record<IncidentState, Partial<Record<StateTrigger, IncidentState>>> = {
  new: {
    alerts_sent: 'dispatching',
    cancel_requested: 'cancel_verifying',
    closed_by_dashboard: 'resolved',
  },
  dispatching: {
    responder_accepted: 'accepted',
    cancel_requested: 'cancel_verifying',
    closed_by_guard: 'resolved',
    closed_by_dashboard: 'resolved',
  },
  accepted: {
    responder_on_my_way: 'en_route',
    responder_arrived: 'on_scene',
    cancel_requested: 'cancel_verifying',
    // Everyone who accepted withdrew: the incident is open again, not closed.
    all_responders_withdrew: 'dispatching',
    closed_by_responder: 'resolved',
    closed_by_guard: 'resolved',
    closed_by_dashboard: 'resolved',
  },
  en_route: {
    responder_arrived: 'on_scene',
    cancel_requested: 'cancel_verifying',
    all_responders_withdrew: 'dispatching',
    closed_by_responder: 'resolved',
    closed_by_guard: 'resolved',
    closed_by_dashboard: 'resolved',
  },
  on_scene: {
    closed_by_responder: 'resolved',
    closed_by_guard: 'resolved',
    closed_by_dashboard: 'resolved',
    // A scene can still turn out to need more help.
    all_responders_withdrew: 'dispatching',
  },
  cancel_verifying: {
    // Only a positive confirmation of safety ends help (section 6).
    verified_safe: 'resolved',
    // No answer, wrong PIN or duress: the alert is real and resumes.
    verification_failed: 'dispatching',
    closed_by_dashboard: 'resolved',
  },
  resolved: {},
};

export function canTransition(from: IncidentState, trigger: StateTrigger): boolean {
  return TRANSITIONS[from]?.[trigger] !== undefined;
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: IncidentState,
    readonly trigger: StateTrigger,
  ) {
    super(`Cannot ${trigger} from state ${from}`);
    this.name = 'IllegalTransitionError';
  }
}

export function nextState(from: IncidentState, trigger: StateTrigger): IncidentState {
  const to = TRANSITIONS[from]?.[trigger];
  if (!to) throw new IllegalTransitionError(from, trigger);
  return to;
}

export function isOpen(state: IncidentState): boolean {
  return state !== 'resolved';
}

/**
 * A cancel never ends help on its own: leaving `cancel_verifying` for `resolved`
 * requires a recorded verification. The caller passes whether one exists, so
 * this invariant is checked in the domain and not only in the database.
 */
export function canResolveFromVerifying(hasVerificationRecord: boolean): boolean {
  return hasVerificationRecord;
}

/**
 * Incidents are never auto-closed (FR-INC-5). This decides whether to flag one
 * for a human to look at.
 */
export function isStale(
  state: IncidentState,
  lastEventAt: Date,
  now: Date,
  staleAfterMinutes = 45,
): boolean {
  if (!isOpen(state)) return false;
  return now.getTime() - lastEventAt.getTime() > staleAfterMinutes * 60_000;
}

/** States in which a volunteer who accepted still holds their briefing. */
export function briefingStaysOpen(state: IncidentState): boolean {
  return state === 'accepted' || state === 'en_route' || state === 'on_scene' ||
    // Section 6.2: "continue unless stood down".
    state === 'cancel_verifying';
}

/** While verifying a cancel, no NEW volunteers may be added (section 6.2). */
export function acceptsNewResponders(state: IncidentState): boolean {
  return state === 'new' || state === 'dispatching';
}
