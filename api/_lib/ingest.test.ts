// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import releaseFixture from '../../shared/fixtures/mb-release-discovery-fr-cd.json';
import {
  type CollectionIndex,
  collectionIndexSchema,
  type Disc,
  discSchema,
} from '../../shared/disc';
import { mbReleaseSchema } from '../../shared/musicbrainz';

import { decodeJpeg, ingestDisc, type IngestRequest } from './ingest';
import { type MusicBrainzClient } from './musicbrainz';
import { type CollectionStore, emptyIndex } from './store';

const MBID = 'd073287b-d1bd-4f11-a933-a4386f8cf701';
// The smallest byte sequence that passes the JPEG signature check.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).toString(
  'base64',
);

function fakeMusicBrainz(): MusicBrainzClient {
  return {
    searchReleases: vi.fn(),
    searchBarcode: vi.fn(),
    lookupRelease: vi.fn(() => Promise.resolve(mbReleaseSchema.parse(releaseFixture))),
  };
}

function fakeStore(initial: CollectionIndex, failOn?: 'image' | 'disc' | 'index') {
  const log: string[] = [];
  let index = initial;
  let counter = 0;
  const store: CollectionStore = {
    readIndex: vi.fn(() => Promise.resolve(index)),
    readDisc: vi.fn(() => Promise.resolve(null)),
    putImage: vi.fn((pathname: string) => {
      log.push(`image:${pathname}`);
      if (failOn === 'image') return Promise.reject(new Error('boom'));
      counter += 1;
      return Promise.resolve({ url: `https://blob.test/${pathname}?v=${String(counter)}` });
    }),
    writeDisc: vi.fn((disc: Disc) => {
      log.push(`disc:${disc.id}`);
      discSchema.parse(disc);
      if (failOn === 'disc') return Promise.reject(new Error('boom'));
      return Promise.resolve({ url: `https://blob.test/collection/discs/${disc.id}.json` });
    }),
    writeIndex: vi.fn((next: CollectionIndex) => {
      log.push('index');
      if (failOn === 'index') return Promise.reject(new Error('boom'));
      index = collectionIndexSchema.parse(next);
      return Promise.resolve({ url: 'https://blob.test/collection/index.json' });
    }),
    remove: vi.fn(() => Promise.resolve()),
  };
  return { store, log, current: () => index };
}

const request: IngestRequest = {
  mbid: MBID,
  notes: 'Bought in Paris',
  artwork: {
    color: '#2a3b4c',
    placeholder: 'data:image/jpeg;base64,AAAA',
    tile: { data: JPEG, width: 500, height: 500 },
    large: { data: JPEG, width: 1200, height: 1200 },
  },
};

const now = () => new Date('2026-09-29T12:00:00.000Z');

describe('ingestDisc', () => {
  it('writes images, then the disc document, and the index last', async () => {
    const { store, log, current } = fakeStore(emptyIndex(now()));
    const result = await ingestDisc(request, { store, musicbrainz: fakeMusicBrainz(), now });

    expect(log).toEqual([
      'image:collection/images/daft-punk-discovery-2001/front-tile.jpg',
      'image:collection/images/daft-punk-discovery-2001/front-large.jpg',
      'disc:daft-punk-discovery-2001',
      'index',
    ]);
    expect(result.kind).toBe('created');
    expect(current().discs[0]).toMatchObject({
      id: 'daft-punk-discovery-2001',
      color: '#2a3b4c',
      releaseMbid: MBID,
    });
    expect(current().discs[0]?.thumbnail?.width).toBe(500);
  });

  it('reads the index exactly once', async () => {
    const { store } = fakeStore(emptyIndex(now()));
    await ingestDisc(request, { store, musicbrainz: fakeMusicBrainz(), now });
    expect(store.readIndex).toHaveBeenCalledTimes(1);
  });

  it.each(['image', 'disc', 'index'] as const)(
    'leaves the index untouched and cleans up when the %s write fails',
    async (failOn) => {
      const initial = emptyIndex(now());
      const { store, current } = fakeStore(initial, failOn);
      await expect(
        ingestDisc(request, { store, musicbrainz: fakeMusicBrainz(), now }),
      ).rejects.toThrow('boom');
      expect(current()).toBe(initial);
      if (failOn !== 'image') expect(store.remove).toHaveBeenCalled();
    },
  );

  it('warns about a duplicate instead of writing, unless told to go ahead', async () => {
    const { store, current } = fakeStore(emptyIndex(now()));
    await ingestDisc(request, { store, musicbrainz: fakeMusicBrainz(), now });

    const again = await ingestDisc(request, { store, musicbrainz: fakeMusicBrainz(), now });
    expect(again).toMatchObject({ kind: 'duplicate', reason: 'release' });
    expect(current().discs).toHaveLength(1);

    const forced = await ingestDisc(
      { ...request, allowDuplicate: true },
      { store, musicbrainz: fakeMusicBrainz(), now },
    );
    expect(forced.kind).toBe('created');
    expect(current().discs.map((d) => d.id)).toEqual([
      'daft-punk-discovery-2001-2',
      'daft-punk-discovery-2001',
    ]);
  });

  it('saves a disc with no artwork', async () => {
    const { store, log, current } = fakeStore(emptyIndex(now()));
    await ingestDisc({ ...request, artwork: null }, { store, musicbrainz: fakeMusicBrainz(), now });
    expect(log).toEqual(['disc:daft-punk-discovery-2001', 'index']);
    expect(current().discs[0]?.thumbnail).toBeNull();
  });

  it('refuses artwork that is not a JPEG before touching storage', async () => {
    const { store } = fakeStore(emptyIndex(now()));
    const bad = {
      ...request,
      artwork: {
        ...request.artwork!,
        tile: { data: Buffer.from('<svg/>').toString('base64'), width: 500, height: 500 },
      },
    };
    await expect(ingestDisc(bad, { store, musicbrainz: fakeMusicBrainz(), now })).rejects.toThrow(
      'JPEG',
    );
    expect(store.readIndex).not.toHaveBeenCalled();
  });
});

describe('decodeJpeg', () => {
  it('accepts JPEG bytes', () => {
    expect(decodeJpeg(JPEG)[0]).toBe(0xff);
  });
});
