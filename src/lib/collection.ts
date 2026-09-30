import { type CollectionIndex, collectionIndexSchema, type Disc, discSchema } from '@shared/disc';

export interface LoadedCollection {
  index: CollectionIndex;
  /** True when showing the generated demo collection rather than real data. */
  isDemo: boolean;
}

/**
 * Loads the collection index once per session.
 *
 * The browser reads the public Blob URL directly rather than going through a
 * function: reads are then plain CDN hits, free and without a cold start. The
 * URL is public by nature, so a `VITE_` variable is the right place for it.
 *
 * With no URL configured (local development, or a fresh deployment before the
 * store is linked) the wall shows the demo collection: 200-odd real albums with
 * real metadata and real cover art, built by `scripts/seed-demo.mjs`. It is
 * loaded through a dynamic import so it never weighs on a real deployment's
 * bundle.
 */
export async function loadCollection(signal?: AbortSignal): Promise<LoadedCollection> {
  const url = import.meta.env.VITE_COLLECTION_INDEX_URL;

  if (url === undefined || url.length === 0) {
    const demo = await import('@/dev/demoCollection.json');
    return { index: collectionIndexSchema.parse(demo.default), isDemo: true };
  }

  const response = await fetch(url, signal ? { signal } : {});
  // A brand new store has no index until the first disc is added.
  if (response.status === 404) {
    return {
      index: { version: 1, generatedAt: new Date().toISOString(), discs: [] },
      isDemo: false,
    };
  }
  if (!response.ok) {
    throw new Error(`The collection could not be loaded (HTTP ${String(response.status)}).`);
  }

  // Validate at the boundary: a stored document is external input too.
  const index = collectionIndexSchema.parse(await response.json());
  return { index, isDemo: false };
}

/**
 * Disc documents already fetched this session. They are immutable, so a disc
 * opened a second time shows its full detail at once instead of fetching (and
 * briefly showing the index-only view) again. Failures are not kept, so a
 * dropped request is retried the next time the disc is opened.
 */
const discCache = new Map<string, Promise<Disc | null>>();

export function loadDisc(id: string, signal?: AbortSignal): Promise<Disc | null> {
  const cached = discCache.get(id);
  if (cached) return cached;
  // Not tied to the caller's signal: closing the panel should not throw away
  // a response that is about to arrive and would serve the next opening.
  const request = fetchDisc(id);
  discCache.set(id, request);
  request.catch(() => {
    discCache.delete(id);
  });
  if (!signal) return request;
  return new Promise<Disc | null>((resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(new DOMException('The request was cancelled.', 'AbortError'));
      },
      { once: true },
    );
    request.then(resolve, reject);
  });
}

/**
 * Fetches the full record for one disc — track durations, catalogue number,
 * barcode, notes — which the index deliberately leaves out.
 *
 * Disc documents live beside the index (`collection/discs/<id>.json`) and are
 * immutable, so this is a long-cached CDN hit. Returns null in demo mode, where
 * the index entry is all there is.
 */
async function fetchDisc(id: string): Promise<Disc | null> {
  const indexUrl = import.meta.env.VITE_COLLECTION_INDEX_URL;
  if (indexUrl === undefined || indexUrl.length === 0) return null;

  const url = new URL(`discs/${encodeURIComponent(id)}.json`, indexUrl);
  const response = await fetch(url);
  // A missing document is an answer; anything else is worth asking again.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The disc could not be loaded (${String(response.status)}).`);
  return discSchema.parse(await response.json());
}
