import { describe, expect, it } from 'vitest';

import releaseFixture from './fixtures/mb-release-discovery-fr-cd.json';
import barcodeFixture from './fixtures/mb-search-barcode-724384960650.json';
import searchFixture from './fixtures/mb-search-discovery.json';
import {
  flattenArtistCredit,
  mapRelease,
  mbReleaseSchema,
  mbSearchResponseSchema,
  pickGenres,
  rankCandidates,
  toCandidate,
} from './musicbrainz';

/*
 * Fixtures are real MusicBrainz responses recorded on 2026-09-29 and trimmed of
 * fields we do not map. See `shared/fixtures/`.
 */

const release = mbReleaseSchema.parse(releaseFixture);

describe('search response mapping', () => {
  it('parses a real barcode search', () => {
    const parsed = mbSearchResponseSchema.parse(barcodeFixture);
    expect(parsed.releases).toHaveLength(2);
  });

  it('maps a search hit into a displayable candidate', () => {
    const parsed = mbSearchResponseSchema.parse(searchFixture);
    const french = parsed.releases.find((r) => r.id === 'd073287b-d1bd-4f11-a933-a4386f8cf701');
    expect(french).toBeDefined();
    const candidate = toCandidate(french!);
    expect(candidate).toMatchObject({
      title: 'Discovery',
      artist: 'Daft Punk',
      date: '2001-02-26',
      country: 'FR',
      formats: ['CD'],
      labels: ['Virgin'],
      catalogNumber: '8496062',
      trackCount: 14,
      barcode: '724384960629',
    });
  });

  it('ranks neither digital issue of the barcode as a CD', () => {
    const parsed = mbSearchResponseSchema.parse(barcodeFixture);
    const ranked = rankCandidates(parsed.releases.map(toCandidate));
    expect(ranked.every((c) => c.formats.includes('Digital Media'))).toBe(true);
  });
});

describe('flattenArtistCredit', () => {
  it('joins collaborations with their join phrases', () => {
    expect(
      flattenArtistCredit([
        { name: 'Jay-Z', joinphrase: ' & ' },
        { name: 'Linkin Park', joinphrase: '' },
      ]),
    ).toBe('Jay-Z & Linkin Park');
  });

  it('falls back when the credit is missing', () => {
    expect(flattenArtistCredit(undefined)).toBe('Unknown Artist');
  });
});

describe('pickGenres', () => {
  it('prefers release-level genres, most voted first', () => {
    expect(pickGenres(release)).toEqual(['electronic', 'house']);
  });

  it('falls back to the release group and drops single-vote tags', () => {
    const genres = pickGenres({ ...release, genres: [] });
    expect(genres[0]).toBe('house');
    expect(genres).not.toContain('boogie');
    expect(genres).toHaveLength(5);
  });
});

describe('mapRelease', () => {
  const disc = mapRelease(release, {
    id: 'daft-punk-discovery-2001',
    now: '2026-09-29T12:00:00.000Z',
    notes: '  ',
  });

  it('maps the pressing details', () => {
    expect(disc).toMatchObject({
      title: 'Discovery',
      artist: 'Daft Punk',
      artistCredits: ['Daft Punk'],
      releaseDate: '2001-02-26',
      country: 'FR',
      barcode: '724384960629',
      catalogNumber: '8496062',
      labels: ['Virgin'],
      format: 'CD',
      packaging: 'Jewel Case',
      discCount: 1,
      notes: null,
    });
    expect(disc.source.releaseMbid).toBe('d073287b-d1bd-4f11-a933-a4386f8cf701');
  });

  it('keeps every track with its duration', () => {
    expect(disc.tracks).toHaveLength(14);
    expect(disc.tracks[0]).toEqual({
      position: 1,
      title: 'One More Time',
      lengthMs: 320840,
      artist: null,
    });
  });

  it('counts discs from media and numbers tracks continuously', () => {
    const medium = release.media![0]!;
    const twoDisc = mapRelease(
      { ...release, media: [medium, { ...medium, format: 'CD', position: 2 }] },
      { id: 'x', now: '2026-09-29T12:00:00.000Z' },
    );
    expect(twoDisc.discCount).toBe(2);
    expect(twoDisc.tracks.at(-1)?.position).toBe(28);
  });

  it('survives a sparse release', () => {
    const sparse = mapRelease(
      {
        id: 'd073287b-d1bd-4f11-a933-a4386f8cf701',
        title: 'Untitled',
        country: 'XW',
        date: '1999',
      },
      { id: 'sparse', now: '2026-09-29T12:00:00.000Z' },
    );
    expect(sparse).toMatchObject({
      artist: 'Unknown Artist',
      releaseDate: '1999',
      discCount: 1,
      format: null,
      tracks: [],
      genres: [],
    });
  });
});
