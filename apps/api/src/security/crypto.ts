/**
 * Field-level encryption for the data that would do real harm if a dump leaked:
 * medical notes, handling notes, access codes, device HMAC keys, ID references
 * and private vouch reasons (NFR-8).
 *
 * AES-256-GCM. The stored blob is `iv (12) || authTag (16) || ciphertext`, so a
 * tampered value fails to decrypt rather than returning garbage.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../config.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptField(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', config.fieldEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptField(blob: Buffer): string {
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted field is too short to be valid');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', config.fieldEncryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Encrypt a JSON value, or return null for null/undefined so columns stay NULL. */
export function encryptJson(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  return encryptField(JSON.stringify(value));
}

export function decryptJson<T>(blob: Buffer | null): T | undefined {
  if (!blob) return undefined;
  return JSON.parse(decryptField(blob)) as T;
}

/** Constant-time string compare for secrets that are not hashes. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** Short, human-readable id with a type prefix, e.g. `inc_9f2a...`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/** A 6-digit numeric code for OTP and device claim flows. */
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomBytes(4).readUInt32BE(0) % max).padStart(digits, '0');
}
