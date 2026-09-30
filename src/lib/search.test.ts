import { describe, expect, it } from 'vitest';

import { type DiscIndexEntry } from '@shared/disc';

import { createDiscSearch } from './search';

function entry(id: string, overrides: Partial<DiscIndexEntry>): DiscIndexEntry {
  return {
    id,
    title: 'Untitled',
    artist: 'Nobody',
    releaseDate: null,
    country: null,
    labels: [],
    format: 'CD',
    genres: [],
    addedAt: '2026-01-01T00:00:00.000Z',
    rating: null,
    thumbnail: null,
    trackTitles: [],
    ...overrides,
  };
}

const discs = [
  entry('sigur', { artist: 'Sigur Rós', title: 'Ágætis byrjun', releaseDate: '1999' }),
  entry('portishead', {
    artist: 'Portishead',
    title: 'Dummy',
    trackTitles: ['Roads'],
    labels: ['Go! Beat'],
    genres: ['trip hop'],
    country: 'GB',
    releaseDate: '1994-08-22',
  }),
  entry('cerati', {
    artist: 'Gustavo Cerati',
    title: 'Bocanada',
    country: 'AR',
    labels: ['BMG'],
    releaseDate: '1999-06-08',
    format: 'Enhanced CD',
    barcode: '743216901425',
  }),
  entry('discovery', { artist: 'Daft Punk', title: 'Discovery', releaseDate: '2001' }),
  entry('homework', { artist: 'Daft Punk', title: 'Homework', releaseDate: '1997' }),
];

describe('createDiscSearch', () => {
  const search = createDiscSearch(discs);

  it('returns null for a blank query, meaning "no search"', () => {
    expect(search.match('   ')).toBeNull();
  });

  it('matches regardless of diacritics, in both directions', () => {
    expect(search.match('sigur ros')).toEqual(new Set(['sigur']));
    expect(search.match('Ágætis')).toEqual(new Set(['sigur']));
  });

  it('matches track titles', () => {
    expect(search.match('roads')?.has('portishead')).toBe(true);
  });

  it('tolerates a small typo', () => {
    expect(search.match('portshead')?.has('portishead')).toBe(true);
  });

  it('returns an empty set when nothing matches', () => {
    expect(search.match('zzzzqqq')?.size).toBe(0);
  });

  it('narrows as words are added, matching across fields', () => {
    expect(search.match('daft')).toEqual(new Set(['discovery', 'homework']));
    expect(search.match('daft discovery')).toEqual(new Set(['discovery']));
  });

  it('searches the metadata: label, genre, format and country', () => {
    expect(search.match('go! beat')?.has('portishead')).toBe(true);
    expect(search.match('trip hop')?.has('portishead')).toBe(true);
    expect(search.match('enhanced')?.has('cerati')).toBe(true);
    expect(search.match('argentina')?.has('cerati')).toBe(true);
    expect(search.match('AR')?.has('cerati')).toBe(true);
  });

  it('searches years, decades and barcodes', () => {
    expect(search.match('1997')?.has('homework')).toBe(true);
    expect(search.match('1990s')?.has('sigur')).toBe(true);
    expect(search.match('743216901425')?.has('cerati')).toBe(true);
  });

  it('combines a name with a piece of metadata', () => {
    const hits = search.match('cerati 1999');
    expect(hits).toEqual(new Set(['cerati']));
  });
});
