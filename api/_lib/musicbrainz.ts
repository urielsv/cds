/**
 * The one module that talks to MusicBrainz.
 *
 * Enforces what their service needs from us: a descriptive User-Agent,
 * serialised requests at no more than about one per second, backing off when
 * the rate-limit headers say so, and caching — release data for an MBID is
 * effectively immutable, so repeat lookups cost nothing.
 *
 * The queue and cache are per function instance. Serverless instances share
 * outbound IPs, so this is a floor on politeness, not a guarantee.
 */

import {
  type CandidateSummary,
  type MbRelease,
  mbReleaseSchema,
  mbSearchResponseSchema,
  rankCandidates,
  toCandidate,
} from '../../shared/musicbrainz.js';
import { barcodeSearchVariants } from '../../shared/format.js';

const BASE = 'https://musicbrainz.org/ws/2/';
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 10_000;
const CACHE_LIMIT = 200;

/** Their search is down or rate-limiting us: the user should wait, not retype. */
export class MusicBrainzUnavailableError extends Error {
  readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'MusicBrainzUnavailableError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class MusicBrainzNotFoundError extends Error {
  constructor(message = 'MusicBrainz has no such release.') {
    super(message);
    this.name = 'MusicBrainzNotFoundError';
  }
}

type Fetch = typeof fetch;

export interface MusicBrainzClient {
  searchReleases: (text: string) => Promise<CandidateSummary[]>;
  searchBarcode: (barcode: string) => Promise<CandidateSummary[]>;
  lookupRelease: (mbid: string) => Promise<MbRelease>;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Builds a Lucene query where every word must appear in either the artist or
 * the release title. An unfielded query only searches titles, so
 * "daft punk discovery" would otherwise return tribute albums called
 * "Daft Punk …" ahead of the actual record — measured, not guessed.
 */
export function buildReleaseQuery(text: string): string | null {
  const terms = text
    .normalize('NFKC')
    // Lucene syntax characters would let a title like "Help!" break the query.
    .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 0 && !['and', 'or', 'not'].includes(term.toLowerCase()))
    .slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((term) => `(release:${term} OR artist:${term})`).join(' AND ');
}

export function createMusicBrainzClient(options: {
  userAgent: string;
  fetchImpl?: Fetch;
  /** Injected so tests do not wait a real second between calls. */
  minIntervalMs?: number;
}): MusicBrainzClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const minInterval = options.minIntervalMs ?? MIN_INTERVAL_MS;
  const cache = new Map<string, unknown>();
  // Identical requests already on their way share one network call.
  const inflight = new Map<string, Promise<unknown>>();
  let queue: Promise<unknown> = Promise.resolve();
  let nextAllowedAt = 0;

  const request = (path: string): Promise<unknown> => {
    const url = `${BASE}${path}`;
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    const pending = inflight.get(url);
    if (pending) return pending;

    // Chain onto the queue so requests go out one at a time, never fanned out.
    const run = queue.then(async () => {
      const wait = nextAllowedAt - Date.now();
      if (wait > 0) await sleep(wait);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { 'user-agent': options.userAgent, accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        nextAllowedAt = Date.now() + minInterval;
        throw new MusicBrainzUnavailableError('MusicBrainz did not respond.');
      }

      nextAllowedAt = Date.now() + minInterval;
      // Back off pre-emptively when they tell us the budget is spent.
      const remaining = Number(response.headers.get('x-ratelimit-remaining'));
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      if (response.headers.has('x-ratelimit-remaining') && remaining <= 0 && reset > 0) {
        nextAllowedAt = Math.max(nextAllowedAt, reset * 1000);
      }

      if (response.status === 404) throw new MusicBrainzNotFoundError();
      if (response.status === 503 || response.status === 429) {
        const retry = Number(response.headers.get('retry-after'));
        throw new MusicBrainzUnavailableError(
          'MusicBrainz is busy. Try again in a moment.',
          Number.isFinite(retry) && retry > 0 ? retry : null,
        );
      }
      if (!response.ok) {
        throw new MusicBrainzUnavailableError(`MusicBrainz answered ${String(response.status)}.`);
      }

      const body: unknown = await response.json();
      if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(url, body);
      return body;
    });

    // A failed request must not poison the queue for the next one.
    queue = run.catch(() => undefined);
    inflight.set(url, run);
    void run.finally(() => inflight.delete(url)).catch(() => undefined);
    return run;
  };

  const search = async (query: string): Promise<CandidateSummary[]> => {
    const body = await request(`release?query=${encodeURIComponent(query)}&fmt=json&limit=25`);
    return mbSearchResponseSchema.parse(body).releases.map(toCandidate);
  };

  return {
    async searchReleases(text) {
      const query = buildReleaseQuery(text);
      if (query === null) return [];
      return rankCandidates(await search(query));
    },

    async searchBarcode(barcode) {
      const merged = new Map<string, CandidateSummary>();
      // Serial by construction: each variant waits for the queue.
      for (const variant of barcodeSearchVariants(barcode)) {
        for (const candidate of await search(`barcode:${variant}`)) {
          if (!merged.has(candidate.mbid)) merged.set(candidate.mbid, candidate);
        }
      }
      return rankCandidates([...merged.values()]);
    },

    async lookupRelease(mbid) {
      const body = await request(
        `release/${encodeURIComponent(mbid)}?fmt=json&inc=recordings+artist-credits+labels+release-groups+media+discids+genres`,
      );
      return mbReleaseSchema.parse(body);
    },
  };
}
