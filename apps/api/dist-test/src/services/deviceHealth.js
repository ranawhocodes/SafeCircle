/**
 * Proactive Device Health and Low-Battery Alerts (F37).
 *
 * Checks for:
 *   1. Devices silent for >24 hours (no heartbeat).
 *   2. Devices with battery <= 20%.
 *
 * Safeguards:
 *   - 24-hour cooldown per device (last_health_alert_at) so caregivers are not
 *     spammed repeatedly for a flat battery.
 *   - Sends via MessagingPort with template 'device_health'.
 */
import { pool } from '../db/pool.js';
import { findPerson, informableFamilyContacts } from '../db/repositories/people.js';
import { providers } from '../providers/index.js';
export async function checkDeviceHealthAlerts(now = new Date()) {
    const res = await pool.query(`SELECT device_id, person_id, battery_pct, last_seen_at
     FROM devices
     WHERE status = 'active'
       AND person_id IS NOT NULL
       AND (
         (last_seen_at IS NULL OR last_seen_at < $1::timestamptz - interval '24 hours')
         OR (battery_pct IS NOT NULL AND battery_pct <= 20)
       )
       AND (last_health_alert_at IS NULL OR last_health_alert_at < $1::timestamptz - interval '24 hours')`, [now]);
    const alertedDevices = [];
    let notificationsSent = 0;
    for (const row of res.rows) {
        const person = await findPerson(row.person_id);
        if (!person)
            continue;
        const contacts = await informableFamilyContacts(row.person_id);
        const isLowBattery = row.battery_pct !== null && row.battery_pct <= 20;
        const isSilent = !row.last_seen_at || (now.getTime() - row.last_seen_at.getTime() >= 24 * 3600 * 1000);
        const issueText = isLowBattery && isSilent
            ? `Low battery (${row.battery_pct}%) and silent for >24h`
            : isLowBattery
                ? `Low battery (${row.battery_pct}%)`
                : 'Silent for over 24 hours (no heartbeat received)';
        for (const contact of contacts) {
            await providers.messaging.send({
                to: contact.phone,
                template: 'device_health',
                channel: 'whatsapp',
                params: {
                    person: person.name,
                    deviceId: row.device_id,
                    battery: row.battery_pct !== null ? `${row.battery_pct}%` : 'unknown',
                    issue: issueText,
                },
            });
            notificationsSent += 1;
        }
        await pool.query('UPDATE devices SET last_health_alert_at = $2 WHERE device_id = $1', [
            row.device_id,
            now,
        ]);
        alertedDevices.push(row.device_id);
    }
    return { alertedDevices, notificationsSent };
}
//# sourceMappingURL=deviceHealth.js.map