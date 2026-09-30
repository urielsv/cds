/**
 * The single-passphrase lock on the owner's shed.
 *
 * Not an authentication system: one shared passphrase, no accounts, no audit
 * trail (see README "A note on access"). What it does do properly: the
 * passphrase is only ever compared as a scrypt hash in constant time, the
 * session is a short-lived signed HttpOnly cookie, and login attempts are
 * rate-limited per IP.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = 'mycds_session';

/** Long enough for an evening of cataloguing, short enough to expire unattended. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const KEY_LENGTH = 64;

function scrypt(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem must cover 128 * N * r bytes, or Node refuses larger cost factors.
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { ...params, maxmem: 256 * params.N * params.r },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

/**
 * `scrypt:N:r:p:salt:hash`, base64 fields. The same format is produced by
 * `scripts/hash-password.mjs`. Colons, not dollar signs, so the value survives
 * `.env` files whose loaders expand `$VARIABLES`.
 */
export async function hashPassword(
  password: string,
  params = { N: 2 ** 15, r: 8, p: 1 },
): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, params);
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false;
  }
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), params);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function secretKey(secret: string): Uint8Array {
  if (secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters.');
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(secret: string, now = new Date()): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ role: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('owner')
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
    .sign(secretKey(secret));
}

/** True only for a well-formed, correctly signed, unexpired owner token. */
export async function verifySessionToken(
  token: string,
  secret: string,
  now = new Date(),
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ['HS256'],
      subject: 'owner',
      currentDate: now,
    });
    return payload.role === 'owner';
  } catch {
    return false;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${String(SESSION_TTL_SECONDS)}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/**
 * Every write route calls this before doing anything. The client hiding the
 * add button is a convenience, never the control.
 */
export async function isOwner(request: Request, secret: string | undefined): Promise<boolean> {
  if (secret === undefined || secret.length === 0) return false;
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null) return false;
  return verifySessionToken(token, secret);
}

// ---------------------------------------------------------------------------
// Login rate limiting
// ---------------------------------------------------------------------------

export interface RateLimiterOptions {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
}

interface Attempts {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

/**
 * In-memory, per-instance. It resets when the function instance recycles, so it
 * stops an opportunistic script rather than a determined attacker; the design
 * notes say when to replace it with a durable counter.
 */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, Attempts>();
  private readonly options: RateLimiterOptions;

  constructor(
    options: RateLimiterOptions = { maxFailures: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 },
  ) {
    this.options = options;
  }

  /** Milliseconds until this key may try again, or 0 if it may now. */
  retryAfter(key: string, now = Date.now()): number {
    const entry = this.attempts.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.lockedUntil - now);
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.attempts.get(key);
    if (!entry || now - entry.windowStart > this.options.windowMs) {
      this.attempts.set(key, { failures: 1, windowStart: now, lockedUntil: 0 });
    } else {
      entry.failures += 1;
      if (entry.failures >= this.options.maxFailures) {
        entry.lockedUntil = now + this.options.lockoutMs;
        entry.failures = 0;
        entry.windowStart = now;
      }
    }
    // Keep the map from growing without bound on a long-lived instance.
    if (this.attempts.size > 5_000) {
      for (const [k, value] of this.attempts) {
        if (value.lockedUntil < now && now - value.windowStart > this.options.windowMs) {
          this.attempts.delete(k);
        }
      }
    }
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }
}
