/**
 * The caregiver setup portal (FR-SET-1..9).
 *
 * The person in need never touches this. A caregiver signs in with a phone
 * number and a one-time code, records the profile, claims the device, and runs a
 * drill that exercises the whole chain without alerting a single volunteer.
 */
import type { FastifyInstance } from 'fastify';
import { allPatternsFor, type FeedbackProfile, type NormalisedEvent } from '@safecircle/shared';
import { one, pool, query } from '../db/pool.js';
import { claimDevice, devicesForPerson, staleDevices } from '../db/repositories/devices.js';
import {
  findFamilyContacts,
  findPerson,
  setAccessSecrets,
  updateHealthAndHandling,
} from '../db/repositories/people.js';
import { listRecentIncidents } from '../db/repositories/incidents.js';
import { ingest, runDispatchPhase } from '../domain/engine.js';
import { consumeOtp, createSession, issueOtp, requireSession } from '../security/auth.js';
import { config } from '../config.js';
import { newId } from '../security/crypto.js';

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  // --- sign in ------------------------------------------------------------
  app.post<{ Body: { phone: string; role?: 'caregiver' | 'volunteer' | 'guard' | 'dashboard' } }>(
    '/api/auth/otp/request',
    async (req, reply) => {
      const phone = req.body?.phone?.trim();
      if (!phone) {
        return reply.code(400).send({ error: { code: 'bad_request', message: 'Phone required.' } });
      }
      const role = req.body.role ?? 'caregiver';
      const code = await issueOtp(phone, role);

      // In a real deployment the code is sent by SMS. In this build it is
      // returned outside production so a demo needs no telephony account - and
      // the response says so plainly.
      return reply.send({
        ok: true,
        ...(config.isProduction
          ? {}
          : { code, notice: 'SIMULATED: no SMS was sent. This code is returned for the demo only.' }),
      });
    },
  );

  app.post<{
    Body: { phone: string; code: string; role?: 'caregiver' | 'volunteer' | 'guard' | 'dashboard' };
  }>('/api/auth/otp/verify', async (req, reply) => {
    const { phone, code } = req.body ?? {};
    const role = req.body?.role ?? 'caregiver';
    if (!phone || !code) {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Phone and code required.' } });
    }
    if (!(await consumeOtp(phone, role, code))) {
      return reply.code(401).send({ error: { code: 'bad_code', message: 'That code is not valid.' } });
    }

    const subjectId = await resolveSubject(role, phone);
    if (!subjectId) {
      return reply
        .code(404)
        .send({ error: { code: 'not_registered', message: 'This number is not registered.' } });
    }
    const token = await createSession(role, subjectId);
    return reply.send({ ok: true, token, subjectType: role, subjectId });
  });

  // --- people -------------------------------------------------------------
  app.get('/api/portal/people', async (req, reply) => {
    const session = await requireSession(req, reply, ['caregiver']);
    if (!session) return;

    const rows = await query<{ person_id: string }>(
      'SELECT person_id FROM caregiver_links WHERE caregiver_id = $1',
      [session.subjectId],
    );

    const people = [];
    for (const r of rows) {
      const p = await findPerson(r.person_id);
      if (!p) continue;
      const devices = await devicesForPerson(p.id);
      const contacts = await findFamilyContacts(p.id);
      people.push({
        id: p.id,
        name: p.name,
        ageBand: p.ageBand,
        feedbackProfile: p.feedbackProfile,
        protected: p.protected,
        devices: devices.map((d) => ({ deviceId: d.deviceId, type: d.type })),
        familyContacts: contacts.length,
        // FR-SET: a completeness score nudges a caregiver to finish the profile.
        completeness: completenessFor(p, devices.length, contacts.length),
      });
    }
    return reply.send({ people });
  });

  app.get<{ Params: { id: string } }>('/api/portal/people/:id', async (req, reply) => {
    const session = await requireSession(req, reply, ['caregiver']);
    if (!session) return;
    if (!(await caregiverManages(session.subjectId, req.params.id))) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not your person.' } });
    }

    const person = await findPerson(req.params.id);
    if (!person) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });

    const devices = await devicesForPerson(person.id);
    const health = await deviceHealth(devices.map((d) => d.deviceId));
    return reply.send({
      person,
      devices,
      deviceHealth: health,
      familyContacts: await findFamilyContacts(person.id),
      incidents: (await listRecentIncidents(100))
        .filter((i) => i.personId === person.id)
        .map((i) => ({
          id: i.id,
          openedAt: i.openedAt,
          severity: i.severity,
          state: i.state,
          outcome: i.outcome,
          isDrill: i.flags.drill === true,
        })),
    });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      feedback_profile?: FeedbackProfile;
      pre_send_countdown_s?: number;
      health?: Record<string, unknown>;
      handling?: Record<string, unknown>;
      access_secrets?: { gateCode?: string; doorCode?: string; spareKeyHolder?: string };
      responder_preference?: 'woman_first' | null;
    };
  }>('/api/portal/people/:id', async (req, reply) => {
    const session = await requireSession(req, reply, ['caregiver']);
    if (!session) return;
    if (!(await caregiverManages(session.subjectId, req.params.id))) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not your person.' } });
    }

    const b = req.body ?? {};
    if (b.feedback_profile) {
      await pool.query('UPDATE people SET feedback_profile = $2 WHERE id = $1', [
        req.params.id,
        b.feedback_profile,
      ]);
      // Stealth and discreet profiles are treated as protected, because a
      // responder for them must be verified (FR-ALT-7).
      if (b.feedback_profile === 'stealth' || b.feedback_profile === 'discreet') {
        await pool.query('UPDATE people SET protected = true WHERE id = $1', [req.params.id]);
      }
    }
    if (b.pre_send_countdown_s !== undefined) {
      const n = Math.max(0, Math.min(5, b.pre_send_countdown_s));
      await pool.query('UPDATE people SET pre_send_countdown_s = $2 WHERE id = $1', [req.params.id, n]);
    }
    if (b.responder_preference !== undefined) {
      await pool.query('UPDATE people SET responder_preference = $2 WHERE id = $1', [
        req.params.id,
        b.responder_preference,
      ]);
    }
    if (b.health !== undefined || b.handling !== undefined) {
      const current = await findPerson(req.params.id);
      await updateHealthAndHandling(
        req.params.id,
        (b.health ?? current?.health ?? null) as never,
        (b.handling ?? current?.handling ?? null) as never,
      );
    }
    if (b.access_secrets) {
      await setAccessSecrets(req.params.id, b.access_secrets);
    }

    return reply.send({ ok: true, person: await findPerson(req.params.id) });
  });

  /** FR-SET-3: claim a device with a single-use code. */
  app.post<{ Params: { id: string }; Body: { device_id: string; claim_code: string } }>(
    '/api/portal/people/:id/devices/claim',
    async (req, reply) => {
      const session = await requireSession(req, reply, ['caregiver']);
      if (!session) return;
      if (!(await caregiverManages(session.subjectId, req.params.id))) {
        return reply.code(403).send({ error: { code: 'forbidden', message: 'Not your person.' } });
      }

      const result = await claimDevice(req.body.device_id, req.body.claim_code, req.params.id);
      if (result === 'claimed') return reply.send({ ok: true, deviceId: req.body.device_id });

      const messages: Record<typeof result, string> = {
        already_claimed:
          'This device has already been paired. A second-hand device cannot be re-claimed.',
        not_found: 'No such device.',
        bad_code: 'That claim code does not match.',
      };
      return reply.code(409).send({ error: { code: result, message: messages[result] } });
    },
  );

  /** FR-SET-4: trigger numbers, each needing confirmation before it routes. */
  app.post<{
    Params: { id: string };
    Body: { phone: string; role: 'self' | 'caregiver'; can_cancel?: boolean; never_inform?: boolean };
  }>('/api/portal/people/:id/sender-numbers', async (req, reply) => {
    const session = await requireSession(req, reply, ['caregiver']);
    if (!session) return;
    if (!(await caregiverManages(session.subjectId, req.params.id))) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not your person.' } });
    }

    await pool.query(
      `INSERT INTO sender_numbers (phone, person_id, role, can_cancel, never_inform, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,NULL)
       ON CONFLICT (phone, person_id) DO UPDATE
         SET role = $3, can_cancel = $4, never_inform = $5`,
      [req.body.phone, req.params.id, req.body.role, req.body.can_cancel ?? false, req.body.never_inform ?? false],
    );
    const code = await issueOtp(req.body.phone, `sender:${req.params.id}`);
    return reply.send({
      ok: true,
      confirmationRequired: true,
      ...(config.isProduction ? {} : { code, notice: 'SIMULATED: no SMS was sent.' }),
    });
  });

  app.post<{ Params: { id: string }; Body: { phone: string; code: string } }>(
    '/api/portal/people/:id/sender-numbers/confirm',
    async (req, reply) => {
      const session = await requireSession(req, reply, ['caregiver']);
      if (!session) return;
      if (!(await consumeOtp(req.body.phone, `sender:${req.params.id}`, req.body.code))) {
        return reply.code(401).send({ error: { code: 'bad_code', message: 'That code is not valid.' } });
      }
      await pool.query(
        'UPDATE sender_numbers SET confirmed_at = now() WHERE phone = $1 AND person_id = $2',
        [req.body.phone, req.params.id],
      );
      return reply.send({ ok: true, confirmed: true });
    },
  );

  /** FR-SET-5: the ordered family escalation chain. */
  app.put<{
    Params: { id: string };
    Body: { contacts: Array<{ name?: string; phone: string; relation?: string; never_inform?: boolean }> };
  }>('/api/portal/people/:id/family-contacts', async (req, reply) => {
    const session = await requireSession(req, reply, ['caregiver']);
    if (!session) return;
    if (!(await caregiverManages(session.subjectId, req.params.id))) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not your person.' } });
    }

    await pool.query('DELETE FROM family_contacts WHERE person_id = $1', [req.params.id]);
    let i = 0;
    for (const c of req.body.contacts) {
      await pool.query(
        `INSERT INTO family_contacts (person_id, order_index, name, phone, relation, never_inform)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.params.id, i, c.name ?? null, c.phone, c.relation ?? null, c.never_inform ?? false],
      );
      i += 1;
    }
    return reply.send({ ok: true, contacts: await findFamilyContacts(req.params.id) });
  });

  /** FR-SET-7: the DPDP consent record. */
  app.post<{
    Params: { id: string };
    Body: { granted_by: string; capacity_basis: 'self' | 'parent' | 'lawful_guardian'; scope: string[] };
  }>('/api/portal/people/:id/consent', async (req, reply) => {
    const session = await requireSession(req, reply, ['caregiver']);
    if (!session) return;
    if (!(await caregiverManages(session.subjectId, req.params.id))) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not your person.' } });
    }

    const person = await findPerson(req.params.id);
    const isMinor = person?.ageBand === '0-12' || person?.ageBand === '13-17';
    // DPDP Rule 10: a child needs verifiable parental consent.
    if (isMinor && req.body.capacity_basis === 'self') {
      return reply.code(400).send({
        error: {
          code: 'parental_consent_required',
          message: 'A child needs verifiable consent from a parent or lawful guardian.',
        },
      });
    }

    await pool.query(
      `INSERT INTO consents (person_id, granted_by, capacity_basis, scope)
       VALUES ($1,$2,$3,$4)`,
      [req.params.id, req.body.granted_by, req.body.capacity_basis, req.body.scope],
    );
    return reply.send({ ok: true });
  });

  /**
   * FR-SET-8: a drill.
   *
   * It runs the whole chain flagged `drill`: every device pattern plays and the
   * caregiver gets sample messages, but no volunteer is alerted.
   */
  app.post<{ Params: { id: string } }>('/api/portal/people/:id/drill', async (req, reply) => {
    const session = await requireSession(req, reply, ['caregiver']);
    if (!session) return;
    if (!(await caregiverManages(session.subjectId, req.params.id))) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not your person.' } });
    }

    const person = await findPerson(req.params.id);
    if (!person) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });

    const event: NormalisedEvent = {
      source: 'home_button',
      sender: person.id,
      type: 'panic',
      at: new Date(),
      isDrill: true,
    };
    const outcome = await ingest(event);
    void runDispatchPhase(outcome.incident, outcome.person, event);

    return reply.send({
      ok: true,
      incident_id: outcome.incident.id,
      isDrill: true,
      // The caregiver can preview every pattern the person will feel.
      patterns: allPatternsFor(person.feedbackProfile),
      note: 'This is a drill. No volunteer has been alerted.',
    });
  });

  /** FR-SET-9: the printable kit. */
  app.get<{ Params: { id: string } }>('/api/portal/people/:id/kit', async (req, reply) => {
    const session = await requireSession(req, reply, ['caregiver']);
    if (!session) return;
    if (!(await caregiverManages(session.subjectId, req.params.id))) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not your person.' } });
    }

    const person = await findPerson(req.params.id);
    if (!person) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });

    const bystanderCode = newId('qr');
    return reply.send({
      fridgeQr: {
        // Opens a prefilled WhatsApp message, so a visitor needs no app and no
        // instructions.
        url: `https://wa.me/?text=${encodeURIComponent('HELP')}`,
        caption: `Scan to send HELP for ${person.name}`,
      },
      walletCard: {
        name: person.name,
        respondsToName: person.respondsToName ?? null,
        line1: 'If this person needs help, send HELP on WhatsApp to SafeCircle.',
        line2: 'In an emergency, call 112.',
      },
      bystanderSticker: {
        code: bystanderCode,
        url: `/bystander/${bystanderCode}`,
        // FR-TRG-8: the sticker must carry no personal data at all.
        caption: 'This person may need help. Scan to alert their family.',
      },
      notice: 'The bystander page never shows a name, address or medical note.',
    });
  });

  /** Device heartbeat health for the caregiver home page (FR-FDB-6). */
  app.get('/api/portal/device-health', async (req, reply) => {
    const session = await requireSession(req, reply, ['caregiver']);
    if (!session) return;
    return reply.send({ stale: await staleDevices(24) });
  });
}

async function resolveSubject(role: string, phone: string): Promise<string | null> {
  if (role === 'caregiver') {
    const row = await one<{ id: string }>('SELECT id FROM caregivers WHERE phone = $1', [phone]);
    return row?.id ?? null;
  }
  if (role === 'volunteer') {
    const row = await one<{ id: string }>('SELECT id FROM volunteers WHERE phone = $1', [phone]);
    return row?.id ?? null;
  }
  if (role === 'guard') {
    const row = await one<{ id: string }>('SELECT id FROM guards WHERE phone = $1', [phone]);
    return row?.id ?? null;
  }
  // The dashboard is a society or control-room desk rather than a person.
  const row = await one<{ id: string }>('SELECT id FROM societies ORDER BY id LIMIT 1');
  return row?.id ?? 'dashboard';
}

async function caregiverManages(caregiverId: string, personId: string): Promise<boolean> {
  const row = await one<{ person_id: string }>(
    'SELECT person_id FROM caregiver_links WHERE caregiver_id = $1 AND person_id = $2',
    [caregiverId, personId],
  );
  return row !== null;
}

async function deviceHealth(deviceIds: string[]): Promise<unknown[]> {
  if (deviceIds.length === 0) return [];
  return query(
    `SELECT device_id, type, battery_pct, last_seen_at,
            (last_seen_at IS NULL OR last_seen_at < now() - interval '24 hours') AS silent
     FROM devices WHERE device_id = ANY($1::text[])`,
    [deviceIds],
  );
}

function completenessFor(
  person: Awaited<ReturnType<typeof findPerson>>,
  deviceCount: number,
  contactCount: number,
): number {
  if (!person) return 0;
  const checks = [
    person.name.length > 0,
    person.lat !== undefined && person.lng !== undefined,
    person.languages.length > 0,
    deviceCount > 0,
    contactCount > 0,
    person.health !== undefined,
    person.handling !== undefined,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
