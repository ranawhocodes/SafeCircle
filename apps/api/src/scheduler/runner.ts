/**
 * The timer runner (FR-INC-6, NFR-12).
 *
 * Timers live in the database, not in memory, so an incident survives an API
 * restart: a 90-second escalation armed before a deploy still fires after it.
 * The claim query is atomic (`UPDATE ... RETURNING` with `FOR UPDATE SKIP
 * LOCKED`), so this stays correct if the API is ever run as more than one
 * process.
 */
import { TIMERS_S, isStale, type TimerKind } from '@safecircle/shared';
import {
  appendEvent,
  claimDueTimers,
  findIncident,
  listDispatches,
  scheduleTimer,
} from '../db/repositories/incidents.js';
import { findPerson } from '../db/repositories/people.js';
import { latestFix } from '../db/repositories/volunteers.js';
import { escalate } from '../domain/escalation.js';
import { verificationDeadlineReached, applyVerificationOutcome } from '../domain/cancel.js';
import { upgradeAll } from '../services/dispatch.js';
import { callFamily } from '../services/notification.js';
import { currentLocation } from '../services/location.js';
import { providers } from '../providers/index.js';
import { haversineM } from '@safecircle/shared';

export interface TimerHandlerResult {
  handled: boolean;
  note?: string;
}

/**
 * Handle one due timer. Returns rather than throws, so one bad incident cannot
 * stop the runner for every other incident.
 */
export async function handleTimer(
  incidentId: string,
  kind: string,
): Promise<TimerHandlerResult> {
  const incident = await findIncident(incidentId);
  if (!incident) return { handled: false, note: 'incident gone' };
  // A closed incident's timers are cancelled, but a race is always possible.
  if (incident.closedAt) return { handled: false, note: 'incident closed' };

  const person = incident.personId ? await findPerson(incident.personId) : null;

  switch (kind as TimerKind) {
    case 'upgradeAll': {
      // Only meaningful while nobody has accepted.
      const accepted = (await listDispatches(incidentId)).some((d) => d.response === 'accepted');
      if (accepted) return { handled: false, note: 'already accepted' };
      await upgradeAll(incident, person);
      return { handled: true };
    }

    case 'familyVoiceCall': {
      if (incident.familyOpenedAt) {
        await appendEvent(incidentId, 'family_call_skipped', 'system', null, {
          reason: 'The family had already opened the status page.',
        });
        return { handled: false, note: 'family already informed' };
      }
      if (!person) return { handled: false, note: 'no person' };
      await callFamily(incidentId, person.id, person.name, person.languages[0] ?? 'en');
      return { handled: true };
    }

    case 'escalate112': {
      const accepted = (await listDispatches(incidentId)).some((d) => d.response === 'accepted');
      if (accepted) return { handled: false, note: 'someone accepted in time' };
      await escalate(
        incidentId,
        `Nobody accepted within ${TIMERS_S.escalate112}s: authorities told.`,
      );
      return { handled: true };
    }

    case 'stillComing': {
      return handleStillComing(incidentId);
    }

    case 'onSceneCheckin': {
      await appendEvent(incidentId, 'on_scene_checkin', 'system', null, {
        note: 'Check-in ping to the responder and the family.',
      });
      for (const d of await listDispatches(incidentId)) {
        if (d.response !== 'accepted') continue;
        await providers.push.send({
          volunteerId: d.volunteerId,
          priority: 'normal',
          kind: 'still_coming',
          payload: { incidentId, message: 'Still on scene? Tap to update.' },
        });
      }
      return { handled: true };
    }

    case 'verificationRetry': {
      if (incident.state !== 'cancel_verifying') {
        return { handled: false, note: 'no longer verifying' };
      }
      // One retry, exactly as section 6.2 describes.
      await appendEvent(incidentId, 'verification_retry', 'system', null, {
        note: 'No answer on the first attempt: calling once more.',
      });
      await applyVerificationOutcome(incidentId, 'no_answer');
      return { handled: true };
    }

    case 'verificationDeadline': {
      if (incident.state !== 'cancel_verifying') {
        return { handled: false, note: 'resolved before the deadline' };
      }
      await verificationDeadlineReached(incidentId);
      return { handled: true };
    }

    default:
      return { handled: false, note: `unknown timer kind ${kind}` };
  }
}

/**
 * "Still coming?" (section 8.4). An accepted responder who has not moved closer
 * is the stalker signal from section 16.4 #16/#17, so it is flagged as well as
 * nudged.
 */
async function handleStillComing(incidentId: string): Promise<TimerHandlerResult> {
  const incident = await findIncident(incidentId);
  if (!incident) return { handled: false };
  if (incident.state === 'on_scene') return { handled: false, note: 'already on scene' };

  const personLocation = await currentLocation(incidentId);
  const accepted = (await listDispatches(incidentId)).filter((d) => d.response === 'accepted');
  if (accepted.length === 0) return { handled: false, note: 'nobody accepted' };

  let anyMoving = false;
  for (const d of accepted) {
    const fix = await latestFix(d.volunteerId, incidentId);
    const movingCloser =
      fix !== null &&
      personLocation !== null &&
      haversineM(fix.lat, fix.lng, personLocation.lat, personLocation.lng) < 2000;
    if (movingCloser) anyMoving = true;

    await providers.push.send({
      volunteerId: d.volunteerId,
      priority: 'normal',
      kind: 'still_coming',
      payload: { incidentId, message: 'Still coming? Tap to confirm or release the alert.' },
    });
  }

  if (!anyMoving) {
    await appendEvent(incidentId, 'responder_not_moving', 'system', null, {
      note: 'No accepted responder has reported moving closer. Re-opening to others.',
      volunteers: accepted.map((d) => d.volunteerId),
    });
    const { mergeFlags } = await import('../db/repositories/incidents.js');
    await mergeFlags(incidentId, { responderNotMoving: true });

    const person = incident.personId ? await findPerson(incident.personId) : null;
    await upgradeAll(incident, person);
  }

  // Ask again, so an unresponsive responder cannot hold an incident forever.
  for (const t of [
    { kind: 'stillComing' as TimerKind, fireAt: new Date(Date.now() + TIMERS_S.stillComing * 1000 * incident.demoTimeScale) },
  ]) {
    await scheduleTimer(incidentId, t.kind, t.fireAt);
  }

  return { handled: true };
}

/**
 * The polling loop. 250 ms is well inside the one-second resolution the timers
 * need, and the claim query returns nothing almost every tick.
 */
export class TimerRunner {
  private handle: NodeJS.Timeout | null = null;
  private running = false;
  private ticks = 0;
  private fired = 0;

  constructor(
    private readonly intervalMs = 250,
    private readonly onError: (err: Error) => void = () => {},
  ) {}

  start(): void {
    if (this.handle) return;
    this.handle = setInterval(() => void this.tick(), this.intervalMs);
    // Do not hold the process open on this interval alone.
    this.handle.unref?.();
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle);
    this.handle = null;
  }

  get stats(): { ticks: number; fired: number } {
    return { ticks: this.ticks, fired: this.fired };
  }

  /** Exposed so tests can drive the runner deterministically. */
  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    this.ticks += 1;
    try {
      const due = await claimDueTimers(now);
      for (const timer of due) {
        try {
          await handleTimer(timer.incidentId, timer.kind);
          this.fired += 1;
        } catch (err) {
          this.onError(err as Error);
          await appendEvent(timer.incidentId, 'timer_failed', 'system', null, {
            kind: timer.kind,
            error: (err as Error).message,
          }).catch(() => {});
        }
      }
      return due.length;
    } catch (err) {
      this.onError(err as Error);
      return 0;
    } finally {
      this.running = false;
    }
  }
}

/**
 * Flag incidents nobody has touched for a while. FR-INC-5 forbids auto-closing
 * them, so this only marks them for a human on the dashboard.
 */
export async function flagStaleIncidents(now = new Date()): Promise<string[]> {
  const { listOpenIncidents } = await import('../db/repositories/incidents.js');
  const flagged: string[] = [];
  for (const incident of await listOpenIncidents(100)) {
    if (!isStale(incident.state, incident.lastEventAt, now)) continue;
    await appendEvent(incident.id, 'flagged_stale', 'system', null, {
      note: 'No activity for a while. Never auto-closed - a human must decide.',
      lastEventAt: incident.lastEventAt,
    });
    flagged.push(incident.id);
  }
  return flagged;
}
