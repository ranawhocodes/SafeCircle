/**
 * Device routes (Face A): the button and the pendant.
 *
 * The ordering here is the whole point of section 18.2's "send now, refine
 * later": the signature and sequence are checked, the incident is made durable,
 * and the device is answered - and only then does the fan-out run.
 */
import type { FastifyInstance } from 'fastify';
import {
  PRESS,
  patternFor,
  type NormalisedEvent,
  type RawLocationReport,
} from '@safecircle/shared';
import { config } from '../config.js';
import {
  advanceSequence,
  findDevice,
  getStatusCursor,
  setStatusCursor,
  touchDevice,
} from '../db/repositories/devices.js';
import { appendEvent, findIncident, findOpenIncidentForPerson } from '../db/repositories/incidents.js';
import { findPerson } from '../db/repositories/people.js';
import { ingest, ingestLocationUpdate, runDispatchPhase } from '../domain/engine.js';
import { dispatchIncident } from '../services/dispatch.js';
import { requestCancel } from '../domain/cancel.js';
import { checkSequence, verifySignature } from '../security/hmac.js';
import { statusFor } from '../services/deviceStatus.js';
import { pool } from '../db/pool.js';

interface SosBody {
  device_id: string;
  event: NormalisedEvent['type'];
  seq?: number;
  battery?: number;
  location?: RawLocationReport;
  signature?: string;
  drill?: boolean;
}

/**
 * One error shape for every rejection, so a prober cannot tell a bad signature
 * from an unknown device from a replayed packet.
 */
const REJECT = {
  error: { code: 'device_event_rejected', message: 'Event rejected.' },
} as const;

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SosBody }>('/api/sos/device', async (req, reply) => {
    const body = req.body;
    if (!body?.device_id || !body?.event) {
      return reply.code(400).send(REJECT);
    }

    const device = await findDevice(body.device_id);
    if (!device || !device.personId) {
      req.log.warn({ deviceId: body.device_id }, 'event from unknown or unclaimed device');
      return reply.code(401).send(REJECT);
    }

    // --- authenticity -----------------------------------------------------
    const signatureOk =
      verifySignature(body as unknown as Record<string, unknown>, body.signature, device.hmacKey) ||
      config.allowUnsignedDevices;
    if (!signatureOk) {
      req.log.warn({ deviceId: body.device_id }, 'bad device signature');
      return reply.code(401).send(REJECT);
    }

    const verdict = checkSequence(body.seq, device.lastSeq);
    if (verdict === 'replay') {
      req.log.warn({ deviceId: body.device_id, seq: body.seq }, 'replayed device sequence');
      return reply.code(409).send(REJECT);
    }
    if (verdict === 'ok') {
      const advanced = await advanceSequence(body.device_id, body.seq!, body.battery ?? null);
      if (!advanced) return reply.code(409).send(REJECT);
    } else {
      // No sequence at all: accepted only where unsigned devices are allowed,
      // which is the firmware bring-up path in section 18.9.
      if (!config.allowUnsignedDevices) return reply.code(400).send(REJECT);
      await touchDevice(body.device_id, body.battery ?? null);
    }

    const person = await findPerson(device.personId);
    if (!person) return reply.code(401).send(REJECT);

    const at = new Date();

    // --- non-alarm events -------------------------------------------------
    if (body.event === 'heartbeat' || body.event === 'low_battery') {
      return reply.code(202).send({
        ok: true,
        event: body.event,
        nextHeartbeatMs: 6 * 3600 * 1000,
        ...(body.event === 'low_battery'
          ? { pattern: patternFor('low_battery', person.feedbackProfile) }
          : {}),
      });
    }

    if (body.event === 'location_update') {
      const open = await findOpenIncidentForPerson(person.id);
      if (!open) {
        // No incident, so nothing to update. The pendant should stop sending.
        return reply.code(202).send({ ok: true, incidentOpen: false, stopUpdates: true });
      }
      const result = await ingestLocationUpdate(open, person, body.location ?? {}, at);
      return reply.code(202).send({
        ok: true,
        incidentOpen: true,
        reRanked: result.reRanked,
        source: result.location?.source ?? null,
        accuracyM: result.location?.accuracyM ?? null,
      });
    }

    if (body.event === 'cancel') {
      const open = await findOpenIncidentForPerson(person.id);
      if (!open) return reply.code(202).send({ ok: true, incidentOpen: false });

      const result = await requestCancel(open.id, { type: 'device', id: body.device_id });
      const cursor = await getStatusCursor(body.device_id);
      return reply.code(202).send({
        ok: result.ok,
        incident_id: open.id,
        // Deliberately quiet, and the response says so for the firmware's benefit.
        stage: cursor.stage,
        seq: cursor.seq,
        pattern: patternFor('cancel_verifying', person.feedbackProfile),
        note: 'Cancel requested. Verification is under way; help has not stopped.',
        poll_after_ms: 3000,
      });
    }

    // --- panic / silent panic ---------------------------------------------
    const event: NormalisedEvent = {
      source: device.type === 'go' ? 'go_pendant' : 'home_button',
      // The engine identifies by person for device events.
      sender: person.id,
      type: body.event,
      at,
      location: body.location,
      battery: body.battery,
      seq: body.seq,
      isDrill: body.drill === true,
    };

    const outcome = await ingest(event);
    const cursor = await getStatusCursor(body.device_id);

    // Reply BEFORE the fan-out, so the person feels "we got it" first.
    const silentRequested = outcome.incident.flags.silentRequested === true;
    const response = {
      incident_id: outcome.incident.id,
      merged: outcome.merged,
      stage: cursor.stage,
      seq: cursor.seq,
      pattern: patternFor(cursor.stage, person.feedbackProfile, { silentRequested }),
      severity: outcome.severity,
      location_source: outcome.location?.source ?? null,
      location_accuracy_m: outcome.location?.accuracyM ?? null,
      poll_after_ms: 3000,
      demo_speed: outcome.incident.demoTimeScale !== 1,
    };

    if (!outcome.merged) {
      // Not awaited: dispatch, timers, family and refinement run after the reply.
      void runDispatchPhase(outcome.incident, outcome.person, event);
    } else if (outcome.person) {
      // Repeat press on an open incident: re-run dispatch so any newly available volunteers are alerted!
      void dispatchIncident(outcome.incident, outcome.person, event.at).catch(() => {});
    }

    return reply.code(202).send(response);
  });

  /** The firmware's status poll (section 7.3). */
  app.get<{ Params: { deviceId: string } }>(
    '/api/device/:deviceId/status',
    async (req, reply) => {
      const device = await findDevice(req.params.deviceId);
      if (!device || !device.personId) return reply.code(404).send(REJECT);

      const person = await findPerson(device.personId);
      if (!person) return reply.code(404).send(REJECT);

      const status = await statusFor(req.params.deviceId, person.feedbackProfile);
      return reply.send({
        stage: status.stage,
        seq: status.seq,
        pattern: status.pattern,
        incident_open: status.incidentOpen,
        poll_after_ms: status.pollAfterMs,
      });
    },
  );

  /** Timings the firmware reads at boot, so a decision change needs no reflash. */
  app.get<{ Params: { deviceId: string } }>(
    '/api/device/:deviceId/config',
    async (req, reply) => {
      const device = await findDevice(req.params.deviceId);
      if (!device || !device.personId) return reply.code(404).send(REJECT);
      const person = await findPerson(device.personId);
      if (!person) return reply.code(404).send(REJECT);

      return reply.send({
        sos_hold_ms: PRESS.sosHoldMs,
        cancel_hold_ms: PRESS.cancelHoldMs,
        silent_press_count: PRESS.silentPressCount,
        silent_press_window_ms: PRESS.silentPressWindowMs,
        pre_send_countdown_s: person.preSendCountdownS,
        feedback_profile: person.feedbackProfile,
        heartbeat_interval_s: 6 * 3600,
      });
    },
  );

  /**
   * A dedicated location endpoint, so a pendant streaming updates during an
   * incident does not have to re-send the whole SOS envelope.
   */
  app.post<{
    Params: { deviceId: string };
    Body: { incident_id?: string; seq?: number; signature?: string; location: RawLocationReport };
  }>('/api/device/:deviceId/location', async (req, reply) => {
    const device = await findDevice(req.params.deviceId);
    if (!device || !device.personId) return reply.code(401).send(REJECT);

    const signatureOk =
      verifySignature(
        req.body as unknown as Record<string, unknown>,
        req.body.signature,
        device.hmacKey,
      ) || config.allowUnsignedDevices;
    if (!signatureOk) return reply.code(401).send(REJECT);

    const person = await findPerson(device.personId);
    if (!person) return reply.code(401).send(REJECT);

    const incident = req.body.incident_id
      ? await findIncident(req.body.incident_id)
      : await findOpenIncidentForPerson(person.id);
    if (!incident || incident.closedAt) {
      return reply.code(202).send({ ok: true, incidentOpen: false, stopUpdates: true });
    }

    const result = await ingestLocationUpdate(incident, person, req.body.location, new Date());
    return reply.code(202).send({
      ok: true,
      incidentOpen: true,
      reRanked: result.reRanked,
      source: result.location?.source ?? null,
      accuracyM: result.location?.accuracyM ?? null,
      next_update_ms: result.reRanked ? 10_000 : 60_000,
    });
  });

  /** Heartbeat: link health and battery, never a location (section 18.7). */
  app.post<{ Params: { deviceId: string }; Body: { battery?: number; signature?: string } }>(
    '/api/device/:deviceId/heartbeat',
    async (req, reply) => {
      const device = await findDevice(req.params.deviceId);
      if (!device) return reply.code(401).send(REJECT);
      await touchDevice(req.params.deviceId, req.body?.battery ?? null);

      // A low battery is told to the caregiver days ahead (section 16.5 #21).
      if ((req.body?.battery ?? 100) <= 20 && device.personId) {
        const open = await findOpenIncidentForPerson(device.personId);
        if (open) {
          await appendEvent(open.id, 'device_low_battery', 'device', device.deviceId, {
            battery: req.body?.battery ?? null,
          });
        }
      }
      return reply.code(202).send({ ok: true, nextHeartbeatMs: 6 * 3600 * 1000 });
    },
  );

  /**
   * Development helper for the bring-up steps in section 18.9: reset a device's
   * status cursor so a rehearsal can start from idle. Also resolves any open incidents
   * for that device's person so it doesn't get dragged back into cancel_verifying.
   */
  app.post<{ Params: { deviceId: string } }>(
    '/api/device/:deviceId/reset-status',
    async (req, reply) => {
      if (config.isProduction) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
      }
      const device = await findDevice(req.params.deviceId);
      if (device?.personId) {
        await pool.query(
          "UPDATE incidents SET state = 'resolved', closed_at = now(), outcome = 'resolved_by_drill' WHERE person_id = $1 AND closed_at IS NULL",
          [device.personId],
        );
        await pool.query(
          "DELETE FROM incident_timers WHERE incident_id IN (SELECT id FROM incidents WHERE person_id = $1)",
          [device.personId],
        );
        await pool.query(
          "UPDATE dispatches SET stood_down_at = now() WHERE stood_down_at IS NULL AND incident_id IN (SELECT id FROM incidents WHERE person_id = $1)",
          [device.personId],
        );
      }
      await pool.query(
        "UPDATE volunteer_zones SET cell_lat = v.home_lat, cell_lng = v.home_lng, updated_at = now() FROM volunteers v WHERE volunteer_zones.volunteer_id = v.id AND v.home_lat IS NOT NULL",
      );
      await setStatusCursor(req.params.deviceId, 'idle', null);
      return reply.send({ ok: true, stage: 'idle' });
    },
  );

  app.post(
    '/api/device/reset-all',
    async (req, reply) => {
      if (config.isProduction) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
      }
      await pool.query(
        "UPDATE incidents SET state = 'resolved', closed_at = now(), outcome = 'resolved_by_drill' WHERE closed_at IS NULL",
      );
      await pool.query(
        "DELETE FROM incident_timers WHERE incident_id IN (SELECT id FROM incidents WHERE closed_at IS NOT NULL)",
      );
      await pool.query(
        "UPDATE dispatches SET stood_down_at = now() WHERE stood_down_at IS NULL",
      );
      await pool.query(
        "UPDATE device_status_cursor SET stage = 'idle', incident_id = NULL",
      );
      await pool.query(
        "UPDATE volunteer_zones SET cell_lat = v.home_lat, cell_lng = v.home_lng, updated_at = now() FROM volunteers v WHERE volunteer_zones.volunteer_id = v.id AND v.home_lat IS NOT NULL",
      );
      return reply.send({ ok: true, stage: 'idle' });
    },
  );
}
