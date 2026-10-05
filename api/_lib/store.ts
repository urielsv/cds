/**
 * Storage for the collection, behind an interface so feature code does not
 * know it is Vercel Blob (and so ingest can be tested with an in-memory fake).
 *
 * Free-tier rules this file exists to keep (see `.kiro/steering/tech.md`):
 * never `list()` — the index is the listing; a bounded number of writes per
 * user action; long cache lifetimes on everything immutable; `del()` is free,
 * so clean up after any failure.
 */

import { BlobNotFoundError, copy, del, get, head, put } from '@vercel/blob';

import {
  type CollectionIndex,
  collectionIndexSchema,
  type Disc,
  discSchema,
} from '../../shared/disc.js';

export const INDEX_PATH = 'collection/index.json';
export const discPath = (id: string) => `collection/discs/${id}.json`;

export interface StoredObject {
  url: string;
}

export interface CollectionStore {
  /** The current index, read from origin (not the CDN) so a write never loses an add. */
  readIndex: () => Promise<CollectionIndex>;
  /** One disc's full record, or null when it has none stored yet. */
  readDisc: (id: string) => Promise<Disc | null>;
  putImage: (pathname: string, bytes: Uint8Array) => Promise<StoredObject>;
  writeDisc: (disc: Disc) => Promise<StoredObject>;
  writeIndex: (index: CollectionIndex) => Promise<StoredObject>;
  remove: (urls: readonly string[]) => Promise<void>;
  /** Deletes a disc's full document by id. del() is free; a no-op if absent. */
  removeDisc: (id: string) => Promise<void>;
}

const YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * The index is overwritten on every add, so its CDN lifetime is the delay
 * before a visitor sees a new disc. One minute is Blob's minimum.
 */
const INDEX_CACHE_SECONDS = 60;

/**
 * Disc documents can now be edited in place (cover, country, format, genres),
 * so they are no longer immutable and must not be cached for a year or an edit
 * would be served stale for that long. They are read only when a disc is
 * opened — never on the hot shelf path — so a short lifetime matching the index
 * costs little. The client also busts its in-memory cache on an edit.
 */
const DISC_CACHE_SECONDS = 60;

export function emptyIndex(now: Date): CollectionIndex {
  return { version: 1, generatedAt: now.toISOString(), discs: [] };
}

/** Where `readFresh` parks its throwaway copies. Never referenced by the index. */
const SNAPSHOT_PREFIX = 'collection/snapshots/';

/** ETags compared loosely: the CDN and the API may differ on quoting or `W/`. */
function sameEtag(a: string, b: string): boolean {
  const bare = (tag: string) => tag.replace(/^W\//, '').replace(/"/g, '');
  return a.length > 0 && bare(a) === bare(b);
}

interface Auth {
  token?: string;
}

/**
 * The text of a mutable public blob as it is at origin right now, or null if
 * it does not exist.
 *
 * Every read-modify-write of the index (and of a disc document) needs this.
 * `get(..., { useCache: false })` looks like the answer but is honoured only
 * for PRIVATE stores — the SDK sends it as `?cache=0` for private access and
 * silently ignores it for public — and this store is public. A plain `get()`
 * therefore returns the CDN copy, which lags an overwrite by up to 60 seconds,
 * and writing back from it undoes whatever changed in that minute: delete one
 * disc, then delete another, and the first comes back.
 *
 * So: `head()` (a simple operation) reports the origin's current ETag. If the
 * CDN copy carries the same one it is current and is used as is — the common
 * case, since writes are minutes apart. Otherwise the blob is copied inside
 * the store, from origin, to a random pathname the CDN has never seen, read
 * once (a guaranteed cache miss, so origin content), and deleted (free). That
 * costs one advanced operation, and only when the CDN really is stale.
 */
async function readFresh(pathname: string, auth: Auth): Promise<string | null> {
  let current: Awaited<ReturnType<typeof head>>;
  try {
    current = await head(pathname, auth);
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }

  const cached = await get(pathname, { access: 'public', ...auth }).catch(() => null);
  if (cached?.statusCode === 200 && sameEtag(cached.blob.etag, current.etag)) {
    return new Response(cached.stream).text();
  }
  if (cached?.statusCode === 200) await cached.stream.cancel();

  const snapshot = await copy(current.url, `${SNAPSHOT_PREFIX}${pathname}`, {
    access: 'public',
    addRandomSuffix: true,
    ...auth,
  });
  try {
    const fresh = await get(snapshot.url, { access: 'public', ...auth });
    if (fresh?.statusCode !== 200) throw new Error(`Could not read a fresh copy of ${pathname}.`);
    return await new Response(fresh.stream).text();
  } finally {
    await del(snapshot.url, auth).catch(() => undefined);
  }
}

export function createBlobStore(token?: string): CollectionStore {
  const auth = token === undefined ? {} : { token };

  return {
    async readIndex() {
      // Origin, not the CDN: a stale copy written back would undo the last
      // minute's adds and deletes. See `readFresh`.
      const text = await readFresh(INDEX_PATH, auth);
      if (text === null) return emptyIndex(new Date());
      return collectionIndexSchema.parse(JSON.parse(text));
    },

    async readDisc(id) {
      // Origin too: an edit builds on this document, and a delete reads it to
      // find every image blob to remove — including a cover replaced moments ago.
      const text = await readFresh(discPath(id), auth);
      return text === null ? null : discSchema.parse(JSON.parse(text));
    },

    async putImage(pathname, bytes) {
      // A random suffix gives every image a unique URL: cache-busting by URL,
      // so images can be cached for a year and a replacement is a new file.
      const blob = await put(pathname, Buffer.from(bytes), {
        access: 'public',
        addRandomSuffix: true,
        contentType: 'image/jpeg',
        cacheControlMaxAge: YEAR_SECONDS,
        ...auth,
      });
      return { url: blob.url };
    },

    async writeDisc(disc) {
      const blob = await put(discPath(disc.id), JSON.stringify(disc), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        // Short-lived: disc docs are mutable now (edit flow), so a stale CDN
        // copy must expire quickly rather than linger for a year.
        cacheControlMaxAge: DISC_CACHE_SECONDS,
        ...auth,
      });
      return { url: blob.url };
    },

    async writeIndex(index) {
      const blob = await put(INDEX_PATH, JSON.stringify(index), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: INDEX_CACHE_SECONDS,
        ...auth,
      });
      return { url: blob.url };
    },

    async remove(urls) {
      if (urls.length === 0) return;
      await del([...urls], auth);
    },

    async removeDisc(id) {
      // del() by pathname is free and idempotent — deleting an absent blob is
      // not an error — so callers can remove a disc document unconditionally.
      await del(discPath(id), auth);
    },
  };
}
