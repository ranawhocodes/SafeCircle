/**
 * Timer schedule (section 8.4, FR-INC-6/7).
 *
 * `DEMO_TIME_SCALE` compresses every interval for stage use. The scale is
 * recorded on the incident so a dashboard can label the timeline "demo speed"
 * truthfully instead of quietly showing impossible numbers.
 */
import { TIMERS_S, type TimerKind } from './config.js';
import type { Severity } from './types.js';

export interface ScheduledTimer {
  kind: TimerKind;
  fireAt: Date;
}

export interface ScheduleOptions {
  severity: Severity;
  openedAt: Date;
  /** 1 = real time. 0.333 turns the 30 s upgrade into 10 s. */
  timeScale?: number;
  /** Drills alert nobody, so they need no escalation timers (FR-SET-8). */
  isDrill?: boolean;
}

export function scaleSeconds(seconds: number, timeScale = 1): number {
  const scale = timeScale > 0 ? timeScale : 1;
  return Math.max(1, Math.round(seconds * scale));
}

function at(from: Date, seconds: number, timeScale: number): Date {
  return new Date(from.getTime() + scaleSeconds(seconds, timeScale) * 1000);
}

/**
 * The timers to arm when an incident opens.
 *
 * P1 has already told 112 at dispatch time, so it gets no `escalate112` timer.
 * P3 never escalates automatically at all (section 8.2).
 */
export function scheduleForNewIncident(opts: ScheduleOptions): ScheduledTimer[] {
  const scale = opts.timeScale ?? 1;
  const timers: ScheduledTimer[] = [];

  if (opts.isDrill) return timers;

  if (opts.severity === 'unverified') {
    // Guard desk only: no volunteer upgrade, but a human must still look.
    timers.push({ kind: 'familyVoiceCall', fireAt: at(opts.openedAt, TIMERS_S.familyVoiceCall, scale) });
    return timers;
  }

  timers.push({ kind: 'upgradeAll', fireAt: at(opts.openedAt, TIMERS_S.upgradeAll, scale) });
  timers.push({ kind: 'familyVoiceCall', fireAt: at(opts.openedAt, TIMERS_S.familyVoiceCall, scale) });

  if (opts.severity === 'P2') {
    timers.push({ kind: 'escalate112', fireAt: at(opts.openedAt, TIMERS_S.escalate112, scale) });
  }

  return timers;
}

/** Armed when a responder accepts: are they actually moving closer? */
export function scheduleOnAccept(acceptedAt: Date, timeScale = 1): ScheduledTimer[] {
  return [{ kind: 'stillComing', fireAt: at(acceptedAt, TIMERS_S.stillComing, timeScale) }];
}

export function scheduleOnArrival(arrivedAt: Date, timeScale = 1): ScheduledTimer[] {
  return [{ kind: 'onSceneCheckin', fireAt: at(arrivedAt, TIMERS_S.onSceneCheckin, timeScale) }];
}

/**
 * Armed when a cancel is requested: one retry, then a hard deadline so a
 * verification can never hang and silently hold help back (section 6.2).
 */
export function scheduleOnCancelRequest(requestedAt: Date, timeScale = 1): ScheduledTimer[] {
  return [
    { kind: 'verificationRetry', fireAt: at(requestedAt, TIMERS_S.verificationRetry, timeScale) },
    { kind: 'verificationDeadline', fireAt: at(requestedAt, TIMERS_S.verificationDeadline, timeScale) },
  ];
}

/** Timers that must be cancelled when an incident resolves. */
export const ALL_TIMER_KINDS: TimerKind[] = Object.keys(TIMERS_S) as TimerKind[];

/** True when a scaled incident should be labelled "demo speed" in every UI. */
export function isDemoSpeed(timeScale: number): boolean {
  return timeScale !== 1;
}
