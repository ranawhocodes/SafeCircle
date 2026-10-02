/** Runtime configuration. Everything is env-overridable; see .env.example. */
import { createHash } from 'node:crypto';

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${key}`);
  }
  return v;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

const nodeEnv = env('NODE_ENV', 'development');
const isTest = nodeEnv === 'test';

export const config = {
  nodeEnv,
  isTest,
  isProduction: nodeEnv === 'production',
  port: Number(env('PORT', '4000')),
  logLevel: env('LOG_LEVEL', isTest ? 'silent' : 'info'),

  databaseUrl: isTest
    ? env('DATABASE_URL_TEST', 'postgres://localhost:5432/safecircle_test')
    : env('DATABASE_URL', 'postgres://localhost:5432/safecircle'),

  /**
   * Field-level encryption key for medical notes, access secrets, device HMAC
   * keys and ID references.
   *
   * Outside production the fallback is DETERMINISTIC, not random. A random
   * per-process key is a trap: the seed script and the server would each
   * generate their own, and every encrypted field written by one would be
   * undecryptable by the other - with an error that looks like data corruption
   * rather than a misconfiguration. Production refuses to start without a real
   * key.
   */
  fieldEncryptionKey: (() => {
    const raw = process.env.FIELD_ENCRYPTION_KEY;
    if (raw && /^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    if (nodeEnv === 'production') {
      throw new Error(
        'FIELD_ENCRYPTION_KEY must be 32 bytes of hex in production. Generate one with: openssl rand -hex 32',
      );
    }
    if (raw) {
      throw new Error(
        'FIELD_ENCRYPTION_KEY is set but is not 32 bytes of hex. Generate one with: openssl rand -hex 32',
      );
    }
    return createHash('sha256').update('safecircle-development-key-do-not-use-in-production').digest();
  })(),

  /** 1 = real time. 0.333 compresses the 30 s upgrade to 10 s for stage use. */
  demoTimeScale: Number(env('DEMO_TIME_SCALE', '1')),

  /**
   * Development escape hatch for the firmware bring-up steps in section 18.9,
   * before per-device keys are flashed. Refused in production.
   */
  allowUnsignedDevices: (() => {
    const allow = bool('ALLOW_UNSIGNED_DEVICES', false);
    if (allow && nodeEnv === 'production') {
      throw new Error('ALLOW_UNSIGNED_DEVICES cannot be true in production');
    }
    return allow;
  })(),

  providers: {
    voice: env('PROVIDER_VOICE', 'simulated'),
    messaging: env('PROVIDER_MESSAGING', 'simulated'),
    push: env('PROVIDER_PUSH', 'websocket'),
    authority: env('PROVIDER_AUTHORITY', 'simulated'),
    geolocation: env('PROVIDER_GEOLOCATION', 'offline'),
    identity: env('PROVIDER_IDENTITY', 'simulated'),
  },

  sessionTtlHours: 24 * 14,
  otpTtlMinutes: 10,
} as const;

/** True when any capability on this deployment is a simulation (NFR-14). */
export function hasSimulatedProviders(): boolean {
  return Object.values(config.providers).some((p) => p === 'simulated');
}
