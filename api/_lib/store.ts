/**
 * Storage for the collection, behind an interface so feature code does not
 * know it is Vercel Blob (and so ingest can be tested with an in-memory fake).
 *
 * Free-tier rules this file exists to keep (see `.kiro/steering/tech.md`):
 * never `list()` — the index is the listing; a bounded number of writes per
 * user action; long cache lifetimes on everything immutable; `del()` is free,
 * so clean up after any failure.
 */

import { BlobNotFoundError, del, get, put } from '@vercel/blob';

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

export function createBlobStore(token?: string): CollectionStore {
  const auth = token === undefined ? {} : { token };

  return {
    async readIndex() {
      let result: Awaited<ReturnType<typeof get>>;
      try {
        // `useCache: false` reads origin. The CDN copy may be up to a minute
        // stale, and read-modify-write from a stale copy would drop the disc
        // added just before. One origin read per add is a fair price.
        result = await get(INDEX_PATH, { access: 'public', useCache: false, ...auth });
      } catch (error) {
        if (error instanceof BlobNotFoundError) return emptyIndex(new Date());
        throw error;
      }
      if (result?.statusCode !== 200) return emptyIndex(new Date());
      const text = await new Response(result.stream).text();
      return collectionIndexSchema.parse(JSON.parse(text));
    },

    async readDisc(id) {
      try {
        const result = await get(discPath(id), { access: 'public', useCache: false, ...auth });
        if (result?.statusCode !== 200) return null;
        return discSchema.parse(JSON.parse(await new Response(result.stream).text()));
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
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
