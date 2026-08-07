import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { nanoid } from 'nanoid';

const SESSION_COOKIE = 'pind_session';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

/** scrypt password hashing with a per-user random salt. Format: scrypt$salt$hash */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Random session token sent to the client. Only its hash is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionTtlMs(): number {
  return SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export function setSessionCookie(res: Response, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: sessionTtlMs(),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export { nanoid };
