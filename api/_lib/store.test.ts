import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Blob from '@vercel/blob';

import { type CollectionIndex } from '../../shared/disc';

vi.mock('@vercel/blob', async (importOriginal) => {
  const actual = await importOriginal<typeof Blob>();
  return {
    BlobNotFoundError: actual.BlobNotFoundError,
    copy: vi.fn(),
    del: vi.fn(() => Promise.resolve()),
    get: vi.fn(),
    head: vi.fn(),
    put: vi.fn(),
  };
});

const blob = await import('@vercel/blob');
const { createBlobStore, INDEX_PATH } = await import('./store');

const INDEX_URL = `https://store.public.blob.vercel-storage.com/${INDEX_PATH}`;
const SNAPSHOT_URL = 'https://store.public.blob.vercel-storage.com/collection/snapshots/x-abc.json';

function index(ids: string[]): CollectionIndex {
  return {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    discs: ids.map((id) => ({
      id,
      title: id,
      artist: 'Artist',
      releaseDate: null,
      country: null,
      labels: [],
      format: 'CD',
      genres: [],
      addedAt: '2026-01-01T00:00:00.000Z',
      thumbnail: null,
      trackTitles: [],
    })),
  };
}

function served(body: unknown, etag: string) {
  return {
    statusCode: 200 as const,
    stream: new Response(JSON.stringify(body)).body,
    headers: new Headers(),
    blob: { etag },
  };
}

describe('createBlobStore().readIndex', () => {
  beforeEach(() => {
    vi.mocked(blob.head).mockReset();
    vi.mocked(blob.get).mockReset();
    vi.mocked(blob.copy).mockReset();
    vi.mocked(blob.del).mockClear();
  });

  it('uses the CDN copy when its ETag matches the origin', async () => {
    vi.mocked(blob.head).mockResolvedValue({ url: INDEX_URL, etag: '"v2"' } as never);
    vi.mocked(blob.get).mockResolvedValue(served(index(['a']), '"v2"') as never);

    const result = await createBlobStore('token').readIndex();

    expect(result.discs.map((d) => d.id)).toEqual(['a']);
    expect(blob.copy).not.toHaveBeenCalled();
  });

  it('reads origin through a throwaway copy when the CDN is stale', async () => {
    // The CDN still serves the index from before the last delete ('b' present).
    vi.mocked(blob.head).mockResolvedValue({ url: INDEX_URL, etag: '"v3"' } as never);
    vi.mocked(blob.get).mockImplementation((url: string) =>
      Promise.resolve(
        (url === SNAPSHOT_URL
          ? served(index(['a']), '"v3"')
          : served(index(['a', 'b']), '"v2"')) as never,
      ),
    );
    vi.mocked(blob.copy).mockResolvedValue({ url: SNAPSHOT_URL } as never);

    const result = await createBlobStore('token').readIndex();

    expect(result.discs.map((d) => d.id)).toEqual(['a']);
    expect(blob.copy).toHaveBeenCalledWith(
      INDEX_URL,
      expect.stringMatching(/^collection\/snapshots\//),
      expect.objectContaining({ access: 'public', addRandomSuffix: true }),
    );
    // The snapshot is cleaned up (del() is free).
    expect(blob.del).toHaveBeenCalledWith(SNAPSHOT_URL, expect.anything());
  });

  it('returns an empty index when none exists yet', async () => {
    vi.mocked(blob.head).mockRejectedValue(new blob.BlobNotFoundError());

    const result = await createBlobStore('token').readIndex();

    expect(result.discs).toEqual([]);
    expect(blob.get).not.toHaveBeenCalled();
  });
});
