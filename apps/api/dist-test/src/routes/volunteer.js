import { DisclosureDeniedError, buildFlashcardSet, findForbiddenKeys, } from '@safecircle/shared';
import { servableCards, findCard } from '../db/repositories/cards.js';
import { findIncident } from '../db/repositories/incidents.js';
import { findIncidentHistory, findPerson } from '../db/repositories/people.js';
import { badgeFor, completeTutorial, findVolunteer, primarySkillLabel, setAvailability, updateZone, } from '../db/repositories/volunteers.js';
import { alertsFor, briefing, recordResponderFix, recordStatus, respond, selectCard, } from '../domain/responder.js';
import { requireSession } from '../security/auth.js';
export async function volunteerRoutes(app) {
    /** FR-VOL-2: the availability toggle and its modes. */
    app.post('/api/volunteer/availability', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard']);
        if (!session)
            return;
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
    });
    /**
     * A zone update between incidents, or a precise fix during one.
     *
     * Without an incident id only the coarse ~1 km cell is stored and no history
     * is kept (section 11.4).
     */
    app.post('/api/volunteer/location', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard']);
        if (!session)
            return;
        const { lat, lng } = req.body;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return reply
                .code(400)
                .send({ error: { code: 'bad_location', message: 'lat and lng are required.' } });
        }
        if (req.body.incident_id) {
            const result = await recordResponderFix(req.body.incident_id, session.subjectId, lat, lng, req.body.accuracy_m ?? 25);
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
    /** Open alerts for me - pre-accept view only (FR-VOL-1). */
    app.get('/api/volunteer/alerts', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard']);
        if (!session)
            return;
        const alerts = await alertsFor(session.subjectId);
        // Defence in depth: assert the payload really is free of identifying keys.
        const leaked = findForbiddenKeys(alerts);
        if (leaked.length > 0) {
            req.log.error({ leaked }, 'pre-accept payload contained forbidden keys');
            return reply.code(500).send({
                error: { code: 'disclosure_guard_tripped', message: 'Refused to send this payload.' },
            });
        }
        return reply.send({ alerts });
    });
    app.get('/api/volunteer/me', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard']);
        if (!session)
            return;
        const v = await findVolunteer(session.subjectId);
        if (!v)
            return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
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
        if (!session)
            return;
        await completeTutorial(session.subjectId);
        return reply.send({ ok: true, tutorialComplete: true });
    });
    /** Accept or decline (FR-ALT-4). A decline must carry a reason. */
    app.post('/api/incidents/:id/respond', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard']);
        if (!session)
            return;
        if (req.body.response === 'declined' && !req.body.reason) {
            return reply.code(400).send({
                error: {
                    code: 'reason_required',
                    message: 'Tell us why, so dispatch can learn: too far, busy, not safe or not trained.',
                },
            });
        }
        const result = await respond(req.params.id, session.subjectId, req.body.response, req.body.reason ?? null);
        if (!result.ok) {
            const status = result.reason === 'not_alerted' ? 403 : 409;
            return reply.code(status).send({ error: { code: result.reason, message: messageFor(result.reason) } });
        }
        return reply.send(result);
    });
    /** The briefing. 403 before accepting - and the data is never assembled. */
    app.get('/api/incidents/:id/briefing', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard', 'dashboard']);
        if (!session)
            return;
        try {
            const view = await briefing(req.params.id, {
                type: session.subjectType === 'guard' ? 'guard' : session.subjectType === 'dashboard' ? 'dashboard' : 'volunteer',
                id: session.subjectId,
                // A guard's duty state is checked here, not taken from the client.
                isOnDutyForSociety: session.subjectType === 'guard' ? await isGuardOnDuty(session.subjectId) : false,
            });
            return reply.send(view);
        }
        catch (err) {
            if (err instanceof DisclosureDeniedError) {
                return reply.code(403).send({
                    error: { code: 'briefing_not_authorised', message: 'Accept the alert first.' },
                });
            }
            throw err;
        }
    });
    /** FR-BRF-5: the three likely situations, plus CPR always on screen. */
    app.get('/api/incidents/:id/flashcards', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard', 'dashboard']);
        if (!session)
            return;
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
        }
        catch (err) {
            if (err instanceof DisclosureDeniedError) {
                return reply.code(403).send({
                    error: { code: 'briefing_not_authorised', message: 'Accept the alert first.' },
                });
            }
            throw err;
        }
        const person = await findPerson(incident.personId);
        if (!person)
            return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
        const set = buildFlashcardSet(await servableCards(), {
            person,
            caseType: incident.caseType,
            history: await findIncidentHistory(person.id),
            localHour: new Date().getHours(),
        });
        return reply.send({
            ...set,
            disclaimer: 'First-aid guidance, not a diagnosis.',
        });
    });
    app.get('/api/cards/:key', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard', 'dashboard']);
        if (!session)
            return;
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
    app.post('/api/incidents/:id/card-selection', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard']);
        if (!session)
            return;
        const result = await selectCard(req.params.id, session.subjectId, req.body.card_key);
        if (!result.ok) {
            return reply
                .code(403)
                .send({ error: { code: result.reason, message: messageFor(result.reason) } });
        }
        return reply.send({ ok: true, observedType: result.wording });
    });
    /** FR-VOL-3: the status taps. */
    app.post('/api/incidents/:id/status', async (req, reply) => {
        const session = await requireSession(req, reply, ['volunteer', 'guard']);
        if (!session)
            return;
        const result = await recordStatus(req.params.id, session.subjectId, req.body.status, req.body.note);
        if (!result.ok) {
            return reply
                .code(403)
                .send({ error: { code: result.reason, message: messageFor(result.reason) } });
        }
        return reply.send(result);
    });
}
async function isGuardOnDuty(guardId) {
    const { one } = await import('../db/pool.js');
    const row = await one('SELECT on_duty FROM guards WHERE id = $1', [guardId]);
    return row?.on_duty === true;
}
function messageFor(code) {
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
//# sourceMappingURL=volunteer.js.map