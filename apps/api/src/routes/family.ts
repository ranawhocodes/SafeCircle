/**
 * The family status page (FR-FAM-1..4).
 *
 * Reached by a capability token in the URL - no app, no sign-in. The payload
 * carries the PERSON's location but never a volunteer's position, and a contact
 * on the `never_inform` list never receives the link in the first place.
 */
import type { FastifyInstance } from 'fastify';
import { describeAccuracy, isDemoSpeed, type FamilyStatusView } from '@safecircle/shared';
import {
  appendEvent,
  findIncidentByFamilyToken,
  listEvents,
  markFamilyOpened,
} from '../db/repositories/incidents.js';
import { findPerson } from '../db/repositories/people.js';
import { badgeFor, findVolunteer, primarySkillLabel, latestFix } from '../db/repositories/volunteers.js';
import { currentLocation } from '../services/location.js';
import { respondersFor } from '../domain/responder.js';
import { requestCancel } from '../domain/cancel.js';
import { haversineM } from '@safecircle/shared';

/** Event kinds a family should see, with plain-language wording. */
const TIMELINE_WORDING: Record<string, string> = {
  opened: 'Alert received',
  located: 'Location found',
  dispatched: 'Nearby helpers alerted',
  upgraded_all: 'Alert raised to urgent for everyone nearby',
  accepted: 'A helper accepted',
  status_on_my_way: 'Helper is on the way',
  status_arrived: 'Helper has arrived',
  status_handed_to_ambulance: 'Handed over to the ambulance',
  escalated_112: 'Police or ambulance have also been told',
  cancel_requested: 'A cancel was requested - we are checking',
  verification_failed: 'We could not confirm safety, so help is still coming',
  verified_safe: 'Confirmed safe',
  card_selected: 'Helper reported what they found',
  covered: 'Enough helpers are on the way',
  family_called: 'We called the family',
  reopened: 'Looking for another helper',
};

export async function familyRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>('/api/family/:token/status', async (req, reply) => {
    const incident = await findIncidentByFamilyToken(req.params.token);
    if (!incident) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Link not recognised.' } });
    }

    // Opening the page stops the 60 s "nobody has seen this" call.
    await markFamilyOpened(incident.id);

    const person = incident.personId ? await findPerson(incident.personId) : null;
    const location = await currentLocation(incident.id);

    const responders: FamilyStatusView['responders'] = [];
    for (const r of await respondersFor(incident.id)) {
      const v = await findVolunteer(r.volunteerId);
      if (!v) continue;
      // ETA only - never the volunteer's position (FR-FAM-2).
      const fix = await latestFix(r.volunteerId, incident.id);
      let etaS: number | null = null;
      if (fix && location) {
        const d = haversineM(fix.lat, fix.lng, location.lat, location.lng);
        etaS = Math.round(d / 1.4);
      }
      responders.push({
        name: v.name,
        badge: badgeFor(v.trustLevel),
        skill: primarySkillLabel(v.skills),
        etaS,
        status: incident.state,
      });
    }

    const timeline = (await listEvents(incident.id))
      .filter((e) => TIMELINE_WORDING[e.kind] !== undefined)
      .map((e) => ({ at: e.at, text: TIMELINE_WORDING[e.kind]! }));

    const view = {
      incidentId: incident.id,
      state: incident.state,
      severity: incident.severity,
      isDrill: incident.flags.drill === true,
      demoSpeed: isDemoSpeed(incident.demoTimeScale),
      personName: person?.name ?? null,
      personLocation: location,
      locationDescription: location ? describeAccuracy(location) : null,
      responders,
      escalatedTo112: incident.escalatedAt !== null,
      // NFR-14: the family is told plainly that the 112 handoff is simulated.
      escalationSimulated: true,
      volunteerObservedType: incident.volunteerObservedType,
      timeline,
      outcome: incident.outcome,
      notice: 'SafeCircle adds to 112. It does not replace it, and it cannot promise a volunteer will come.',
    };

    return reply.send(view);
  });

  /** "I'm on my way" - the family joins the responder list. */
  app.post<{ Params: { token: string }; Body: { name?: string } }>(
    '/api/family/:token/on-my-way',
    async (req, reply) => {
      const incident = await findIncidentByFamilyToken(req.params.token);
      if (!incident) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Link not recognised.' } });
      }
      await appendEvent(incident.id, 'family_on_the_way', 'family', null, {
        name: req.body?.name ?? null,
      });
      return reply.send({ ok: true });
    },
  );

  /**
   * "This is a false alarm" (FR-FAM-3).
   *
   * It runs the verification flow. It does NOT cancel: a family member cannot
   * close an incident on the person's behalf, which matters most in exactly the
   * cases where a family member is the problem.
   */
  app.post<{ Params: { token: string } }>('/api/family/:token/false-alarm', async (req, reply) => {
    const incident = await findIncidentByFamilyToken(req.params.token);
    if (!incident) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Link not recognised.' } });
    }

    const result = await requestCancel(incident.id, { type: 'family', id: req.params.token });
    if (!result.ok) {
      return reply.code(409).send({
        error: { code: result.reason, message: 'That could not be done right now.' },
      });
    }
    return reply.send({
      ok: true,
      state: result.state,
      requiresGuardCheck: result.requiresGuardCheck,
      note: 'We are checking that the person is safe. Help has not been stopped.',
    });
  });

  /** Share the medical summary with a hospital (FR-FAM-3). */
  app.post<{ Params: { token: string }; Body: { hospital?: string } }>(
    '/api/family/:token/share-medical-summary',
    async (req, reply) => {
      const incident = await findIncidentByFamilyToken(req.params.token);
      if (!incident?.personId) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Link not recognised.' } });
      }
      const person = await findPerson(incident.personId);
      if (!person) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
      }

      await appendEvent(incident.id, 'medical_summary_shared', 'family', null, {
        hospital: req.body?.hospital ?? null,
      });

      return reply.send({
        ok: true,
        summary: {
          name: person.name,
          ageBand: person.ageBand,
          conditions: person.health?.conditions ?? [],
          medicines: person.health?.medicines ?? [],
          allergies: person.health?.allergies ?? [],
          bloodGroup: person.health?.bloodGroup ?? null,
          doctor: person.health?.doctor ?? null,
        },
      });
    },
  );
}
