/**
 * Messaging webhooks (FR-TRG-5/6/7).
 *
 * The important rule here is the one from section 16.4 #15: a HELP from an
 * unregistered number creates an `unverified` incident that reaches the guard
 * desk and the dashboard ONLY. Sending a stranger's location to volunteers is a
 * documented way to lure someone, so it never happens automatically.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { NormalisedEvent } from '@safecircle/shared';
import { findDependentsForNumber, findPersonBySenderNumber } from '../db/repositories/people.js';
import { findOpenIncidentForPerson } from '../db/repositories/incidents.js';
import { ingest, runDispatchPhase } from '../domain/engine.js';
import { requestCancel } from '../domain/cancel.js';
import { applyVerificationOutcome } from '../domain/cancel.js';
import { providers } from '../providers/index.js';
import { verifyWebhook } from '../security/webhook.js';

interface InboundMessage {
  from: string;
  text: string;
  /** Provider message id, for idempotency. */
  id?: string;
}

const HELP_WORDS = ['help', 'sos', 'madad', 'udhavi', 'உதவி', 'मदद'];
const CANCEL_WORDS = ['cancel', 'stop', 'ok', 'safe'];
const SAFE_WORDS = ['safe', 'fine', 'ok'];

function isHelp(text: string): boolean {
  const t = text.trim().toLowerCase();
  // Any message from a registered number counts as a call for help (section 4,
  // T2), so this only decides the *wording* of the reply, not whether to act.
  return HELP_WORDS.some((w) => t.includes(w)) || t.length > 0;
}

function namedDependent(text: string, names: string[]): string | null {
  const t = text.trim().toLowerCase();
  for (const n of names) {
    if (t.includes(n.toLowerCase().split(' ')[0]!)) return n;
  }
  return null;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: InboundMessage }>('/webhooks/whatsapp', async (req, reply) => {
    if (!verifyWebhook('whatsapp', req.headers, req.body)) {
      return reply.code(401).send({ error: { code: 'bad_signature', message: 'Rejected.' } });
    }
    return handleInbound(req.body, 'whatsapp', reply);
  });

  app.post<{ Body: InboundMessage }>('/webhooks/sms', async (req, reply) => {
    if (!verifyWebhook('sms', req.headers, req.body)) {
      return reply.code(401).send({ error: { code: 'bad_signature', message: 'Rejected.' } });
    }
    return handleInbound(req.body, 'sms', reply);
  });

  /**
   * The provider's DTMF result for a verification call. In this build the
   * dashboard drives the same path; this route is what a real Exotel flow posts
   * to.
   */
  app.post<{ Body: { incident_id: string; digits?: string; status?: string } }>(
    '/webhooks/voice',
    async (req, reply) => {
      if (!verifyWebhook('voice', req.headers, req.body)) {
        return reply.code(401).send({ error: { code: 'bad_signature', message: 'Rejected.' } });
      }

      const { incident_id, digits, status } = req.body;
      const outcome =
        status === 'no-answer' || status === 'busy' || status === 'failed'
          ? 'no_answer'
          : digits === '1'
            ? 'safe'
            : digits === '9'
              ? 'need_help'
              : 'no_answer';

      const result = await applyVerificationOutcome(incident_id, outcome, { simulated: false });
      return reply.send({ ok: result.ok });
    },
  );
}

async function handleInbound(
  message: InboundMessage,
  channel: 'whatsapp' | 'sms',
  reply: FastifyReply,
): Promise<unknown> {
  const from = message.from?.trim();
  const text = (message.text ?? '').trim();
  if (!from) {
    return reply.code(400).send({ error: { code: 'bad_request', message: 'Missing sender.' } });
  }

  const match = await findPersonBySenderNumber(from);

  // --- unregistered sender ------------------------------------------------
  if (!match) {
    const event: NormalisedEvent = {
      source: channel,
      sender: from,
      type: 'panic',
      at: new Date(),
      text,
    };
    const outcome = await ingest(event);
    void runDispatchPhase(outcome.incident, outcome.person, event);

    await providers.messaging.send({
      incidentId: outcome.incident.id,
      to: from,
      template: 'unverified_ack',
      channel,
      params: {
        prompt:
          'We have alerted the local security desk. Please reply with your location and one line about what is happening. If this is an emergency, call 112 now.',
      },
    });

    return reply.send({
      ok: true,
      incident_id: outcome.incident.id,
      severity: 'unverified',
      routed_to: 'guard_desk_and_dashboard_only',
      note: 'An unregistered number never reaches volunteers automatically.',
    });
  }

  // --- CANCEL from someone allowed to cancel -----------------------------
  const lower = text.toLowerCase();
  if (CANCEL_WORDS.some((w) => lower === w || lower.startsWith(`${w} `))) {
    const open = await findOpenIncidentForPerson(match.person.id);
    if (open) {
      if (!match.canCancel) {
        await providers.messaging.send({
          incidentId: open.id,
          to: from,
          template: 'cancel_not_permitted',
          channel,
          params: { prompt: 'This number is not allowed to cancel alerts.' },
        });
        return reply.send({ ok: false, reason: 'not_permitted_to_cancel' });
      }

      // A SAFE reply is the deaf/speech-impaired confirmation route (section 6.3).
      if (open.state === 'cancel_verifying' && SAFE_WORDS.includes(lower)) {
        const result = await applyVerificationOutcome(open.id, 'safe');
        return reply.send({ ok: result.ok, verified: 'safe' });
      }

      const result = await requestCancel(open.id, {
        type: match.role === 'self' ? 'person' : 'caregiver',
        id: from,
      });
      await providers.messaging.send({
        incidentId: open.id,
        to: from,
        template: 'cancel_verifying',
        channel,
        params: {
          prompt:
            'We are checking that everything is all right. Help has not been stopped until we hear back.',
        },
      });
      return reply.send({ ok: result.ok, state: 'cancel_verifying' });
    }
  }

  if (!isHelp(text)) {
    return reply.send({ ok: true, ignored: true });
  }

  // --- a caregiver with several dependents --------------------------------
  let onBehalfOf: string | undefined;
  if (match.role === 'caregiver') {
    const dependents = await findDependentsForNumber(from);
    if (dependents.length > 1) {
      const named = namedDependent(text, dependents.map((d) => d.name));
      const chosen = named ? dependents.find((d) => d.name === named) : null;
      if (!chosen) {
        await providers.messaging.send({
          to: from,
          template: 'which_dependent',
          channel,
          params: {
            prompt: `Who needs help? Reply HELP and the name: ${dependents
              .map((d) => d.name.split(' ')[0])
              .join(', ')}.`,
          },
        });
        return reply.send({ ok: true, awaiting: 'dependent_name' });
      }
      onBehalfOf = chosen.id;
    } else {
      onBehalfOf = dependents[0]?.id ?? match.person.id;
    }
  }

  const event: NormalisedEvent = {
    source: match.role === 'caregiver' ? 'caregiver_link' : channel,
    sender: from,
    type: 'panic',
    at: new Date(),
    text,
    onBehalfOfPersonId: onBehalfOf,
  };

  const outcome = await ingest(event);
  if (!outcome.merged) {
    void runDispatchPhase(outcome.incident, outcome.person, event);
  }

  // A reply inside the 24-hour customer-service window is free (section 4, T2).
  await providers.messaging.send({
    incidentId: outcome.incident.id,
    to: from,
    template: 'help_received',
    channel,
    params: {
      person: outcome.person?.name ?? null,
      prompt:
        'We have your call for help. Nearby verified helpers, the security desk and your family have been alerted. Reply CANCEL if this was a mistake.',
    },
  });

  return reply.send({
    ok: true,
    incident_id: outcome.incident.id,
    merged: outcome.merged,
    severity: outcome.severity,
    raised_for: outcome.person?.name ?? null,
    location_source: outcome.location?.source ?? null,
  });
}
