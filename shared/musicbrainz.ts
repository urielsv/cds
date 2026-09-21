/**
 * Helpers for turning MusicBrainz search results into something a human can
 * choose from.
 *
 * Context: a barcode does NOT uniquely identify a release. Scanning
 * `724384960650` returns both the 2005 and the 2024 issue of Daft Punk's
 * *Discovery*, and neither is the CD pressing. So the upload flow always
 * presents ranked candidates rather than silently accepting the first hit.
 */

/** The subset of a MusicBrainz release we need in order to rank candidates. */
export interface ReleaseCandidate {
  mbid: string;
  title: string;
  artist: string;
  /** Partial ISO date, as MusicBrainz returns it. */
  date: string | null;
  /** ISO 3166 country code, or `XW` for worldwide. */
  country: string | null;
  /** Physical formats across all media, e.g. `['CD']` or `['CD', 'DVD']`. */
  formats: readonly string[];
  /** MusicBrainz search relevance score, 0-100. */
  searchScore: number;
  /** Whether cover art exists in the Cover Art Archive. */
  hasCoverArt: boolean;
}

/** Formats that count as a compact disc for a CD collection. */
const CD_FORMATS = new Set([
  'cd',
  'cd-r',
  'enhanced cd',
  'hdcd',
  'copy control cd',
  'data cd',
  '8cm cd',
  'shm-cd',
  'blu-spec cd',
  'sacd',
  'hybrid sacd',
  'minidisc',
  'vcd',
  'dts cd',
]);

export function isCdFormat(format: string): boolean {
  return CD_FORMATS.has(format.trim().toLowerCase());
}

/** True when any medium in the release is a compact disc variant. */
export function hasCdMedium(candidate: Pick<ReleaseCandidate, 'formats'>): boolean {
  return candidate.formats.some(isCdFormat);
}

export interface RankingPreferences {
  /** Collector's country, e.g. `AR`. Local pressings rank higher. */
  preferredCountry?: string | undefined;
}

/**
 * Scores a candidate for how likely it is to be the disc in the user's hand.
 * Higher is better. The weights are deliberately coarse: this only needs to put
 * the right pressing near the top of a short list, not be statistically sound.
 */
export function scoreCandidate(
  candidate: ReleaseCandidate,
  preferences: RankingPreferences = {},
): number {
  let score = candidate.searchScore;

  // A physical CD is overwhelmingly the most likely match in a CD collection.
  if (hasCdMedium(candidate)) score += 120;

  // Cover art makes for a far better tile, and its presence correlates with
  // well-curated releases.
  if (candidate.hasCoverArt) score += 25;

  // A local pressing beats a worldwide digital issue.
  if (
    preferences.preferredCountry !== undefined &&
    candidate.country === preferences.preferredCountry
  ) {
    score += 40;
  }

  // Prefer releases that actually carry a date; undated releases are usually
  // poorly documented stubs.
  if (candidate.date !== null && candidate.date.length > 0) score += 10;

  return score;
}

/**
 * Orders candidates best-first. Ties break on MBID so the order is stable
 * across renders, which matters because these rows animate.
 */
export function rankCandidates(
  candidates: readonly ReleaseCandidate[],
  preferences: RankingPreferences = {},
): ReleaseCandidate[] {
  return [...candidates].sort((a, b) => {
    const delta = scoreCandidate(b, preferences) - scoreCandidate(a, preferences);
    if (delta !== 0) return delta;
    return a.mbid.localeCompare(b.mbid);
  });
}
