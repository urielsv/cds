import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  colourRank,
  DEFAULT_QUERY_STATE,
  deriveFacets,
  EMPTY_FILTERS,
  findDuplicate,
  foldText,
  hexToHsl,
  matchesFilters,
  parseQueryState,
  type QueryState,
  serialiseQueryState,
  sortDiscs,
  toIndexEntry,
  uniqueDiscId,
} from './collection';
import { type Disc, type DiscIndexEntry } from './disc';

function entry(overrides: Partial<DiscIndexEntry> = {}): DiscIndexEntry {
  return {
    id: 'a',
    title: 'Discovery',
    artist: 'Daft Punk',
    releaseDate: '2001-03-12',
    country: 'FR',
    labels: ['Virgin'],
    format: 'CD',
    genres: ['house'],
    addedAt: '2026-01-01T00:00:00.000Z',
    rating: null,
    thumbnail: null,
    trackTitles: [],
    ...overrides,
  };
}

describe('foldText', () => {
  it('folds diacritics and case symmetrically', () => {
    expect(foldText('Sigur Rós')).toBe('sigur ros');
    expect(foldText('MÖTLEY CRÜE')).toBe('motley crue');
  });

  it('transliterates letters normalisation cannot decompose', () => {
    expect(foldText('Ágætis byrjun')).toBe('agaetis byrjun');
    expect(foldText('Øresund')).toBe('oresund');
  });
});

describe('matchesFilters', () => {
  it('matches everything with no filters', () => {
    expect(matchesFilters(entry(), EMPTY_FILTERS)).toBe(true);
  });

  it('ORs values within a facet', () => {
    const filters = { ...EMPTY_FILTERS, genres: ['techno', 'house'] };
    expect(matchesFilters(entry(), filters)).toBe(true);
  });

  it('ANDs across facets', () => {
    const filters = { ...EMPTY_FILTERS, genres: ['house'], countries: ['AR'] };
    expect(matchesFilters(entry(), filters)).toBe(false);
  });

  it('filters by decade', () => {
    expect(matchesFilters(entry(), { ...EMPTY_FILTERS, decades: [2000] })).toBe(true);
    expect(matchesFilters(entry(), { ...EMPTY_FILTERS, decades: [1990] })).toBe(false);
  });

  it('applies inclusive year bounds and excludes undated discs', () => {
    const bounded = { ...EMPTY_FILTERS, yearFrom: 2001, yearTo: 2001 };
    expect(matchesFilters(entry(), bounded)).toBe(true);
    expect(matchesFilters(entry({ releaseDate: '2002' }), bounded)).toBe(false);
    expect(matchesFilters(entry({ releaseDate: null }), bounded)).toBe(false);
  });

  it('treats a missing country or format as not matching a set filter', () => {
    expect(matchesFilters(entry({ country: null }), { ...EMPTY_FILTERS, countries: ['FR'] })).toBe(
      false,
    );
    expect(matchesFilters(entry({ format: null }), { ...EMPTY_FILTERS, formats: ['CD'] })).toBe(
      false,
    );
  });

  it('filters by artist and label', () => {
    expect(matchesFilters(entry(), { ...EMPTY_FILTERS, artists: ['Daft Punk'] })).toBe(true);
    expect(matchesFilters(entry(), { ...EMPTY_FILTERS, labels: ['Warp'] })).toBe(false);
  });
});

describe('activeFilterCount', () => {
  it('counts facets, not values', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(
      activeFilterCount({ ...EMPTY_FILTERS, genres: ['a', 'b'], yearFrom: 1990, yearTo: 1999 }),
    ).toBe(2);
  });
});

describe('deriveFacets', () => {
  const discs = [
    entry({ id: '1', genres: ['house', 'house'], releaseDate: '1997' }),
    entry({ id: '2', genres: ['house', 'techno'], country: 'AR', releaseDate: '2001' }),
    entry({ id: '3', genres: ['ambient'], country: null, releaseDate: null }),
  ];
  const facets = deriveFacets(discs);

  it('counts each value once per disc, most common first', () => {
    expect(facets.genres[0]).toEqual({ value: 'house', count: 2 });
    expect(facets.genres.map((g) => g.value)).toEqual(['house', 'ambient', 'techno']);
  });

  it('skips missing values', () => {
    expect(facets.countries).toEqual([
      { value: 'AR', count: 1 },
      { value: 'FR', count: 1 },
    ]);
  });

  it('orders decades chronologically and reports the year range', () => {
    expect(facets.decades).toEqual([
      { value: 1990, count: 1 },
      { value: 2000, count: 1 },
    ]);
    expect(facets.yearMin).toBe(1997);
    expect(facets.yearMax).toBe(2001);
  });

  it('handles an empty collection', () => {
    const empty = deriveFacets([]);
    expect(empty.genres).toEqual([]);
    expect(empty.yearMin).toBeNull();
  });
});

describe('sortDiscs', () => {
  const discs = [
    entry({ id: 'b', artist: 'Björk', releaseDate: '1997', addedAt: '2026-01-02T00:00:00.000Z' }),
    entry({ id: 'a', artist: 'Air', releaseDate: null, addedAt: '2026-01-03T00:00:00.000Z' }),
    entry({ id: 'c', artist: 'Cerati', releaseDate: '1993', addedAt: '2026-01-01T00:00:00.000Z' }),
  ];

  it('sorts by artist with diacritics folded', () => {
    expect(sortDiscs(discs, { key: 'artist', direction: 'asc' }).map((d) => d.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('puts missing values last in both directions', () => {
    expect(sortDiscs(discs, { key: 'year', direction: 'asc' }).map((d) => d.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(sortDiscs(discs, { key: 'year', direction: 'desc' }).map((d) => d.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('sorts newest-added first by default direction', () => {
    expect(sortDiscs(discs, { key: 'added', direction: 'desc' }).map((d) => d.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('does not mutate its input', () => {
    const before = discs.map((d) => d.id);
    sortDiscs(discs, { key: 'artist', direction: 'desc' });
    expect(discs.map((d) => d.id)).toEqual(before);
  });

  it('orders by rating, leaving unrated albums last', () => {
    const rated = [
      entry({ id: 'three', rating: 3 }),
      entry({ id: 'none', rating: null }),
      entry({ id: 'five', rating: 5 }),
    ];
    expect(sortDiscs(rated, { key: 'rating', direction: 'desc' }).map((d) => d.id)).toEqual([
      'five',
      'three',
      'none',
    ]);
  });

  it('orders by colour through the spectrum with greys after', () => {
    const coloured = [
      entry({ id: 'grey', color: '#808080' }),
      entry({ id: 'blue', color: '#0000ff' }),
      entry({ id: 'red', color: '#ff0000' }),
      entry({ id: 'none', color: null }),
      entry({ id: 'green', color: '#00ff00' }),
    ];
    expect(sortDiscs(coloured, { key: 'colour', direction: 'asc' }).map((d) => d.id)).toEqual([
      'red',
      'green',
      'blue',
      'grey',
      'none',
    ]);
  });
});

describe('colour helpers', () => {
  it('converts hex to hsl', () => {
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(hexToHsl('nope')).toBeNull();
  });

  it('ranks near-greys after every hue', () => {
    expect(colourRank('#ff00ff')).toBeLessThan(360);
    expect(colourRank('#111111')).toBeGreaterThanOrEqual(1000);
    expect(colourRank(undefined)).toBeNull();
  });
});

describe('query state', () => {
  it('serialises defaults to an empty string', () => {
    expect(serialiseQueryState(DEFAULT_QUERY_STATE)).toBe('');
  });

  it('round-trips a full state, including values with commas', () => {
    const state: QueryState = {
      query: 'daft',
      filters: {
        ...EMPTY_FILTERS,
        genres: ['house', 'techno'],
        labels: ['Sony, Argentina'],
        decades: [1990],
        yearFrom: 1995,
        yearTo: null,
      },
      sort: { key: 'colour', direction: 'asc' },
      groupMatches: true,
      wallMode: 'rating',
    };
    expect(parseQueryState(serialiseQueryState(state))).toEqual(state);
  });

  it('ignores malformed values', () => {
    const state = parseQueryState('?sort=bogus-asc&from=19x5&decade=1995');
    expect(state.sort).toEqual(DEFAULT_QUERY_STATE.sort);
    expect(state.filters.yearFrom).toBeNull();
    expect(state.filters.decades).toEqual([]);
  });
});

describe('uniqueDiscId', () => {
  it('returns the base when free and suffixes when taken', () => {
    expect(uniqueDiscId('air-moon-safari-1998', new Set(), 'x')).toBe('air-moon-safari-1998');
    expect(uniqueDiscId('air-moon-safari-1998', new Set(['air-moon-safari-1998']), 'x')).toBe(
      'air-moon-safari-1998-2',
    );
  });

  it('falls back to a seed-derived id when the slug is empty', () => {
    expect(uniqueDiscId('', new Set(), '8d28a4da-8077')).toBe('disc-8d28a4da');
  });
});

const disc: Disc = {
  id: 'daft-punk-discovery-2001',
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
  tracks: [{ position: 1, title: 'One More Time', lengthMs: 320840, artist: null }],
  images: [
    { url: 'https://x.test/big.jpg', width: 1200, height: 1200, placeholder: null, kind: 'front' },
    { url: 'https://x.test/tile.jpg', width: 500, height: 500, placeholder: null, kind: 'front' },
  ],
  genres: ['house'],
  source: {
    provider: 'musicbrainz',
    releaseMbid: 'd073287b-d1bd-4f11-a933-a4386f8cf701',
    releaseGroupMbid: null,
    fetchedAt: '2026-01-01T00:00:00.000Z',
  },
  notes: null,
  rating: 4,
  manualFields: [],
  addedAt: '2026-01-01T00:00:00.000Z',
};

describe('toIndexEntry', () => {
  it('uses the tile-sized front image and carries track titles', () => {
    const projected = toIndexEntry(disc, '#123456');
    expect(projected.thumbnail?.url).toBe('https://x.test/tile.jpg');
    expect(projected.trackTitles).toEqual(['One More Time']);
    expect(projected.color).toBe('#123456');
    expect(projected.releaseMbid).toBe(disc.source.releaseMbid);
  });

  it('allows a disc without artwork', () => {
    expect(toIndexEntry({ ...disc, images: [] }, null).thumbnail).toBeNull();
  });
});

describe('findDuplicate', () => {
  const existing = [toIndexEntry(disc, null)];

  it('matches on release MBID first', () => {
    expect(findDuplicate(existing, disc)).toEqual({ id: disc.id, reason: 'release' });
  });

  it('falls back to barcode, then artist+title+year', () => {
    const other = { ...disc, source: { ...disc.source, releaseMbid: null } };
    expect(findDuplicate(existing, other)?.reason).toBe('barcode');
    expect(findDuplicate(existing, { ...other, barcode: null })?.reason).toBe('title');
  });

  it('reports nothing for a different disc', () => {
    expect(
      findDuplicate(existing, {
        ...disc,
        title: 'Homework',
        barcode: null,
        source: { ...disc.source, releaseMbid: null },
      }),
    ).toBeNull();
  });
});
