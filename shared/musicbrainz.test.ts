import { describe, expect, it } from 'vitest';

import { hasCdMedium, isCdFormat, rankCandidates, type ReleaseCandidate } from './musicbrainz';

function candidate(overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    mbid: '00000000-0000-0000-0000-000000000000',
    title: 'Discovery',
    artist: 'Daft Punk',
    date: '2001-03-12',
    country: 'FR',
    formats: ['CD'],
    searchScore: 100,
    hasCoverArt: true,
    ...overrides,
  };
}

describe('isCdFormat', () => {
  it('accepts CD variants case-insensitively', () => {
    expect(isCdFormat('CD')).toBe(true);
    expect(isCdFormat('Enhanced CD')).toBe(true);
    expect(isCdFormat('hdcd')).toBe(true);
  });

  it('rejects non-disc formats', () => {
    expect(isCdFormat('Digital Media')).toBe(false);
    expect(isCdFormat('12" Vinyl')).toBe(false);
    expect(isCdFormat('Cassette')).toBe(false);
  });
});

describe('hasCdMedium', () => {
  it('detects a CD inside a multi-format release', () => {
    expect(hasCdMedium({ formats: ['DVD', 'CD'] })).toBe(true);
  });

  it('is false for a purely digital release', () => {
    expect(hasCdMedium({ formats: ['Digital Media'] })).toBe(false);
  });
});

describe('rankCandidates', () => {
  it('puts a physical CD above a higher-scoring digital release', () => {
    // This is the real Daft Punk barcode case: MusicBrainz returns digital
    // issues with strong search scores, and the CD must still win.
    const digital = candidate({
      mbid: 'aaaaaaaa-0000-0000-0000-000000000000',
      formats: ['Digital Media'],
      searchScore: 100,
    });
    const cd = candidate({
      mbid: 'bbbbbbbb-0000-0000-0000-000000000000',
      formats: ['CD'],
      searchScore: 60,
    });

    expect(rankCandidates([digital, cd]).map((c) => c.mbid)).toEqual([cd.mbid, digital.mbid]);
  });

  it('prefers a pressing from the collector country when formats tie', () => {
    const worldwide = candidate({ mbid: 'aaaaaaaa-0000-0000-0000-000000000000', country: 'XW' });
    const local = candidate({ mbid: 'bbbbbbbb-0000-0000-0000-000000000000', country: 'AR' });

    const ranked = rankCandidates([worldwide, local], { preferredCountry: 'AR' });
    expect(ranked[0]?.mbid).toBe(local.mbid);
  });

  it('prefers releases that have cover art', () => {
    const bare = candidate({ mbid: 'aaaaaaaa-0000-0000-0000-000000000000', hasCoverArt: false });
    const illustrated = candidate({
      mbid: 'bbbbbbbb-0000-0000-0000-000000000000',
      hasCoverArt: true,
    });

    expect(rankCandidates([bare, illustrated])[0]?.mbid).toBe(illustrated.mbid);
  });

  it('orders deterministically when candidates are otherwise identical', () => {
    const a = candidate({ mbid: 'aaaaaaaa-0000-0000-0000-000000000000' });
    const b = candidate({ mbid: 'bbbbbbbb-0000-0000-0000-000000000000' });

    expect(rankCandidates([b, a]).map((c) => c.mbid)).toEqual([a.mbid, b.mbid]);
    expect(rankCandidates([a, b]).map((c) => c.mbid)).toEqual([a.mbid, b.mbid]);
  });

  it('does not mutate the input array', () => {
    const input = [
      candidate({ mbid: 'bbbbbbbb-0000-0000-0000-000000000000', formats: ['Digital Media'] }),
      candidate({ mbid: 'aaaaaaaa-0000-0000-0000-000000000000' }),
    ];
    const snapshot = input.map((c) => c.mbid);
    rankCandidates(input);
    expect(input.map((c) => c.mbid)).toEqual(snapshot);
  });
});
