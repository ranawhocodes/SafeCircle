/**
 * Volunteer and incident-response routes (Face B).
 *
 * The briefing route is the enforcement point for staged disclosure: it has no
 * "include everything" parameter, so a client bug cannot leak an address.
 */
import type { FastifyInstance } from 'fastify';
import {
  DisclosureDeniedError,
  buildFlashcardSet,
  findForbiddenKeys,
  type AvailabilityMode,
  type DeclineReason,
  type NormalisedEvent,
  type RawLocationReport,
  TUTORIAL_MODULES,
  QUIZ_QUESTIONS,
  gradeQuiz,
} from '@safecircle/shared';
import { pool } from '../db/pool.js';
import { servableCards, findCard } from '../db/repositories/cards.js';
import {
  findIncident,
  findActiveIncidentForVolunteer,
  appendEvent,
  insertDispatch,
} from '../db/repositories/incidents.js';
import { findIncidentHistory, findPerson } from '../db/repositories/people.js';
import {
  badgeFor,
  completeTutorial,
  ensurePersonForVolunteer,
  findVolunteer,
  getTutorialProgress,
  saveModuleProgress,
  createVoteRound,
  findOpenVoteRoundsForVoter,
  castRoundVote,
  primarySkillLabel,
  setAvailability,
  updateZone,
} from '../db/repositories/volunteers.js';
import { ingest, runDispatchPhase } from '../domain/engine.js';
import {
  alertsFor,
  briefing,
  recordResponderFix,
  recordStatus,
  respond,
  selectCard,
  type StatusTap,
} from '../domain/responder.js';
import { requireSession } from '../security/auth.js';

export async function volunteerRoutes(app: FastifyInstance): Promise<void> {
  /** FR-VOL-2: the availability toggle and its modes. */
  app.post<{ Body: { mode: AvailabilityMode; until?: string } }>(
    '/api/volunteer/availability',
    async (req, reply) => {
      const session = await requireSession(req, reply, ['volunteer', 'guard']);
      if (!session) return;

      const until = req.body.until ? new Date(req.body.until) : null;
      const result = await setAvailability(session.subjectId, req.body.mode, until);

      if (result === 'tutorial_required') {
        return reply.code(403).send({
          error: {
            code: 'tutorial_required',
            message: 'Finish the tutorial and the practice alert before going available.',
          },
        });
      }
      if (result === 'suspended') {
        return reply
          .code(403)
          .send({ error: { code: 'suspended', message: 'This account is suspended.' } });
      }
      if (result === 'not_found') {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
      }
      return reply.send({ ok: true, mode: req.body.mode, until });
    },
  );

  /**
   * A zone update between incidents, or a precise fix during one.
   *
   * Without an incident id only the coarse ~1 km cell is stored and no history
   * is kept (section 11.4).
   */
  app.post<{
    Body: { lat: number; lng: number; accuracy_m?: number; incident_id?: string };
  }>('/api/volunteer/location', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    const { lat, lng } = req.body;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply
        .code(400)
        .send({ error: { code: 'bad_location', message: 'lat and lng are required.' } });
    }

    if (req.body.incident_id) {
      const result = await recordResponderFix(
        req.body.incident_id,
        session.subjectId,
        lat,
        lng,
        req.body.accuracy_m ?? 25,
      );
      return reply.send({
        ok: true,
        stored: 'incident_fix',
        distance_m: result.distanceM === null ? null : Math.round(result.distanceM),
        suggest_arrived: result.suggestArrived,
      });
    }

    await updateZone(session.subjectId, lat, lng);
    return reply.send({
      ok: true,
      stored: 'coarse_zone',
      note: 'Only a ~1 km cell is kept between incidents. No movement history is stored.',
    });
  });

  /** Open alerts for me - pre-accept view only (FR-VOL-1), plus active accepted incident. */
  app.get('/api/volunteer/alerts', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    const alerts = await alertsFor(session.subjectId);
    const activeIncidentId = await findActiveIncidentForVolunteer(session.subjectId);

    // Defence in depth: assert the payload really is free of identifying keys.
    const leaked = findForbiddenKeys(alerts);
    if (leaked.length > 0) {
      req.log.error({ leaked }, 'pre-accept payload contained forbidden keys');
      return reply.code(500).send({
        error: { code: 'disclosure_guard_tripped', message: 'Refused to send this payload.' },
      });
    }
    return reply.send({ alerts, activeIncidentId });
  });

  app.get('/api/volunteer/me', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    const v = await findVolunteer(session.subjectId);
    if (!v) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });

    return reply.send({
      id: v.id,
      name: v.name,
      trustLevel: v.trustLevel,
      badge: badgeFor(v.trustLevel),
      skill: primarySkillLabel(v.skills),
      skills: v.skills,
      availabilityMode: v.availabilityMode,
      availableUntil: v.availableUntil,
      tutorialComplete: v.tutorialCompletedAt !== null,
      // Tier 1 is only for verified volunteers (FR-VOL-6).
      eligibleForTier1: v.trustLevel >= 2,
    });
  });

  /** FR-VOL-8: the mandatory tutorial gate. */
  app.post('/api/volunteer/tutorial/complete', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;
    await completeTutorial(session.subjectId);
    return reply.send({ ok: true, tutorialComplete: true });
  });

  /** F28: Tutorial modules status and progress. */
  app.get('/api/volunteer/tutorial/status', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    const progress = await getTutorialProgress(session.subjectId);
    return reply.send({
      modules: TUTORIAL_MODULES,
      quizQuestions: QUIZ_QUESTIONS.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
      })),
      progress,
    });
  });

  /** F28: Complete an individual tutorial module or submit quiz. */
  app.post<{
    Params: { moduleId: string };
    Body: { answers?: Record<string, number> };
  }>('/api/volunteer/tutorial/module/:moduleId', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    const { moduleId } = req.params;
    if (moduleId === 'm5_quiz') {
      const answers = req.body?.answers ?? {};
      const graded = gradeQuiz(answers);
      if (!graded.passed) {
        return reply.code(400).send({
          ok: false,
          score: graded.score,
          correctCount: graded.correctCount,
          total: graded.total,
          passed: false,
          message: `Quiz score was ${graded.score}%. An 80% passing grade is required to qualify.`,
        });
      }
      const progress = await saveModuleProgress(session.subjectId, moduleId, graded.score);
      return reply.send({
        ok: true,
        score: graded.score,
        passed: true,
        allDone: progress.allDone,
      });
    }

    const progress = await saveModuleProgress(session.subjectId, moduleId, 100);
    return reply.send({ ok: true, allDone: progress.allDone });
  });

  /** F28: Trigger a practice alert drill for this volunteer. */
  app.post('/api/volunteer/tutorial/practice-alert', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    const volunteer = await findVolunteer(session.subjectId);
    if (!volunteer) return reply.code(404).send({ error: { code: 'not_found' } });

    const personId = await ensurePersonForVolunteer(volunteer);
    const incidentId = `drill-${session.subjectId.slice(0, 8)}-${Date.now()}`;
    const at = new Date();

    await pool.query(
      `INSERT INTO incidents (id, person_id, society_id, source, severity, case_type, state, flags, opened_at)
       VALUES ($1, $2, $3, 'volunteer_practice', 'P2', 'fall', 'dispatching', $4, $5)`,
      [
        incidentId,
        personId,
        volunteer.societyId,
        JSON.stringify({ drill: true, practice: true, practiceVolunteerId: session.subjectId }),
        at,
      ],
    );

    // Tier 1 direct dispatch
    await insertDispatch(incidentId, session.subjectId, 1, 100, { practice: true });

    return reply.send({ ok: true, incidentId });
  });

  /** F26: Get open community voting rounds for this volunteer. */
  app.get('/api/volunteer/voting/rounds', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    const rounds = await findOpenVoteRoundsForVoter(session.subjectId);
    return reply.send({ rounds });
  });

  /** F26: Cast a vouch or concern on a candidate volunteer. */
  app.post<{
    Params: { roundId: string };
    Body: { choice: 'vouch' | 'concern' | 'abstain'; reason?: string };
  }>('/api/volunteer/voting/rounds/:roundId/vote', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    const choice = req.body?.choice;
    if (!choice || !['vouch', 'concern', 'abstain'].includes(choice)) {
      return reply.code(400).send({ error: { code: 'invalid_choice', message: 'Choice must be vouch, concern, or abstain.' } });
    }

    try {
      const result = await castRoundVote(req.params.roundId, session.subjectId, choice);
      return reply.send({ ok: true, status: result.status, reason: result.outcomeReason });
    } catch (err) {
      return reply.code(400).send({ error: { code: 'vote_failed', message: (err as Error).message } });
    }
  });

  /** F26: Request community verification (opens a vote round). */
  app.post('/api/volunteer/voting/request', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    const volunteer = await findVolunteer(session.subjectId);
    if (!volunteer) return reply.code(404).send({ error: { code: 'not_found' } });

    const societyId = volunteer.societyId ?? 'soc_shanti_niketan';
    const roundId = await createVoteRound(session.subjectId, societyId, 7);
    return reply.send({ ok: true, roundId });
  });

  /** Accept or decline (FR-ALT-4). A decline must carry a reason. */
  app.post<{
    Params: { id: string };
    Body: { response: 'accepted' | 'declined'; reason?: DeclineReason };
  }>('/api/incidents/:id/respond', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard']);
    if (!session) return;

    if (req.body.response === 'declined' && !req.body.reason) {
      return reply.code(400).send({
        error: {
          code: 'reason_required',
          message: 'Tell us why, so dispatch can learn: too far, busy, not safe or not trained.',
        },
      });
    }

    const result = await respond(
      req.params.id,
      session.subjectId,
      req.body.response,
      req.body.reason ?? null,
    );

    if (!result.ok) {
      const status = result.reason === 'not_alerted' ? 403 : 409;
      return reply.code(status).send({ error: { code: result.reason, message: messageFor(result.reason) } });
    }
    return reply.send(result);
  });

  /** The briefing. 403 before accepting - and the data is never assembled. */
  app.get<{ Params: { id: string } }>('/api/incidents/:id/briefing', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard', 'dashboard']);
    if (!session) return;

    try {
      const view = await briefing(req.params.id, {
        type: session.subjectType === 'guard' ? 'guard' : session.subjectType === 'dashboard' ? 'dashboard' : 'volunteer',
        id: session.subjectId,
        // A guard's duty state is checked here, not taken from the client.
        isOnDutyForSociety: session.subjectType === 'guard' ? await isGuardOnDuty(session.subjectId) : false,
      });
      return reply.send(view);
    } catch (err) {
      if (err instanceof DisclosureDeniedError) {
        return reply.code(403).send({
          error: { code: 'briefing_not_authorised', message: 'Accept the alert first.' },
        });
      }
      throw err;
    }
  });

  /** FR-BRF-5: the three likely situations, plus CPR always on screen. */
  app.get<{ Params: { id: string } }>('/api/incidents/:id/flashcards', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard', 'dashboard']);
    if (!session) return;

    const incident = await findIncident(req.params.id);
    if (!incident?.personId) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    }

    // The cards reveal conditions, so they need the same gate as the briefing.
    try {
      await briefing(req.params.id, {
        type: session.subjectType === 'guard' ? 'guard' : session.subjectType === 'dashboard' ? 'dashboard' : 'volunteer',
        id: session.subjectId,
        isOnDutyForSociety: session.subjectType === 'guard' ? await isGuardOnDuty(session.subjectId) : false,
      });
    } catch (err) {
      if (err instanceof DisclosureDeniedError) {
        return reply.code(403).send({
          error: { code: 'briefing_not_authorised', message: 'Accept the alert first.' },
        });
      }
      throw err;
    }

    const person = await findPerson(incident.personId);
    if (!person) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });

    const contextText =
      (incident.flags?.checkInAnswer as string | undefined) ||
      (incident.flags?.caregiverReport as string | undefined) ||
      null;

    const set = buildFlashcardSet(await servableCards(), {
      person,
      caseType: incident.caseType,
      history: await findIncidentHistory(person.id),
      contextText,
      localHour: new Date().getHours(),
    });

    return reply.send({
      ...set,
      disclaimer: 'First-aid guidance, not a diagnosis.',
    });
  });

  app.get<{ Params: { key: string } }>('/api/cards/:key', async (req, reply) => {
    const session = await requireSession(req, reply, ['volunteer', 'guard', 'dashboard']);
    if (!session) return;
    const card = await findCard(req.params.key);
    if (!card) {
      return reply.code(404).send({
        error: {
          code: 'card_unavailable',
          message: 'That card does not exist or has not been reviewed by a doctor.',
        },
      });
    }
    return reply.send({ ...card, disclaimer: 'First-aid guidance, not a diagnosis.' });
  });

  /** FR-BRF-6: the tap becomes the incident's volunteer-observed type. */
  app.post<{ Params: { id: string }; Body: { card_key: string } }>(
    '/api/incidents/:id/card-selection',
    async (req, reply) => {
      const session = await requireSession(req, reply, ['volunteer', 'guard']);
      if (!session) return;

      const result = await selectCard(req.params.id, session.subjectId, req.body.card_key);
      if (!result.ok) {
        return reply
          .code(403)
          .send({ error: { code: result.reason!, message: messageFor(result.reason!) } });
      }
      return reply.send({ ok: true, observedType: result.wording });
    },
  );

  /** FR-VOL-3: the status taps. */
  app.post<{ Params: { id: string }; Body: { status: StatusTap; note?: string } }>(
    '/api/incidents/:id/status',
    async (req, reply) => {
      const session = await requireSession(req, reply, ['volunteer', 'guard']);
      if (!session) return;

      const result = await recordStatus(
        req.params.id,
        session.subjectId,
        req.body.status,
        req.body.note,
      );
      if (!result.ok) {
        return reply
          .code(403)
          .send({ error: { code: result.reason!, message: messageFor(result.reason!) } });
      }

      if (req.body.status === 'resolved') {
        const inc = await findIncident(req.params.id);
        if (inc?.flags.practice) {
          await saveModuleProgress(session.subjectId, 'm6_drill', 100);
        }
      }
      return reply.send(result);
    },
  );

  /**
   * F23: "I'm in danger" — volunteer's own SOS on scene or during duty.
   * Forces P1 severity, notifies guard and 112, links to active incident if any.
   */
  app.post<{ Body: { incidentId?: string; lat?: number; lng?: number } }>(
    '/api/volunteer/danger',
    async (req, reply) => {
      const session = await requireSession(req, reply, ['volunteer', 'guard']);
      if (!session) return;

      const volunteer = await findVolunteer(session.subjectId);
      if (!volunteer) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Volunteer not found.' } });
      }

      const personId = await ensurePersonForVolunteer(volunteer);
      const at = new Date();
      const location: RawLocationReport | undefined =
        req.body?.lat && req.body?.lng
          ? { gps: { lat: req.body.lat, lng: req.body.lng, acc_m: 10, age_s: 0 } }
          : undefined;

      const event: NormalisedEvent = {
        source: 'volunteer_app',
        sender: personId,
        type: 'panic',
        at,
        location,
        text: `Volunteer ${volunteer.name} reported danger on scene.`,
      };

      const outcome = await ingest(event);

      const activeIncId = req.body?.incidentId ?? (await findActiveIncidentForVolunteer(session.subjectId));
      if (activeIncId) {
        await appendEvent(activeIncId, 'volunteer_in_danger', 'volunteer', session.subjectId, {
          volunteerId: session.subjectId,
          volunteerName: volunteer.name,
          dangerIncidentId: outcome.incident.id,
        });
      }

      if (!outcome.merged) {
        void runDispatchPhase(outcome.incident, outcome.person, event);
      }

      return reply.code(201).send({
        ok: true,
        incidentId: outcome.incident.id,
        severity: outcome.severity,
      });
    },
  );
}

async function isGuardOnDuty(guardId: string): Promise<boolean> {
  const { one } = await import('../db/pool.js');
  const row = await one<{ on_duty: boolean }>('SELECT on_duty FROM guards WHERE id = $1', [guardId]);
  return row?.on_duty === true;
}

function messageFor(code: string): string {
  switch (code) {
    case 'not_alerted':
      return 'You were not alerted to this incident.';
    case 'already_responded':
      return 'You have already responded.';
    case 'incident_closed':
      return 'This incident is closed.';
    case 'not_accepting':
      return 'A cancel is being verified, so no new responders are being added right now.';
    case 'not_an_accepted_responder':
      return 'Accept the alert first.';
    case 'card_not_found_or_unreviewed':
      return 'That card does not exist or has not been reviewed by a doctor.';
    default:
      return 'Request refused.';
  }
}
