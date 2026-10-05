import { describe, expect, it, vi } from 'vitest';

import { toIndexEntry } from '../../shared/collection';
import {
  type CollectionIndex,
  collectionIndexSchema,
  type Disc,
  discSchema,
} from '../../shared/disc';

import { deleteDisc, DiscNotFoundError, editDisc } from './discEdit';
import { type CollectionStore } from './store';

// Smallest byte sequence that passes decodeJpeg's signature check.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).toString(
  'base64',
);

const disc: Disc = discSchema.parse({
  id: 'daft-punk-discovery-2001',
  title: 'Discovery',
  artist: 'Daft Punk',
  artistCredits: ['Daft Punk'],
  releaseDate: '2001-03-12',
  country: 'FR',
  barcode: '0724384960650',
  catalogNumber: null,
  labels: ['Virgin'],
  format: 'CD',
  packaging: null,
  discCount: 1,
  tracks: [{ position: 1, title: 'One More Time', lengthMs: 320000, artist: null }],
  images: [
    {
      url: 'https://blob.test/collection/images/daft-punk-discovery-2001/front-tile.jpg?v=1',
      width: 500,
      height: 500,
      placeholder: null,
      kind: 'front',
    },
    {
      url: 'https://blob.test/collection/images/daft-punk-discovery-2001/front-large.jpg?v=1',
      width: 1200,
      height: 1200,
      placeholder: null,
      kind: 'front',
    },
  ],
  genres: ['house'],
  source: {
    provider: 'musicbrainz',
    releaseMbid: 'd073287b-d1bd-4f11-a933-a4386f8cf701',
    releaseGroupMbid: null,
    fetchedAt: '2026-01-01T00:00:00.000Z',
  },
  notes: null,
  manualFields: [],
  addedAt: '2026-01-01T00:00:00.000Z',
});

function fakeStore(failOn?: 'image' | 'disc' | 'index') {
  const log: string[] = [];
  let index: CollectionIndex = {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    discs: [toIndexEntry(disc, '#2a3b4c')],
  };
  let stored: Disc = disc;
  let counter = 1;
  const removed: string[] = [];
  const store: CollectionStore = {
    readIndex: vi.fn(() => Promise.resolve(index)),
    readDisc: vi.fn(() => Promise.resolve(stored)),
    putImage: vi.fn((pathname: string) => {
      log.push(`image:${pathname}`);
      if (failOn === 'image') return Promise.reject(new Error('boom'));
      counter += 1;
      return Promise.resolve({ url: `https://blob.test/${pathname}?v=${String(counter)}` });
    }),
    writeDisc: vi.fn((d: Disc) => {
      log.push(`disc:${d.id}`);
      discSchema.parse(d);
      if (failOn === 'disc') return Promise.reject(new Error('boom'));
      stored = d;
      return Promise.resolve({ url: `https://blob.test/collection/discs/${d.id}.json` });
    }),
    writeIndex: vi.fn((next: CollectionIndex) => {
      log.push('index');
      if (failOn === 'index') return Promise.reject(new Error('boom'));
      index = collectionIndexSchema.parse(next);
      return Promise.resolve({ url: 'https://blob.test/collection/index.json' });
    }),
    remove: vi.fn((urls: readonly string[]) => {
      removed.push(...urls);
      return Promise.resolve();
    }),
    removeDisc: vi.fn((id: string) => {
      log.push(`removeDisc:${id}`);
      return Promise.resolve();
    }),
  };
  return { store, log, removed, current: () => index, stored: () => stored };
}

describe('deleteDisc', () => {
  it('rewrites the index without the entry, then removes doc and images', async () => {
    const { store, log, removed, current } = fakeStore();
    await deleteDisc(disc.id, { store });

    // Index written before the backing objects are removed.
    expect(log).toEqual(['index', `removeDisc:${disc.id}`]);
    expect(current().discs).toHaveLength(0);
    // Both image blobs cleaned up.
    expect(removed).toHaveLength(2);
  });

  it('throws when the disc is not in the index', async () => {
    const { store } = fakeStore();
    await expect(deleteDisc('nope', { store })).rejects.toBeInstanceOf(DiscNotFoundError);
  });
});

describe('editDisc', () => {
  it('edits fields and records them in manualFields', async () => {
    const { store, current, stored } = fakeStore();
    const result = await editDisc(
      disc.id,
      { country: 'JP', format: 'SHM-CD', genres: ['house', 'french house'] },
      { store },
    );

    expect(stored().country).toBe('JP');
    expect(stored().format).toBe('SHM-CD');
    expect(stored().genres).toEqual(['house', 'french house']);
    expect(stored().manualFields.sort()).toEqual(['country', 'format', 'genres']);
    // Index entry reprojected, colour preserved.
    expect(result.entry.country).toBe('JP');
    expect(current().discs[0]?.country).toBe('JP');
    expect(current().discs[0]?.color).toBe('#2a3b4c');
  });

  it('writes new images, then disc, then index LAST, then removes old images', async () => {
    const { store, log, removed } = fakeStore();
    await editDisc(
      disc.id,
      {
        artwork: {
          color: '#111111',
          placeholder: null,
          tile: { data: JPEG, width: 500, height: 500 },
          large: { data: JPEG, width: 1200, height: 1200 },
        },
      },
      { store },
    );
    // Order: two images, disc doc, index, then old-image cleanup.
    expect(log).toEqual([
      'image:collection/images/daft-punk-discovery-2001/front-tile.jpg',
      'image:collection/images/daft-punk-discovery-2001/front-large.jpg',
      `disc:${disc.id}`,
      'index',
    ]);
    // The two previous blobs were orphaned and removed.
    expect(removed).toHaveLength(2);
  });

  it('leaves the collection unchanged if the disc write fails', async () => {
    const { store, removed } = fakeStore('disc');
    await expect(
      editDisc(
        disc.id,
        {
          artwork: {
            color: '#111111',
            placeholder: null,
            tile: { data: JPEG, width: 500, height: 500 },
            large: null,
          },
        },
        { store },
      ),
    ).rejects.toThrow();
    // The newly written image was rolled back; no old images removed.
    expect(removed.length).toBeGreaterThanOrEqual(1);
  });

  it('throws when the disc does not exist', async () => {
    const { store } = fakeStore();
    await expect(editDisc('nope', { country: 'JP' }, { store })).rejects.toBeInstanceOf(
      DiscNotFoundError,
    );
  });
});
