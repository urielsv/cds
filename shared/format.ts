/** Pure formatting and normalisation helpers shared by the client and the API. */

/** Renders a millisecond duration as `m:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(lengthMs: number | null): string {
  if (lengthMs === null || !Number.isFinite(lengthMs) || lengthMs < 0) return '—';

  const totalSeconds = Math.round(lengthMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/**
 * Extracts the year from a possibly partial MusicBrainz date.
 * MusicBrainz dates come as `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`.
 */
export function releaseYear(releaseDate: string | null): number | null {
  if (releaseDate === null) return null;
  const match = /^(\d{4})/.exec(releaseDate);
  if (match?.[1] === undefined) return null;
  const year = Number.parseInt(match[1], 10);
  return Number.isNaN(year) ? null : year;
}

/** Total runtime of a track list, or null when any track is missing timing. */
export function totalRuntimeMs(tracks: readonly { lengthMs: number | null }[]): number | null {
  let total = 0;
  for (const track of tracks) {
    if (track.lengthMs === null) return null;
    total += track.lengthMs;
  }
  return total;
}

/**
 * Letters that Unicode normalisation cannot fold, because they are distinct
 * letters rather than accented forms. Nordic, Icelandic and German titles are
 * common in a CD collection ("Ágætis byrjun", "Mötley Crüe", "Blue Öyster
 * Cult"), so these need explicit transliteration to stay readable in a URL.
 */
const LIGATURES: readonly (readonly [RegExp, string])[] = [
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/ß/g, 'ss'],
  [/đ|ð/g, 'd'],
  [/þ/g, 'th'],
  [/ł/g, 'l'],
  [/ı/g, 'i'],
];

/**
 * Builds the URL-facing slug for a disc: `artist-title-year`.
 * Diacritics are folded so `Sigur Rós` and `Sigur Ros` produce the same slug.
 */
export function discSlug(artist: string, title: string, releaseDate: string | null): string {
  const year = releaseYear(releaseDate);
  const parts = [artist, title, year === null ? '' : String(year)];

  let slug = parts.join(' ').toLowerCase();
  for (const [pattern, replacement] of LIGATURES) {
    slug = slug.replace(pattern, replacement);
  }

  return slug
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Reduces a scanned or typed barcode to bare digits.
 * Returns null when the result is not a plausible barcode length.
 */
export function normaliseBarcode(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 8 || (digits.length >= 12 && digits.length <= 14)) return digits;
  return null;
}

/**
 * Every form of a barcode worth querying, most likely first.
 *
 * MusicBrainz stores the CD of Daft Punk's *Discovery* as the bare 12-digit
 * UPC-A `724384960650`, while a scanner may report the zero-padded EAN-13
 * `0724384960650`. Measured behaviour: MusicBrainz's search index normalises the
 * leading zero, so both forms currently return the same 2 releases. We still
 * emit both variants because that normalisation is an undocumented convenience
 * of their Lucene index, and neither exact-field matching nor the Discogs
 * fallback is guaranteed to do the same. Callers must de-duplicate by MBID.
 */
export function barcodeSearchVariants(raw: string): string[] {
  const digits = normaliseBarcode(raw);
  if (digits === null) return [];

  const variants = new Set<string>([digits]);

  // EAN-13 that is really a zero-padded UPC-A -> also try the 12-digit form.
  if (digits.length === 13 && digits.startsWith('0')) {
    variants.add(digits.slice(1));
  }
  // UPC-A -> also try the zero-padded EAN-13 form.
  if (digits.length === 12) {
    variants.add(`0${digits}`);
  }

  return [...variants];
}
