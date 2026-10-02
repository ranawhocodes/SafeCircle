import { findForbiddenKeys } from '@safecircle/shared';
import { one } from '../db/pool.js';
import { appendEvent, insertLocation } from '../db/repositories/incidents.js';
import { findPerson } from '../db/repositories/people.js';
import { ingest, runDispatchPhase } from '../domain/engine.js';
export async function bystanderRoutes(app) {
    /**
     * What the stranger's phone loads. Deliberately almost empty: the response is
     * asserted against the forbidden-key list before it is sent.
     */
    app.get('/api/bystander/:code', async (req, reply) => {
        const device = await one("SELECT device_id FROM devices WHERE device_id = $1 AND status = 'active'", [req.params.code]);
        // Even an unknown code gets the same page, so the QR cannot be used to probe
        // which codes are real.
        const payload = {
            prompt: 'This person may need help.',
            action: 'Tap to alert their family.',
            canAlertFamily: device !== null,
            askForLocation: true,
            emergencyNotice: 'If this is an emergency, call 112 now.',
        };
        const leaked = findForbiddenKeys(payload);
        if (leaked.length > 0) {
            req.log.error({ leaked }, 'bystander payload contained forbidden keys');
            return reply.code(500).send({ error: { code: 'disclosure_guard_tripped', message: 'Refused.' } });
        }
        return reply.send(payload);
    });
    /** The stranger shares their own location and an optional note. */
    app.post('/api/bystander/:code/alert', async (req, reply) => {
        const device = await one("SELECT device_id, person_id FROM devices WHERE device_id = $1 AND status = 'active'", [req.params.code]);
        if (!device?.person_id) {
            // Same shape as success, so a prober learns nothing.
            return reply.send({ ok: true, familyAlerted: false });
        }
        const person = await findPerson(device.person_id);
        if (!person)
            return reply.send({ ok: true, familyAlerted: false });
        const at = new Date();
        const event = {
            source: 'bystander_qr',
            sender: person.id,
            type: 'panic',
            at,
            text: req.body?.note,
        };
        const outcome = await ingest(event);
        // The bystander's own phone position, recorded as its own source so every
        // consumer can see where the number came from.
        if (Number.isFinite(req.body?.lat) && Number.isFinite(req.body?.lng)) {
            await insertLocation(outcome.incident.id, {
                lat: req.body.lat,
                lng: req.body.lng,
                accuracyM: req.body?.accuracy_m ?? 30,
                source: 'bystander',
                at,
            });
        }
        await appendEvent(outcome.incident.id, 'bystander_alert', 'bystander', null, {
            note: req.body?.note ?? null,
            hasLocation: Number.isFinite(req.body?.lat),
        });
        if (!outcome.merged) {
            void runDispatchPhase(outcome.incident, outcome.person, event);
        }
        // The stranger is told only that it worked.
        return reply.send({
            ok: true,
            familyAlerted: true,
            message: 'Thank you. We have alerted their family and nearby helpers. Please stay with them if you can.',
            emergencyNotice: 'If this is an emergency, call 112 now.',
        });
    });
}
//# sourceMappingURL=bystander.js.map