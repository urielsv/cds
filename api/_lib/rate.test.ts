// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  type CollectionIndex,
  collectionIndexSchema,
  type Disc,
  discSchema,
} from '../../shared/disc';
import { handlePatchDisc } from '../discs/[id]';

import { createSessionToken, SESSION_COOKIE } from './auth';
import { DiscNotFoundError, rateDisc } from './rate';
import { type CollectionStore } from './store';

const SECRET = 'a-test-secret-that-is-long-enough-to-use-1234';

const disc: Disc = discSchema.parse({
  id: 'daft-punk-discovery-2001',
  title: 'Discovery',
  artist: 'Daft Punk',
  artistCredits: ['Daft Punk'],
  releaseDate: '2001-02-26',
  country: 'FR',
  barcode: null,
  catalogNumber: null,
  labels: ['Virgin'],
  format: 'CD',
  packaging: null,
  discCount: 1,
  tracks: [],
  images: [],
  genres: [],
  source: {
    provider: 'musicbrainz',
    releaseMbid: null,
    releaseGroupMbid: null,
    fetchedAt: '2026-01-01T00:00:00.000Z',
  },
  notes: null,
  rating: null,
  manualFields: [],
  addedAt: '2026-01-01T00:00:00.000Z',
});

function fakeStore(options: { withDocument?: boolean } = {}) {
  const log: string[] = [];
  let index: CollectionIndex = collectionIndexSchema.parse({
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    discs: [
      {
        id: disc.id,
        title: disc.title,
        artist: disc.artist,
        releaseDate: disc.releaseDate,
        country: disc.country,
        labels: disc.labels,
        format: disc.format,
        genres: disc.genres,
        addedAt: disc.addedAt,
        rating: null,
        thumbnail: null,
        trackTitles: [],
      },
    ],
  });
  let document: Disc | null = options.withDocument === false ? null : disc;

  const store: CollectionStore = {
    readIndex: vi.fn(() => Promise.resolve(index)),
    readDisc: vi.fn(() => Promise.resolve(document)),
    putImage: vi.fn(),
    writeDisc: vi.fn((next: Disc) => {
      log.push('disc');
      document = next;
      return Promise.resolve({ url: 'https://blob.test/disc.json' });
    }),
    writeIndex: vi.fn((next: CollectionIndex) => {
      log.push('index');
      index = next;
      return Promise.resolve({ url: 'https://blob.test/index.json' });
    }),
    remove: vi.fn(() => Promise.resolve()),
  };
  return { store, log, index: () => index, document: () => document };
}

describe('rateDisc', () => {
  it('writes the record before the index, and updates both', async () => {
    const fake = fakeStore();
    const entry = await rateDisc(disc.id, 5, { store: fake.store });
    expect(fake.log).toEqual(['disc', 'index']);
    expect(entry.rating).toBe(5);
    expect(fake.index().discs[0]?.rating).toBe(5);
    expect(fake.document()?.rating).toBe(5);
  });

  it('clears a rating', async () => {
    const fake = fakeStore();
    await rateDisc(disc.id, 4, { store: fake.store });
    await rateDisc(disc.id, null, { store: fake.store });
    expect(fake.index().discs[0]?.rating).toBeNull();
  });

  it('reads the index once per rating', async () => {
    const fake = fakeStore();
    await rateDisc(disc.id, 3, { store: fake.store });
    expect(fake.store.readIndex).toHaveBeenCalledTimes(1);
  });

  it('still rates a disc whose full record is missing', async () => {
    const fake = fakeStore({ withDocument: false });
    await rateDisc(disc.id, 2, { store: fake.store });
    expect(fake.log).toEqual(['index']);
    expect(fake.index().discs[0]?.rating).toBe(2);
  });

  it('refuses an unknown disc', async () => {
    const fake = fakeStore();
    await expect(rateDisc('nope', 3, { store: fake.store })).rejects.toThrow(DiscNotFoundError);
  });
});

function patch(id: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://mycds.test/api/discs/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      host: 'mycds.test',
      origin: 'https://mycds.test',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/discs/:id', () => {
  it('rejects a caller without a session before touching storage', async () => {
    const store = vi.fn<() => CollectionStore>();
    const response = await handlePatchDisc(patch(disc.id, { rating: 5 }), {
      secret: SECRET,
      store,
    });
    expect(response.status).toBe(401);
    expect(store).not.toHaveBeenCalled();
  });

  it('rates a disc for the owner', async () => {
    const fake = fakeStore();
    const token = await createSessionToken(SECRET);
    const response = await handlePatchDisc(
      patch(disc.id, { rating: 5 }, { cookie: `${SESSION_COOKIE}=${token}` }),
      { secret: SECRET, store: () => fake.store },
    );
    expect(response.status).toBe(200);
    expect(fake.index().discs[0]?.rating).toBe(5);
  });

  it('refuses a rating outside one to five', async () => {
    const token = await createSessionToken(SECRET);
    const response = await handlePatchDisc(
      patch(disc.id, { rating: 9 }, { cookie: `${SESSION_COOKIE}=${token}` }),
      { secret: SECRET, store: () => fakeStore().store },
    );
    expect(response.status).toBe(400);
  });

  it('reports an unknown disc as not found', async () => {
    const token = await createSessionToken(SECRET);
    const response = await handlePatchDisc(
      patch('no-such-disc', { rating: 3 }, { cookie: `${SESSION_COOKIE}=${token}` }),
      { secret: SECRET, store: () => fakeStore().store },
    );
    expect(response.status).toBe(404);
  });
});
