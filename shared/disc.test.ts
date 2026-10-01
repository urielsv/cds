import { describe, expect, it } from 'vitest';

import { collectionIndexSchema, discSchema } from './disc';

const disc = {
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
  genres: ['house'],
  source: {
    provider: 'musicbrainz',
    releaseMbid: null,
    releaseGroupMbid: null,
    fetchedAt: '2026-01-01T00:00:00.000Z',
  },
  notes: null,
  manualFields: [],
  addedAt: '2026-01-01T00:00:00.000Z',
};

// Ratings were dropped after documents carrying them had been written to Blob.
describe('documents written before ratings were dropped', () => {
  it('still parse as a disc, with the rating stripped', () => {
    const parsed = discSchema.parse({ ...disc, rating: 5 });
    expect(parsed).not.toHaveProperty('rating');
  });

  it('still parse as an index, with the rating stripped', () => {
    const parsed = collectionIndexSchema.parse({
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
    expect(parsed.discs[0]).not.toHaveProperty('rating');
  });
});
