import Fuse, { type FuseOptionKey, type IFuseOptions } from 'fuse.js';

import { foldText } from '@shared/collection';
import { countryDisplay } from '@shared/country';
import { type DiscIndexEntry } from '@shared/disc';
import { releaseYear } from '@shared/format';

/**
 * What each disc is matched against.
 *
 * Everything is folded once, when the index is built, and the query is folded
 * the same way, so "sigur ros" and "Sigur Rós" match in both directions
 * (requirement 3.4). Fuse's own diacritic handling folds only the data side in
 * some versions, so this does not rely on it.
 */
interface SearchRecord {
  id: string;
  title: string;
  artist: string;
  /** Label, catalogue-ish text, format, packaging — the pressing's own detail. */
  labels: string[];
  genres: string[];
  tracks: string[];
  /** Country code and full name, so "argentina" and "AR" both work. */
  country: string[];
  format: string;
  /** Year, decade and barcode: typing "1997" or the digits finds the disc. */
  numbers: string[];
}

/**
 * Artist and title outrank the rest (requirement 3.2): typing "roads" should
 * surface a Portishead album before a compilation that merely contains a track
 * called "Roads". Metadata is searchable but never outranks the name of the
 * thing.
 */
const KEYS: FuseOptionKey<SearchRecord>[] = [
  { name: 'title', weight: 3 },
  { name: 'artist', weight: 3 },
  { name: 'labels', weight: 1 },
  { name: 'genres', weight: 1 },
  { name: 'tracks', weight: 0.8 },
  { name: 'country', weight: 0.6 },
  { name: 'format', weight: 0.5 },
  { name: 'numbers', weight: 0.5 },
];

const OPTIONS: IFuseOptions<SearchRecord> = {
  keys: KEYS,
  // A little typo tolerance without letting two letters match everything.
  threshold: 0.32,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

function toRecord(disc: DiscIndexEntry): SearchRecord {
  const year = releaseYear(disc.releaseDate);
  const display = countryDisplay(disc.country);

  return {
    id: disc.id,
    title: foldText(disc.title),
    artist: foldText(disc.artist),
    labels: disc.labels.map(foldText),
    genres: disc.genres.map(foldText),
    tracks: disc.trackTitles.map(foldText),
    country: [disc.country, display?.name].filter((v): v is string => Boolean(v)).map(foldText),
    format: foldText(disc.format ?? ''),
    numbers: [
      year === null ? null : String(year),
      year === null ? null : `${String(Math.floor(year / 10) * 10)}s`,
      disc.barcode ?? null,
    ].filter((value): value is string => value !== null),
  };
}

export interface DiscSearch {
  /** Ids of discs matching the query, or null when the query is blank. */
  match: (query: string) => ReadonlySet<string> | null;
}

/** Splits a query into search terms, dropping anything too short to be useful. */
function terms(query: string): string[] {
  return foldText(query)
    .split(/[\s,]+/)
    .filter((term) => term.length > 0);
}

/**
 * Builds the fuzzy index once per collection.
 *
 * Multi-word queries are matched term by term and intersected, because Fuse
 * scores the query as a single string against each field: "daft discovery"
 * would otherwise match neither the artist nor the title well enough to appear,
 * even though each word matches one of them. Every term must match somewhere,
 * which is what makes adding a word narrow the result rather than change it.
 */
export function createDiscSearch(discs: readonly DiscIndexEntry[]): DiscSearch {
  const fuse = new Fuse(discs.map(toRecord), OPTIONS);

  return {
    match(query) {
      const parts = terms(query);
      if (parts.length === 0) return null;

      let result: Set<string> | null = null;
      for (const term of parts) {
        // A single stray character narrows nothing; ignore it rather than
        // matching everything.
        if (term.length < 2 && parts.length > 1) continue;
        const ids = new Set(fuse.search(term).map((hit) => hit.item.id));
        if (result === null) {
          result = ids;
        } else {
          for (const id of result) {
            if (!ids.has(id)) result.delete(id);
          }
        }
        if (result.size === 0) break;
      }
      return result ?? new Set<string>();
    },
  };
}
