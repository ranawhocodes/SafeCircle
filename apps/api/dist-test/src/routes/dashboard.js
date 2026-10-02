import { describeAccuracy, isDemoSpeed, isStale, } from '@safecircle/shared';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { appendEvent, closeIncident, findIncident, listDispatches, listEvents, listLocations, listRecentIncidents, } from '../db/repositories/incidents.js';
import { findPerson } from '../db/repositories/people.js';
import { badgeFor, findVolunteer, primarySkillLabel } from '../db/repositories/volunteers.js';
import { applyVerificationOutcome } from '../domain/cancel.js';
import { applyCheckInAnswer } from '../domain/checkIn.js';
import { buildHandoffPacket } from '../domain/escalation.js';
import { currentLocation } from '../services/location.js';
import { simulatedCapabilities } from '../providers/index.js';
import { requireSession } from '../security/auth.js';
export async function dashboardRoutes(app) {
    /** What this deployment is honest about faking (NFR-14). */
    app.get('/api/meta', async (_req, reply) => reply.send({
        simulatedCapabilities: simulatedCapabilities(),
        demoTimeScale: config.demoTimeScale,
        demoSpeed: isDemoSpeed(config.demoTimeScale),
        notice: 'SafeCircle adds to 112 and does not replace it. Simulated capabilities are labelled wherever they appear.',
    }));
    app.get('/api/dashboard/incidents', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard', 'guard']);
        if (!session)
            return;
        const now = new Date();
        const incidents = await listRecentIncidents(60);
        const rows = [];
        for (const i of incidents) {
            const person = i.personId ? await findPerson(i.personId) : null;
            const location = await currentLocation(i.id);
            const dispatches = await listDispatches(i.id);
            rows.push({
                id: i.id,
                state: i.state,
                severity: i.severity,
                caseType: i.caseType,
                flags: i.flags,
                openedAt: i.openedAt,
                closedAt: i.closedAt,
                outcome: i.outcome,
                demoSpeed: isDemoSpeed(i.demoTimeScale),
                // Never auto-closed: a stale incident is flagged for a human (FR-INC-5).
                stale: isStale(i.state, i.lastEventAt, now),
                escalatedTo112: i.escalatedAt !== null,
                escalationSimulated: true,
                volunteerObservedType: i.volunteerObservedType,
                // Guards and the control room are trusted roles and get the flat at once.
                person: person
                    ? { name: person.name, ageBand: person.ageBand, flat: person.flat, address: person.address }
                    : null,
                location,
                locationDescription: location ? describeAccuracy(location) : null,
                alerted: dispatches.length,
                accepted: dispatches.filter((d) => d.response === 'accepted').length,
                declined: dispatches.filter((d) => d.response === 'declined').length,
            });
        }
        return reply.send({ incidents: rows });
    });
    /** Everything about one incident, including why each volunteer was ranked. */
    app.get('/api/dashboard/incidents/:id', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard', 'guard']);
        if (!session)
            return;
        const incident = await findIncident(req.params.id);
        if (!incident) {
            return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
        }
        const person = incident.personId ? await findPerson(incident.personId) : null;
        const dispatches = [];
        for (const d of await listDispatches(incident.id)) {
            const v = await findVolunteer(d.volunteerId);
            dispatches.push({
                volunteerId: d.volunteerId,
                name: v?.name ?? 'unknown',
                badge: v ? badgeFor(v.trustLevel) : null,
                skill: v ? primarySkillLabel(v.skills) : null,
                tier: d.tier,
                sentAt: d.sentAt,
                upgradedAt: d.upgradedAt,
                response: d.response,
                declineReason: d.declineReason,
                respondedAt: d.respondedAt,
                rankScore: d.rankScore,
                stoodDownAt: d.stoodDownAt,
            });
        }
        const rankInputs = await query('SELECT volunteer_id, rank_inputs FROM dispatches WHERE incident_id = $1', [incident.id]);
        const locations = await listLocations(incident.id);
        return reply.send({
            incident: {
                ...incident,
                demoSpeed: isDemoSpeed(incident.demoTimeScale),
                // Derived here as well as in the list, so both surfaces agree.
                escalatedTo112: incident.escalatedAt !== null,
                escalationSimulated: true,
                stale: isStale(incident.state, incident.lastEventAt, new Date()),
            },
            person: person
                ? {
                    name: person.name,
                    ageBand: person.ageBand,
                    flat: person.flat,
                    address: person.address,
                    landmark: person.landmark,
                    feedbackProfile: person.feedbackProfile,
                    protected: person.protected,
                    handling: person.handling ?? null,
                    health: person.health ?? null,
                }
                : null,
            dispatches,
            // FR-ALT-5: the inputs, so a dispatch decision can be explained.
            rankInputs: Object.fromEntries(rankInputs.map((r) => [r.volunteer_id, r.rank_inputs])),
            locations: locations.map((l) => ({ ...l, description: describeAccuracy(l) })),
            timeline: await listEvents(incident.id),
        });
    });
    /**
     * Drive the simulated verification IVR (section 22.1 scene 3).
     *
     * In production this is the provider's DTMF webhook instead; here a presenter
     * clicks "no answer" and the alert resumes at high priority.
     */
    app.post('/api/dashboard/incidents/:id/verification-outcome', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard']);
        if (!session)
            return;
        const result = await applyVerificationOutcome(req.params.id, req.body.outcome, {
            simulated: true,
        });
        if (!result.ok) {
            return reply
                .code(409)
                .send({ error: { code: result.reason, message: 'Not awaiting verification.' } });
        }
        return reply.send({ ...result, simulated: true });
    });
    /**
     * F15: Drive the simulated start-of-alert check-in IVR.
     * Options: medical, fall, danger, mistake, no_answer.
     */
    app.post('/api/dashboard/incidents/:id/check-in-outcome', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard']);
        if (!session)
            return;
        const result = await applyCheckInAnswer(req.params.id, req.body.answer);
        if (!result.ok) {
            return reply
                .code(400)
                .send({ error: { code: result.reason, message: 'Could not apply check-in answer.' } });
        }
        return reply.send({ ...result, simulated: true });
    });
    /** The 112 packet, always labelled. */
    app.get('/api/dashboard/incidents/:id/handoff-112', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard', 'guard']);
        if (!session)
            return;
        const packet = await buildHandoffPacket(req.params.id);
        if (!packet) {
            return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
        }
        return reply.send({
            packet: {
                ...packet,
                locationDescription: packet.location ? describeAccuracy(packet.location) : null,
            },
            simulated: true,
            notice: 'SIMULATED. No real ERSS-112 integration exists in this build.',
        });
    });
    app.post('/api/dashboard/incidents/:id/close', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard', 'guard']);
        if (!session)
            return;
        const incident = await findIncident(req.params.id);
        if (!incident) {
            return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
        }
        await closeIncident(req.params.id, req.body.outcome);
        await appendEvent(req.params.id, 'closed_by_dashboard', session.subjectType, session.subjectId, {
            outcome: req.body.outcome,
            note: req.body.note ?? null,
        });
        const { cancelTimers } = await import('../db/repositories/incidents.js');
        await cancelTimers(req.params.id);
        return reply.send({ ok: true, state: 'resolved', outcome: req.body.outcome });
    });
    /** Everything the simulated providers "sent" (section 22.1). */
    app.get('/api/dashboard/outbox', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard', 'guard']);
        if (!session)
            return;
        const limit = Math.min(Number(req.query.limit ?? 100), 500);
        const rows = req.query.incident_id
            ? await query('SELECT * FROM outbox WHERE incident_id = $1 ORDER BY at DESC LIMIT $2', [req.query.incident_id, limit])
            : await query('SELECT * FROM outbox ORDER BY at DESC LIMIT $1', [limit]);
        return reply.send({
            outbox: rows,
            notice: 'These are the messages SafeCircle would have sent. Nothing was really delivered.',
        });
    });
    /** The audit log for one person - section 12.5's promise, made inspectable. */
    app.get('/api/dashboard/audit/:personId', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard']);
        if (!session)
            return;
        const rows = await query('SELECT * FROM audit_log WHERE person_id = $1 ORDER BY at DESC LIMIT 200', [req.params.personId]);
        return reply.send({ audit: rows });
    });
    /** The KPIs in section 23.3, computed from the event log alone. */
    app.get('/api/dashboard/kpis', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard']);
        if (!session)
            return;
        const [pressToAlert] = await query(`
      SELECT percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (d.first_sent - i.opened_at))
      ) AS median_s
      FROM incidents i
      JOIN (
        SELECT incident_id, MIN(sent_at) AS first_sent FROM dispatches GROUP BY incident_id
      ) d ON d.incident_id = i.id`);
        const [acceptWithin60] = await query(`
      SELECT 100.0 * AVG(CASE WHEN accepted_within_60 THEN 1 ELSE 0 END) AS pct
      FROM (
        SELECT i.id,
               BOOL_OR(d.responded_at IS NOT NULL
                       AND d.response = 'accepted'
                       AND d.responded_at <= i.opened_at + interval '60 seconds') AS accepted_within_60
        FROM incidents i LEFT JOIN dispatches d ON d.incident_id = i.id
        GROUP BY i.id
      ) t`);
        const [falseAlarms] = await query(`SELECT count(*)::int AS n FROM incidents WHERE outcome = 'cancelled_verified_safe'`);
        const [duress] = await query(`SELECT count(*)::int AS n FROM incidents WHERE flags->>'possibleDuress' = 'true'`);
        const [locationAccuracy] = await query(`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY accuracy_m) AS median_m
      FROM person_locations WHERE source IN ('gps','wifi')`);
        const [silentDevices] = await query(`
      SELECT count(*)::int AS n FROM devices
      WHERE status = 'active' AND (last_seen_at IS NULL OR last_seen_at < now() - interval '24 hours')`);
        return reply.send({
            pressToFirstAlertMedianS: pressToAlert?.median_s ?? null,
            pressToFirstAlertTargetS: 10,
            firstAcceptWithin60Pct: acceptWithin60?.pct ?? null,
            firstAcceptWithin60TargetPct: 80,
            falseAlarmsCaughtByVerification: falseAlarms?.n ?? 0,
            possibleDuressIncidents: duress?.n ?? 0,
            dispatchLocationAccuracyMedianM: locationAccuracy?.median_m ?? null,
            dispatchLocationAccuracyTargetM: 30,
            devicesSilentOver24h: silentDevices?.n ?? 0,
            note: 'Targets are the proposals in master document section 23.3, not achieved results.',
        });
    });
    /** Get guard duty statuses. */
    app.get('/api/dashboard/guards', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard', 'guard']);
        if (!session)
            return;
        const rows = await query('SELECT id, name, phone, on_duty, society_id FROM guards ORDER BY order_index ASC');
        return reply.send({
            guards: rows.map((r) => ({
                id: r.id,
                name: r.name,
                phone: r.phone,
                onDuty: r.on_duty,
                societyId: r.society_id,
            })),
        });
    });
    /**
     * Guard shift toggle: Guard can toggle on/off duty from the dashboard (Gap #4).
     */
    app.post('/api/dashboard/shift', async (req, reply) => {
        const session = await requireSession(req, reply, ['dashboard', 'guard']);
        if (!session)
            return;
        const targetId = req.body?.guardId || (session.subjectType === 'guard' ? session.subjectId : 'grd_ravi');
        const rows = await query('UPDATE guards SET on_duty = $2 WHERE id = $1 RETURNING id, name, on_duty', [targetId, Boolean(req.body?.onDuty)]);
        if (rows.length === 0) {
            return reply.code(404).send({ error: { code: 'not_found', message: 'Guard not found.' } });
        }
        return reply.send({
            ok: true,
            guard: { id: rows[0].id, name: rows[0].name, onDuty: rows[0].on_duty },
        });
    });
}
//# sourceMappingURL=dashboard.js.map