/**
 * Device authentication (NFR-7, FR-TRG-10).
 *
 * Two controls, both required:
 *   1. HMAC-SHA256 over a CANONICAL serialisation of the payload with a
 *      per-device key. A tampered body fails.
 *   2. A strictly increasing sequence number. A captured-and-replayed packet
 *      fails even though its signature is valid.
 *
 * The canonical form sorts keys and excludes `signature`, so the firmware and
 * the server agree byte for byte without depending on JSON key order.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
/**
 * Deterministic JSON: object keys sorted at every depth, `undefined` dropped,
 * and the `signature` field itself excluded.
 */
export function canonicalise(payload) {
    const walk = (value) => {
        if (value === null || typeof value !== 'object')
            return value;
        if (Array.isArray(value))
            return value.map(walk);
        const out = {};
        for (const key of Object.keys(value).sort()) {
            if (key === 'signature')
                continue;
            const v = value[key];
            if (v === undefined)
                continue;
            out[key] = walk(v);
        }
        return out;
    };
    return JSON.stringify(walk(payload));
}
export function sign(payload, key) {
    return createHmac('sha256', key).update(canonicalise(payload)).digest('hex');
}
/** Constant-time signature check. A length mismatch is a mismatch, not a throw. */
export function verifySignature(payload, signature, key) {
    if (!signature)
        return false;
    const expected = sign(payload, key);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature.toLowerCase(), 'utf8');
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
/**
 * Replay check. A gap is accepted - a device that was offline will have sent
 * messages we never received, and refusing the next one would silence it
 * permanently.
 */
export function checkSequence(incoming, lastSeen) {
    if (incoming === undefined || !Number.isFinite(incoming))
        return 'missing';
    if (incoming <= lastSeen)
        return 'replay';
    return 'ok';
}
//# sourceMappingURL=hmac.js.map