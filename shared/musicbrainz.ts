/**
 * Helpers for turning MusicBrainz search results into something a human can
 * choose from, and a chosen release into our own `Disc`.
 *
 * Context: a barcode does NOT uniquely identify a release. Scanning
 * `724384960650` returns both the 2005 and the 2024 issue of Daft Punk's
 * *Discovery*, and neither is the CD pressing. So the upload flow always
 * presents ranked candidates rather than silently accepting the first hit.
 */

import { z } from 'zod';

import { type Disc, discSchema, type Track } from './disc.js';
import { normaliseBarcode } from './format.js';

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
export function rankCandidates<T extends ReleaseCandidate>(
  candidates: readonly T[],
  preferences: RankingPreferences = {},
): T[] {
  return [...candidates].sort((a, b) => {
    const delta = scoreCandidate(b, preferences) - scoreCandidate(a, preferences);
    if (delta !== 0) return delta;
    return a.mbid.localeCompare(b.mbid);
  });
}

// ---------------------------------------------------------------------------
// Response schemas
//
// Only the fields we map are declared; Zod strips the rest. Everything
// MusicBrainz might omit is optional, because "absent" and "null" both occur in
// practice depending on the endpoint.
// ---------------------------------------------------------------------------

const mbArtistCreditSchema = z.array(
  z.object({
    name: z.string(),
    joinphrase: z.string().optional(),
    artist: z.object({ id: z.string(), name: z.string() }).optional(),
  }),
);

const mbLabelInfoSchema = z.array(
  z.object({
    'catalog-number': z.string().nullish(),
    label: z.object({ name: z.string() }).nullish(),
  }),
);

const mbGenreSchema = z.array(z.object({ name: z.string(), count: z.number().optional() }));

/** One release as it appears in `/ws/2/release?query=…` results. */
export const mbSearchReleaseSchema = z.object({
  id: z.string(),
  score: z.number().optional(),
  title: z.string(),
  date: z.string().nullish(),
  country: z.string().nullish(),
  barcode: z.string().nullish(),
  packaging: z.string().nullish(),
  status: z.string().nullish(),
  'artist-credit': mbArtistCreditSchema.optional(),
  'label-info': mbLabelInfoSchema.optional(),
  'track-count': z.number().optional(),
  media: z
    .array(z.object({ format: z.string().nullish(), 'track-count': z.number().optional() }))
    .optional(),
});

export const mbSearchResponseSchema = z.object({
  count: z.number(),
  releases: z.array(mbSearchReleaseSchema),
});

/** `/ws/2/release/{mbid}?inc=recordings+artist-credits+labels+release-groups+media+discids+genres` */
export const mbReleaseSchema = mbSearchReleaseSchema.extend({
  genres: mbGenreSchema.optional(),
  'release-group': z
    .object({
      id: z.string(),
      'first-release-date': z.string().nullish(),
      genres: mbGenreSchema.optional(),
    })
    .optional(),
  'cover-art-archive': z
    .object({ front: z.boolean().optional(), back: z.boolean().optional() })
    .optional(),
  media: z
    .array(
      z.object({
        format: z.string().nullish(),
        position: z.number().optional(),
        tracks: z
          .array(
            z.object({
              position: z.number().optional(),
              title: z.string(),
              length: z.number().nullish(),
              'artist-credit': mbArtistCreditSchema.optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export type MbSearchRelease = z.infer<typeof mbSearchReleaseSchema>;
export type MbRelease = z.infer<typeof mbReleaseSchema>;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** Joins an artist credit the way it is printed: "Jay-Z & Linkin Park". */
export function flattenArtistCredit(credit: MbSearchRelease['artist-credit']): string {
  if (!credit || credit.length === 0) return 'Unknown Artist';
  return credit
    .map((part) => `${part.name}${part.joinphrase ?? ''}`)
    .join('')
    .trim();
}

function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Media formats, de-duplicated but in order: `['CD', 'DVD-Video']`. */
function mediaFormats(release: MbSearchRelease): string[] {
  const formats = (release.media ?? [])
    .map((medium) => blankToNull(medium.format))
    .filter((format): format is string => format !== null);
  return [...new Set(formats)];
}

function labelNames(release: MbSearchRelease): string[] {
  const names = (release['label-info'] ?? [])
    .map((info) => blankToNull(info.label?.name))
    .filter((name): name is string => name !== null && name !== '[no label]');
  return [...new Set(names)];
}

function firstCatalogNumber(release: MbSearchRelease): string | null {
  for (const info of release['label-info'] ?? []) {
    const value = blankToNull(info['catalog-number']);
    if (value !== null && value.toLowerCase() !== '[none]') return value;
  }
  return null;
}

/** Everything the candidate list shows, plus what ranking needs. */
export interface CandidateSummary extends ReleaseCandidate {
  barcode: string | null;
  labels: string[];
  catalogNumber: string | null;
  trackCount: number | null;
  packaging: string | null;
}

export function toCandidate(release: MbSearchRelease): CandidateSummary {
  const summedTracks = (release.media ?? []).reduce(
    (sum, medium) => sum + (medium['track-count'] ?? 0),
    0,
  );
  const trackCount = release['track-count'] ?? (summedTracks > 0 ? summedTracks : null);

  return {
    mbid: release.id,
    title: release.title,
    artist: flattenArtistCredit(release['artist-credit']),
    date: blankToNull(release.date),
    country: blankToNull(release.country),
    formats: mediaFormats(release),
    searchScore: release.score ?? 0,
    // Search results do not say whether art exists; the release lookup does.
    // Leaving it false keeps ranking neutral rather than guessing.
    hasCoverArt: false,
    barcode: normaliseBarcode(release.barcode ?? ''),
    labels: labelNames(release),
    catalogNumber: firstCatalogNumber(release),
    trackCount,
    packaging: blankToNull(release.packaging),
  };
}

/**
 * Picks at most five genres, most-voted first.
 *
 * Release-level genres are often absent or sparse, while the release group
 * (the album across all its pressings) carries the community's votes. Fall back
 * to the group, and drop single-vote tags there: an album with eighteen tags
 * where "christmas music" has one vote is noise, not a genre.
 */
export function pickGenres(release: MbRelease, limit = 5): string[] {
  const byVotes = (list: z.infer<typeof mbGenreSchema>) =>
    [...list].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));

  const own = byVotes(release.genres ?? []);
  if (own.length > 0) return own.slice(0, limit).map((genre) => genre.name);

  const group = byVotes(release['release-group']?.genres ?? []);
  const meaningful = group.filter((genre) => (genre.count ?? 0) > 1);
  return (meaningful.length > 0 ? meaningful : group).slice(0, limit).map((genre) => genre.name);
}

export interface MapReleaseOptions {
  id: string;
  /** ISO timestamp for both `addedAt` and `source.fetchedAt`. */
  now: string;
  notes?: string | null;
}

/**
 * Maps a full release lookup into our domain model and validates it.
 *
 * Tracks are numbered continuously across media, so a 2-CD set reads 1..N in
 * the detail view; `discCount` keeps the physical split.
 */
export function mapRelease(release: MbRelease, options: MapReleaseOptions): Disc {
  const artist = flattenArtistCredit(release['artist-credit']);
  const media = release.media ?? [];

  const tracks: Track[] = [];
  for (const medium of media) {
    for (const track of medium.tracks ?? []) {
      const trackArtist = track['artist-credit']
        ? flattenArtistCredit(track['artist-credit'])
        : null;
      tracks.push({
        position: tracks.length + 1,
        title: track.title.trim().length > 0 ? track.title : 'Untitled',
        lengthMs:
          typeof track.length === 'number' && track.length > 0 ? Math.round(track.length) : null,
        artist: trackArtist !== null && trackArtist !== artist ? trackArtist : null,
      });
    }
  }

  const formats = mediaFormats(release);
  const credits = (release['artist-credit'] ?? [])
    .map((part) => part.artist?.name ?? part.name)
    .filter((name) => name.trim().length > 0);

  return discSchema.parse({
    id: options.id,
    title: release.title,
    artist,
    artistCredits: [...new Set(credits)],
    releaseDate: blankToNull(release.date),
    country: blankToNull(release.country),
    barcode: normaliseBarcode(release.barcode ?? ''),
    catalogNumber: firstCatalogNumber(release),
    labels: labelNames(release),
    // A mixed "CD + DVD" set is recorded as such rather than as its first medium.
    format: formats.length === 0 ? null : formats.join(' + '),
    packaging: blankToNull(release.packaging),
    discCount: Math.max(1, media.length),
    tracks,
    images: [],
    genres: pickGenres(release),
    source: {
      provider: 'musicbrainz',
      releaseMbid: release.id,
      releaseGroupMbid: release['release-group']?.id ?? null,
      fetchedAt: options.now,
    },
    notes: blankToNull(options.notes),
    // The owner's own judgement; never sourced from a provider.
    rating: null,
    manualFields: [],
    addedAt: options.now,
  });
}
