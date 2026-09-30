// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import searchFixture from '../../shared/fixtures/mb-search-discovery.json';
import { handleLogin } from '../auth/login';
import { handleCreateDisc } from '../discs';

import { createSessionToken, hashPassword, LoginRateLimiter, SESSION_COOKIE } from './auth';
import { handleLookup } from './lookup';
import { buildReleaseQuery, createMusicBrainzClient, type MusicBrainzClient } from './musicbrainz';
import { type CollectionStore } from './store';

const SECRET = 'a-test-secret-that-is-long-enough-to-use-1234';

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'mycds.test',
      origin: 'https://mycds.test',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/login', () => {
  it('sets a hardened cookie for the right passphrase and refuses the wrong one', async () => {
    const hash = await hashPassword('the right passphrase', { N: 2 ** 10, r: 8, p: 1 });
    const limiter = new LoginRateLimiter();
    const ok = await handleLogin(
      post('https://mycds.test/api/auth/login', { passphrase: 'the right passphrase' }),
      {
        hash,
        secret: SECRET,
        limiter,
      },
    );
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');

    const bad = await handleLogin(
      post('https://mycds.test/api/auth/login', { passphrase: 'nope' }),
      {
        hash,
        secret: SECRET,
        limiter,
      },
    );
    expect(bad.status).toBe(401);
    expect(bad.headers.get('set-cookie')).toBeNull();
  });

  it('rate-limits repeated failures', async () => {
    const hash = await hashPassword('the right passphrase', { N: 2 ** 10, r: 8, p: 1 });
    const limiter = new LoginRateLimiter({ maxFailures: 2, windowMs: 60_000, lockoutMs: 60_000 });
    const attempt = () =>
      handleLogin(
        post(
          'https://mycds.test/api/auth/login',
          { passphrase: 'wrong' },
          { 'x-forwarded-for': '1.2.3.4' },
        ),
        { hash, secret: SECRET, limiter },
      );
    await attempt();
    await attempt();
    const locked = await attempt();
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).not.toBeNull();
  });

  it('refuses a cross-site request', async () => {
    const response = await handleLogin(
      post(
        'https://mycds.test/api/auth/login',
        { passphrase: 'x' },
        { origin: 'https://evil.test' },
      ),
      { hash: 'scrypt:1:1:1:a:b', secret: SECRET, limiter: new LoginRateLimiter() },
    );
    expect(response.status).toBe(403);
  });
});

describe('POST /api/discs', () => {
  const deps = {
    secret: SECRET,
    store: vi.fn<() => CollectionStore>(),
    musicbrainz: vi.fn<() => MusicBrainzClient>(),
  };

  it('rejects a caller without a session before reading the body', async () => {
    const response = await handleCreateDisc(post('https://mycds.test/api/discs', {}), deps);
    expect(response.status).toBe(401);
    expect(deps.store).not.toHaveBeenCalled();
  });

  it('rejects a forged cookie', async () => {
    const response = await handleCreateDisc(
      post('https://mycds.test/api/discs', {}, { cookie: `${SESSION_COOKIE}=forged` }),
      deps,
    );
    expect(response.status).toBe(401);
  });

  it('validates the body once signed in', async () => {
    const token = await createSessionToken(SECRET);
    const response = await handleCreateDisc(
      post(
        'https://mycds.test/api/discs',
        { mbid: 'nope' },
        { cookie: `${SESSION_COOKIE}=${token}` },
      ),
      deps,
    );
    expect(response.status).toBe(400);
  });
});

describe('GET /api/lookup/search', () => {
  it('requires a session', async () => {
    const response = await handleLookup(
      new Request('https://mycds.test/api/lookup/search?q=daft'),
      'auto',
      {
        secret: SECRET,
        musicbrainz: () => {
          throw new Error('should not be called');
        },
      },
    );
    expect(response.status).toBe(401);
  });

  it('returns ranked candidates, CDs first', async () => {
    const token = await createSessionToken(SECRET);
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(searchFixture)));
    const client = createMusicBrainzClient({
      userAgent: 'Test/1 ( t@example.com )',
      fetchImpl,
      minIntervalMs: 0,
    });
    const response = await handleLookup(
      new Request('https://mycds.test/api/lookup/search?q=daft%20punk%20discovery', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
      'auto',
      { secret: SECRET, musicbrainz: () => client },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string; candidates: { formats: string[] }[] };
    expect(body.kind).toBe('text');
    expect(body.candidates[0]?.formats).toContain('CD');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('artist%3Adaft');
    expect(new Headers(init.headers).get('user-agent')).toContain('t@example.com');
  });

  it('reports MusicBrainz being down as unavailable, not as no results', async () => {
    const token = await createSessionToken(SECRET);
    const client = createMusicBrainzClient({
      userAgent: 'Test/1 ( t@example.com )',
      fetchImpl: () => Promise.resolve(new Response('busy', { status: 503 })),
      minIntervalMs: 0,
    });
    const response = await handleLookup(
      new Request('https://mycds.test/api/lookup/search?q=anything', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
      'auto',
      { secret: SECRET, musicbrainz: () => client },
    );
    expect(response.status).toBe(503);
  });
});

describe('MusicBrainz client', () => {
  it('builds a query where every word may match artist or title', () => {
    expect(buildReleaseQuery('Daft Punk: Discovery!')).toBe(
      '(release:Daft OR artist:Daft) AND (release:Punk OR artist:Punk) AND (release:Discovery OR artist:Discovery)',
    );
    expect(buildReleaseQuery('  ')).toBeNull();
  });

  it('serialises requests and caches repeats', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return Response.json({ count: 0, releases: [] });
    });
    const client = createMusicBrainzClient({
      userAgent: 'T/1 ( t@example.com )',
      fetchImpl,
      minIntervalMs: 0,
    });
    await Promise.all([
      client.searchReleases('a b'),
      client.searchReleases('c d'),
      client.searchReleases('a b'),
    ]);
    expect(maxInFlight).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('merges barcode variants and de-duplicates by MBID', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(searchFixture)));
    const client = createMusicBrainzClient({
      userAgent: 'T/1 ( t@example.com )',
      fetchImpl,
      minIntervalMs: 0,
    });
    const candidates = await client.searchBarcode('724384960650');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new Set(candidates.map((c) => c.mbid)).size).toBe(candidates.length);
  });
});
