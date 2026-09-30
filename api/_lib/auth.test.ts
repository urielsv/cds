// @vitest-environment node
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  createSessionToken,
  hashPassword,
  isOwner,
  LoginRateLimiter,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifyPassword,
  verifySessionToken,
} from './auth';

const SECRET = 'a-test-secret-that-is-long-enough-to-use-1234';
const FAST = { N: 2 ** 10, r: 8, p: 1 };

function withCookie(value: string): Request {
  return new Request('https://mycds.test/api/discs', {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}` },
  });
}

describe('passphrase hashing', () => {
  it('verifies the right passphrase and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple', FAST);
    expect(hash.startsWith('scrypt:')).toBe(true);
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('correct horse battery stapler', hash)).resolves.toBe(false);
  });

  it('rejects a malformed stored hash rather than throwing', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt:a:b:c:d:e')).resolves.toBe(false);
  });
});

describe('session verification — every rejection is explicit', () => {
  it('accepts a fresh token', async () => {
    const token = await createSessionToken(SECRET);
    await expect(isOwner(withCookie(token), SECRET)).resolves.toBe(true);
  });

  it('rejects a missing cookie', async () => {
    await expect(isOwner(new Request('https://mycds.test/'), SECRET)).resolves.toBe(false);
  });

  it('rejects a malformed cookie', async () => {
    await expect(isOwner(withCookie('not.a.jwt'), SECRET)).resolves.toBe(false);
  });

  it('rejects an expired token', async () => {
    const issued = new Date('2026-01-01T00:00:00Z');
    const token = await createSessionToken(SECRET, issued);
    const later = new Date(issued.getTime() + (SESSION_TTL_SECONDS + 5) * 1000);
    await expect(verifySessionToken(token, SECRET, later)).resolves.toBe(false);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await createSessionToken('some-other-secret-which-is-also-long-enough');
    await expect(isOwner(withCookie(token), SECRET)).resolves.toBe(false);
  });

  it('rejects a tampered payload', async () => {
    const token = await createSessionToken(SECRET);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ role: 'owner', sub: 'owner', exp: 9e9 })).toString(
      'base64url',
    );
    await expect(isOwner(withCookie(`${header}.${forged}.${signature}`), SECRET)).resolves.toBe(
      false,
    );
  });

  it('rejects an unsigned ("alg: none") token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ role: 'owner', sub: 'owner' })).toString('base64url');
    await expect(isOwner(withCookie(`${header}.${body}.`), SECRET)).resolves.toBe(false);
  });

  it('rejects a validly signed token without the owner role', async () => {
    const token = await new SignJWT({ role: 'guest' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('owner')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    await expect(isOwner(withCookie(token), SECRET)).resolves.toBe(false);
  });

  it('treats an unconfigured secret as signed out', async () => {
    const token = await createSessionToken(SECRET);
    await expect(isOwner(withCookie(token), undefined)).resolves.toBe(false);
  });
});

describe('LoginRateLimiter', () => {
  const options = { maxFailures: 3, windowMs: 60_000, lockoutMs: 120_000 };

  it('locks out after repeated failures, then lets the key try again', () => {
    const limiter = new LoginRateLimiter(options);
    limiter.recordFailure('ip', 0);
    limiter.recordFailure('ip', 1);
    expect(limiter.retryAfter('ip', 2)).toBe(0);
    limiter.recordFailure('ip', 2);
    expect(limiter.retryAfter('ip', 3)).toBeGreaterThan(0);
    expect(limiter.retryAfter('ip', 200_000)).toBe(0);
  });

  it('forgets failures outside the window and on success', () => {
    const limiter = new LoginRateLimiter(options);
    limiter.recordFailure('ip', 0);
    limiter.recordFailure('ip', 1);
    limiter.recordFailure('ip', 70_000);
    expect(limiter.retryAfter('ip', 70_001)).toBe(0);
    limiter.recordSuccess('ip');
    expect(limiter.retryAfter('ip')).toBe(0);
  });

  it('keeps keys independent', () => {
    const limiter = new LoginRateLimiter(options);
    for (let i = 0; i < 3; i += 1) limiter.recordFailure('a', i);
    expect(limiter.retryAfter('b', 5)).toBe(0);
  });
});
