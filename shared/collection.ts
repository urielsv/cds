/**
 * Filtering, faceting, sorting and URL-state helpers for the in-memory
 * collection.
 *
 * Everything here runs on the whole collection on the device (requirement 8.4:
 * browsing makes no network calls), so it is pure and allocation-light. Fuzzy
 * text search lives in `src/lib/search.ts` because it wraps Fuse.js; this module
 * only handles the structured part of a query.
 */

import { type Disc, type DiscImage, type DiscIndexEntry } from './disc.js';
import { releaseYear } from './format.js';

// ---------------------------------------------------------------------------
// Text folding
// ---------------------------------------------------------------------------

/**
 * Lower-cases and strips diacritics so "Sigur Ros" finds "Sigur Rós" and the
 * reverse (requirement 3.4). Applied symmetrically to the query and the data.
 */
export function foldText(value: string): string {
  return value
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/ð|đ/g, 'd')
    .replace(/þ/g, 'th')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface Filters {
  /** Decade starts, e.g. `1990`. OR within the list. */
  decades: readonly number[];
  /** Inclusive year bounds. A disc with no known year fails any bound. */
  yearFrom: number | null;
  yearTo: number | null;
  genres: readonly string[];
  artists: readonly string[];
  labels: readonly string[];
  countries: readonly string[];
  formats: readonly string[];
}

export const EMPTY_FILTERS: Filters = {
  decades: [],
  yearFrom: null,
  yearTo: null,
  genres: [],
  artists: [],
  labels: [],
  countries: [],
  formats: [],
};

/** The multi-select facets, in the order the filter panel shows them. */
export const FACET_KEYS = ['genres', 'artists', 'labels', 'countries', 'formats'] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

/** Number of independent constraints the user has set, for the badge. */
export function activeFilterCount(filters: Filters): number {
  let count = filters.decades.length > 0 ? 1 : 0;
  if (filters.yearFrom !== null || filters.yearTo !== null) count += 1;
  for (const key of FACET_KEYS) {
    if (filters[key].length > 0) count += 1;
  }
  return count;
}

function intersects(values: readonly string[], wanted: readonly string[]): boolean {
  return values.some((value) => wanted.includes(value));
}

/**
 * True when the disc satisfies every facet. Facets combine with AND; values
 * within one facet combine with OR, which is what people expect from a
 * "genre: house, techno" style filter.
 */
export function matchesFilters(disc: DiscIndexEntry, filters: Filters): boolean {
  const year = releaseYear(disc.releaseDate);

  if (filters.decades.length > 0) {
    if (year === null || !filters.decades.includes(Math.floor(year / 10) * 10)) return false;
  }
  if (filters.yearFrom !== null && (year === null || year < filters.yearFrom)) return false;
  if (filters.yearTo !== null && (year === null || year > filters.yearTo)) return false;

  if (filters.genres.length > 0 && !intersects(disc.genres, filters.genres)) return false;
  if (filters.artists.length > 0 && !filters.artists.includes(disc.artist)) return false;
  if (filters.labels.length > 0 && !intersects(disc.labels, filters.labels)) return false;
  if (
    filters.countries.length > 0 &&
    (disc.country === null || !filters.countries.includes(disc.country))
  ) {
    return false;
  }
  if (
    filters.formats.length > 0 &&
    (disc.format === null || !filters.formats.includes(disc.format))
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

export interface FacetValue<T = string> {
  value: T;
  count: number;
}

export interface Facets {
  genres: FacetValue[];
  artists: FacetValue[];
  labels: FacetValue[];
  countries: FacetValue[];
  formats: FacetValue[];
  decades: FacetValue<number>[];
  yearMin: number | null;
  yearMax: number | null;
}

function tally(counts: Map<string, number>, value: string | null): void {
  if (value === null || value.length === 0) return;
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

/** Most common first, then alphabetical so equal counts do not shuffle. */
function toFacetValues(counts: Map<string, number>): FacetValue[] {
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || foldText(a.value).localeCompare(foldText(b.value)));
}

/** Derives every filterable value, with counts, from the collection itself. */
export function deriveFacets(discs: readonly DiscIndexEntry[]): Facets {
  const genres = new Map<string, number>();
  const artists = new Map<string, number>();
  const labels = new Map<string, number>();
  const countries = new Map<string, number>();
  const formats = new Map<string, number>();
  const decades = new Map<number, number>();
  let yearMin: number | null = null;
  let yearMax: number | null = null;

  for (const disc of discs) {
    // A disc tagged twice with the same genre must count once.
    for (const genre of new Set(disc.genres)) tally(genres, genre);
    for (const label of new Set(disc.labels)) tally(labels, label);
    tally(artists, disc.artist);
    tally(countries, disc.country);
    tally(formats, disc.format);

    const year = releaseYear(disc.releaseDate);
    if (year !== null) {
      const decade = Math.floor(year / 10) * 10;
      decades.set(decade, (decades.get(decade) ?? 0) + 1);
      yearMin = yearMin === null ? year : Math.min(yearMin, year);
      yearMax = yearMax === null ? year : Math.max(yearMax, year);
    }
  }

  return {
    genres: toFacetValues(genres),
    artists: toFacetValues(artists),
    labels: toFacetValues(labels),
    countries: toFacetValues(countries),
    formats: toFacetValues(formats),
    // Decades read chronologically, not by popularity.
    decades: [...decades]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value - b.value),
    yearMin,
    yearMax,
  };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export const SORT_KEYS = [
  'added',
  'artist',
  'title',
  'year',
  'genre',
  'label',
  'country',
  'colour',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

export interface Sort {
  key: SortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: Sort = { key: 'added', direction: 'desc' };

/** Hue in degrees, saturation and lightness in 0..1, from `#rrggbb`. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const r = Number.parseInt(match[1], 16) / 255;
  const g = Number.parseInt(match[2], 16) / 255;
  const b = Number.parseInt(match[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * A single number that orders covers into a spectrum.
 *
 * Near-grey covers have a meaningless hue, so they are pulled out of the
 * rainbow and placed after it, dark to light; otherwise a black cover with a
 * faint red cast would land among the reds and break the gradient.
 */
export function colourRank(hex: string | null | undefined): number | null {
  if (hex === null || hex === undefined) return null;
  const hsl = hexToHsl(hex);
  if (hsl === null) return null;
  if (hsl.s < 0.15 || hsl.l < 0.08 || hsl.l > 0.94) return 1000 + hsl.l * 100;
  return hsl.h;
}

type SortValue = string | number | null;

function sortValue(disc: DiscIndexEntry, key: SortKey): SortValue {
  switch (key) {
    case 'added':
      return disc.addedAt;
    case 'artist':
      return foldText(disc.artist);
    case 'title':
      return foldText(disc.title);
    case 'year':
      // Full partial-date string, so 2001-03 sorts after 2001 and before 2001-04.
      return disc.releaseDate;
    case 'genre':
      return disc.genres[0] === undefined ? null : foldText(disc.genres[0]);
    case 'label':
      return disc.labels[0] === undefined ? null : foldText(disc.labels[0]);
    case 'country':
      return disc.country;
    case 'colour':
      return colourRank(disc.color);
  }
}

/**
 * Sorted copy of the collection. Missing values always sort last whichever
 * way the direction points — nobody wants twenty undated discs at the top of
 * "newest first". Ties break on artist then id so the order is stable, which
 * matters because tile positions are derived from it.
 */
export function sortDiscs(discs: readonly DiscIndexEntry[], sort: Sort): DiscIndexEntry[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const keyed = discs.map((disc) => ({ disc, value: sortValue(disc, sort.key) }));

  keyed.sort((a, b) => {
    if (a.value !== b.value) {
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      const delta =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value));
      if (delta !== 0) return delta * sign;
    }
    if (sort.key !== 'artist') {
      const byArtist = foldText(a.disc.artist).localeCompare(foldText(b.disc.artist));
      if (byArtist !== 0) return byArtist;
    }
    return a.disc.id.localeCompare(b.disc.id);
  });

  return keyed.map((entry) => entry.disc);
}

// ---------------------------------------------------------------------------
// URL state (requirement 3.7)
// ---------------------------------------------------------------------------

export interface QueryState {
  query: string;
  filters: Filters;
  sort: Sort;
  /** Move matching discs to the front instead of leaving them in place. */
  groupMatches: boolean;
}

export const DEFAULT_QUERY_STATE: QueryState = {
  query: '',
  filters: EMPTY_FILTERS,
  sort: DEFAULT_SORT,
  groupMatches: false,
};

const LIST_PARAMS: Record<FacetKey, string> = {
  genres: 'genre',
  artists: 'artist',
  labels: 'label',
  countries: 'country',
  formats: 'format',
};

function parseYear(raw: string | null): number | null {
  if (raw === null || !/^\d{4}$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

/**
 * Serialises only what differs from the defaults, so an unfiltered shelf has a
 * clean URL. Repeated keys (`genre=house&genre=techno`) keep values containing
 * commas intact, which label names often do.
 */
export function serialiseQueryState(state: QueryState): string {
  const params = new URLSearchParams();
  if (state.query.trim().length > 0) params.set('q', state.query.trim());
  for (const key of FACET_KEYS) {
    for (const value of state.filters[key]) params.append(LIST_PARAMS[key], value);
  }
  for (const decade of state.filters.decades) params.append('decade', String(decade));
  if (state.filters.yearFrom !== null) params.set('from', String(state.filters.yearFrom));
  if (state.filters.yearTo !== null) params.set('to', String(state.filters.yearTo));
  if (state.sort.key !== DEFAULT_SORT.key || state.sort.direction !== DEFAULT_SORT.direction) {
    params.set('sort', `${state.sort.key}-${state.sort.direction}`);
  }
  if (state.groupMatches) params.set('group', '1');
  return params.toString();
}

/**
 * Parses a query string back into state, ignoring anything malformed or
 * unknown. Links shared before ratings were dropped may still carry
 * `wall=rating` or `sort=rating-desc`; the first is never read and the second
 * is not a sort key, so both fall back to the defaults.
 */
export function parseQueryState(search: string): QueryState {
  const params = new URLSearchParams(search);

  const filters: Filters = {
    ...EMPTY_FILTERS,
    decades: params
      .getAll('decade')
      .filter((raw) => /^\d{3}0$/.test(raw))
      .map((raw) => Number.parseInt(raw, 10)),
    yearFrom: parseYear(params.get('from')),
    yearTo: parseYear(params.get('to')),
  };
  for (const key of FACET_KEYS) {
    filters[key] = params.getAll(LIST_PARAMS[key]).filter((value) => value.length > 0);
  }

  let sort = DEFAULT_SORT;
  const rawSort = /^([a-z]+)-(asc|desc)$/.exec(params.get('sort') ?? '');
  if (rawSort?.[1] && rawSort[2] && (SORT_KEYS as readonly string[]).includes(rawSort[1])) {
    sort = { key: rawSort[1] as SortKey, direction: rawSort[2] as SortDirection };
  }

  return {
    query: params.get('q') ?? '',
    filters,
    sort,
    groupMatches: params.get('group') === '1',
  };
}

// ---------------------------------------------------------------------------
// Index maintenance (used by the ingest endpoint)
// ---------------------------------------------------------------------------

/**
 * A slug that is not already taken. Falls back to a MusicBrainz-derived id when
 * the title has no Latin characters to slug (a Japanese pressing, say), since
 * an empty id would fail the schema.
 */
export function uniqueDiscId(
  base: string,
  taken: ReadonlySet<string>,
  fallbackSeed: string,
): string {
  const root =
    base.length > 0
      ? base
      : `disc-${
          foldText(fallbackSeed)
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 8) || 'x'
        }`;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Projects a full disc record onto the trimmed entry the index carries. */
export function toIndexEntry(disc: Disc, color: string | null): DiscIndexEntry {
  const thumbnail: DiscImage | null =
    disc.images.find((image) => image.kind === 'front' && image.width <= 600) ??
    disc.images.find((image) => image.kind === 'front') ??
    null;

  return {
    id: disc.id,
    title: disc.title,
    artist: disc.artist,
    releaseDate: disc.releaseDate,
    country: disc.country,
    labels: disc.labels,
    format: disc.format,
    genres: disc.genres,
    addedAt: disc.addedAt,
    thumbnail,
    trackTitles: disc.tracks.map((track) => track.title),
    color,
    releaseMbid: disc.source.releaseMbid,
    barcode: disc.barcode,
  };
}

export type DuplicateReason = 'release' | 'barcode' | 'title';

/**
 * Finds a disc that looks like the same one (requirement 4.13): same
 * MusicBrainz release, else same barcode, else same artist+title+year.
 * Callers warn rather than block, because owning two copies is legitimate.
 */
export function findDuplicate(
  existing: readonly Pick<
    DiscIndexEntry,
    'id' | 'artist' | 'title' | 'releaseDate' | 'releaseMbid' | 'barcode'
  >[],
  candidate: Pick<Disc, 'artist' | 'title' | 'releaseDate' | 'barcode' | 'source'>,
): { id: string; reason: DuplicateReason } | null {
  const mbid = candidate.source.releaseMbid;
  if (mbid !== null) {
    const hit = existing.find((disc) => disc.releaseMbid === mbid);
    if (hit) return { id: hit.id, reason: 'release' };
  }
  if (candidate.barcode !== null) {
    const hit = existing.find((disc) => disc.barcode === candidate.barcode);
    if (hit) return { id: hit.id, reason: 'barcode' };
  }
  const key = (disc: Pick<Disc, 'artist' | 'title' | 'releaseDate'>) =>
    `${foldText(disc.artist)}|${foldText(disc.title)}|${String(releaseYear(disc.releaseDate))}`;
  const wanted = key(candidate);
  const hit = existing.find((disc) => key(disc) === wanted);
  return hit ? { id: hit.id, reason: 'title' } : null;
}
