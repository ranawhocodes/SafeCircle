/**
 * What the button shows (section 7, FR-FDB-1/2/3/4).
 *
 * The server owns the mapping from incident state to device stage, and already
 * applies the person's feedback profile, so firmware stays dumb: it plays
 * whatever it is handed. That also means a profile change takes effect without
 * reflashing anything.
 */
import {
  isRegression,
  patternFor,
  type DeviceStage,
  type FeedbackPattern,
  type FeedbackProfile,
  type IncidentFlags,
  type IncidentState,
} from '@safecircle/shared';
import {
  devicesForPerson,
  getStatusCursor,
  setStatusCursor,
} from '../db/repositories/devices.js';
import { findIncident } from '../db/repositories/incidents.js';
import type { Queryable } from '../db/pool.js';

/**
 * Map incident state to the stage the person should feel.
 *
 * `escalated` is checked before the state, because "police are also coming" is
 * the more important thing to convey; but only while nobody has arrived yet.
 */
export function stageForIncident(
  state: IncidentState,
  flags: IncidentFlags,
  responderNearby: boolean,
): DeviceStage {
  if (state === 'cancel_verifying') return 'cancel_verifying';
  if (state === 'on_scene') return 'arrived';
  if (state === 'en_route') return responderNearby ? 'arriving' : 'accepted';
  if (state === 'accepted') return 'accepted';
  if (state === 'resolved') return 'idle';
  // new / dispatching
  if (flags.escalated) return 'escalated';
  return 'received';
}

export interface DeviceStatus {
  stage: DeviceStage;
  seq: number;
  pattern: FeedbackPattern;
  incidentOpen: boolean;
  pollAfterMs: number;
}

/**
 * Push a stage to every device the person owns.
 *
 * Two rules are enforced here rather than at the call sites, because a caller
 * that forgets either one creates a safety bug that is invisible in testing:
 *
 *  1. A regression is refused. A late timer or a retried webhook must never tell
 *     someone "sending" after they have already felt "help is with you".
 *
 *  2. A duress incident keeps the cancelled pattern. If a cancel could not be
 *     verified, someone may have forced it and be watching the device, expecting
 *     it to go quiet. Section 6.2 requires the button to keep showing the
 *     cancelled pattern - so "someone is on the way" or "police are also coming"
 *     must not appear, however many other parts of the system want to say so.
 */
export async function pushStage(
  personId: string,
  incidentId: string | null,
  stage: DeviceStage,
  client?: Queryable,
): Promise<void> {
  if (incidentId !== null && stage !== 'cancel_verifying') {
    const incident = await findIncident(incidentId);
    if (incident?.flags.possibleDuress === true) {
      // The only thing that may follow is the incident being closed, which
      // returns the device to idle.
      if (stage !== 'idle') return;
    }
  }

  for (const device of await devicesForPerson(personId)) {
    const cursor = await getStatusCursor(device.deviceId);
    if (isRegression(cursor.stage, stage)) continue;
    await setStatusCursor(device.deviceId, stage, incidentId, client);
  }
}

/** The payload the firmware polls for. */
export async function statusFor(
  deviceId: string,
  profile: FeedbackProfile,
): Promise<DeviceStatus> {
  const cursor = await getStatusCursor(deviceId);
  const incidentOpen = cursor.incidentId !== null && cursor.stage !== 'idle';

  // F6: if this device's open incident was triggered by a silent_panic, the
  // feedback must use the discreet transform regardless of the person's profile.
  let silentRequested = false;
  if (cursor.incidentId) {
    const incident = await findIncident(cursor.incidentId);
    if (incident?.flags.silentRequested) silentRequested = true;
  }

  return {
    stage: cursor.stage,
    seq: cursor.seq,
    pattern: patternFor(cursor.stage, profile, { silentRequested }),
    incidentOpen,
    // Polling drains the battery, which is acceptable during an emergency and
    // not between them (section 7.3).
    pollAfterMs: incidentOpen ? 3000 : 15_000,
  };
}
