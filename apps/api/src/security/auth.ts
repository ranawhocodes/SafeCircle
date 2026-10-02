/**
 * Sessions and the one-time-code sign-in used by the portal and the volunteer
 * app. Deliberately small: a prototype does not need passwords, and a phone
 * number plus a code is the pattern Indian users already expect.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { one, pool } from '../db/pool.js';
import { numericCode, randomToken, safeEqual } from './crypto.js';

export type SubjectType = 'caregiver' | 'volunteer' | 'guard' | 'dashboard';

export interface Session {
  token: string;
  subjectType: SubjectType;
  subjectId: string;
}

export async function issueOtp(phone: string, purpose: string): Promise<string> {
  const code = numericCode(6);
  const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60_000);
  await pool.query(
    `INSERT INTO otp_codes (phone, code, purpose, expires_at, consumed_at)
     VALUES ($1,$2,$3,$4,NULL)
     ON CONFLICT (phone, purpose) DO UPDATE
       SET code = $2, expires_at = $4, consumed_at = NULL`,
    [phone, code, purpose, expiresAt],
  );
  return code;
}

export async function consumeOtp(
  phone: string,
  purpose: string,
  code: string,
): Promise<boolean> {
  const row = await one<{ code: string; expires_at: Date; consumed_at: Date | null }>(
    'SELECT code, expires_at, consumed_at FROM otp_codes WHERE phone = $1 AND purpose = $2',
    [phone, purpose],
  );
  if (!row || row.consumed_at || row.expires_at < new Date()) return false;
  if (!safeEqual(row.code, code)) return false;

  // Single use: the UPDATE predicate means two concurrent verifies cannot both win.
  const res = await pool.query(
    `UPDATE otp_codes SET consumed_at = now()
     WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [phone, purpose],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function createSession(
  subjectType: SubjectType,
  subjectId: string,
): Promise<string> {
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000);
  await pool.query(
    'INSERT INTO sessions (token, subject_type, subject_id, expires_at) VALUES ($1,$2,$3,$4)',
    [token, subjectType, subjectId, expiresAt],
  );
  return token;
}

export async function findSession(token: string): Promise<Session | null> {
  const row = await one<{ token: string; subject_type: SubjectType; subject_id: string }>(
    'SELECT token, subject_type, subject_id FROM sessions WHERE token = $1 AND expires_at > now()',
    [token],
  );
  return row
    ? { token: row.token, subjectType: row.subject_type, subjectId: row.subject_id }
    : null;
}

function bearerFrom(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Require a session of one of the given types. Replies 401 and returns null
 * rather than throwing, so routes read as a straight line.
 */
export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
  allowed: SubjectType[],
): Promise<Session | null> {
  const token = bearerFrom(req);
  if (!token) {
    await reply.code(401).send({ error: { code: 'unauthenticated', message: 'Sign in first.' } });
    return null;
  }
  const session = await findSession(token);
  if (!session || !allowed.includes(session.subjectType)) {
    await reply
      .code(401)
      .send({ error: { code: 'unauthenticated', message: 'Sign in first.' } });
    return null;
  }
  return session;
}
