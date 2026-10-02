/**
 * Provider webhook verification (NFR-7: "verify every provider signature;
 * reject unsigned calls").
 *
 * Each provider signs differently, so this is a small dispatch table rather than
 * one algorithm. Where no secret is configured, behaviour depends on the
 * environment: development accepts and logs, production refuses. A life-safety
 * endpoint must never silently accept unsigned traffic in production.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
function secretFor(provider) {
    const key = `WEBHOOK_SECRET_${provider.toUpperCase()}`;
    return process.env[key] ?? null;
}
function constantTimeEqual(a, b) {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length)
        return false;
    return timingSafeEqual(ab, bb);
}
/**
 * Meta signs with `sha256=<hex>` over the raw body; most Indian providers use a
 * plain HMAC header. Both shapes are accepted.
 */
export function verifyWebhook(provider, headers, body) {
    const secret = secretFor(provider);
    if (!secret) {
        // No secret configured: this is the simulated-provider path.
        return !config.isProduction;
    }
    const header = headers['x-hub-signature-256'] ??
        headers['x-safecircle-signature'] ??
        headers['x-webhook-signature'];
    if (!header)
        return false;
    const presented = header.startsWith('sha256=') ? header.slice(7) : header;
    const expected = createHmac('sha256', secret).update(JSON.stringify(body ?? {})).digest('hex');
    return constantTimeEqual(expected, presented.toLowerCase());
}
//# sourceMappingURL=webhook.js.map