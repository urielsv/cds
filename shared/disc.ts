/**
 * The canonical shape of a compact disc in the collection.
 *
 * Field names deliberately mirror MusicBrainz terminology (a "release" is one
 * specific physical pressing) because that is where the metadata originates.
 * See `.kiro/steering/api-integration.md` for the mapping rules.
 */
import { z } from 'zod';

/** A 13-digit EAN or 12-digit UPC printed on the case. */
export const barcodeSchema = z
  .string()
  .regex(/^\d{8}$|^\d{12,14}$/, 'A barcode must be 8, 12, 13 or 14 digits');

/** MusicBrainz identifiers are UUIDs. */
export const mbidSchema = z.uuid('Not a valid MusicBrainz ID');

export const trackSchema = z.object({
  position: z.number().int().positive(),
  title: z.string().min(1),
  /** Duration in milliseconds. Absent when MusicBrainz has no timing data. */
  lengthMs: z.number().int().positive().nullable(),
  /** Present when a track is credited to someone other than the disc artist. */
  artist: z.string().min(1).nullable(),
});

export const discImageSchema = z.object({
  /** Blob URL we control. Never a hotlink to archive.org at render time. */
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Tiny base64 placeholder so tiles can fade in without layout shift. */
  placeholder: z.string().nullable(),
  kind: z.enum(['front', 'back', 'disc', 'insert', 'spine', 'photo']),
});

/**
 * Fields the owner may override by hand. Anything factual about the physical
 * object that a public database can get wrong.
 *
 * `notes` is absent deliberately: it is always the owner's and never sourced.
 */
export const OVERRIDABLE_FIELDS = [
  'title',
  'artist',
  'releaseDate',
  'country',
  'barcode',
  'catalogNumber',
  'labels',
  'format',
  'packaging',
  'discCount',
  'genres',
] as const;

export const overridableFieldSchema = z.enum(OVERRIDABLE_FIELDS);

export const discSchema = z.object({
  /** Our own stable slug, e.g. `daft-punk-discovery-2001`. Used in URLs. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be a lowercase slug'),

  title: z.string().min(1),
  /** Flattened artist credit, e.g. "Daft Punk" or "Various Artists". */
  artist: z.string().min(1),
  /** Individual credited artists, for filtering by collaborator. */
  artistCredits: z.array(z.string().min(1)),

  /** Release date as printed, possibly partial: "2001", "2001-03", "2001-03-12". */
  releaseDate: z.string().nullable(),
  /**
   * ISO 3166-1 alpha-2 country code, or "XW" for worldwide.
   *
   * Frequently wrong or missing in MusicBrainz for older pressings, and the
   * country printed on the case is often the only reliable source, so this is
   * one of the most commonly hand-corrected fields. When set by hand, add
   * `'country'` to `manualFields` so a re-sync cannot overwrite it.
   */
  country: z.string().nullable(),

  barcode: barcodeSchema.nullable(),
  /** Label catalogue number, e.g. "7243 8 49606 2 5". The "code" on the spine. */
  catalogNumber: z.string().nullable(),
  labels: z.array(z.string().min(1)),

  /** Physical format as MusicBrainz reports it: "CD", "Enhanced CD", "HDCD"... */
  format: z.string().nullable(),
  /** Jewel Case, Digipak, Cardboard Sleeve, etc. */
  packaging: z.string().nullable(),
  discCount: z.number().int().positive(),

  tracks: z.array(trackSchema),
  images: z.array(discImageSchema),
  genres: z.array(z.string().min(1)),

  /** Provenance so we can re-sync or attribute correctly. */
  source: z.object({
    provider: z.enum(['musicbrainz', 'discogs', 'manual']),
    releaseMbid: mbidSchema.nullable(),
    releaseGroupMbid: mbidSchema.nullable(),
    /** When we last pulled metadata from the provider. */
    fetchedAt: z.iso.datetime(),
  }),

  /** Free-form personal notes; the part no public database can provide. */
  notes: z.string().nullable(),
  /**
   * Fields the owner has set or corrected by hand.
   *
   * Re-syncing from MusicBrainz must never overwrite a field listed here. The
   * printed case is the authority for a physical object, and MusicBrainz is
   * often wrong about country and catalogue number on older pressings — losing a
   * hand-verified correction to an automated refresh would be the worst kind of
   * silent data loss, because the owner would have no way to notice.
   */
  manualFields: z.array(overridableFieldSchema),
  /** When this disc was added to the collection. */
  addedAt: z.iso.datetime(),
});

/**
 * The trimmed projection used by the grid.
 *
 * This must carry every field the shelf needs to render, search, filter and sort
 * without a further request, because requirement 8.4 says browsing a loaded
 * collection makes no network calls. That is why the filterable fields
 * (`country`, `labels`, `format`, `genres`) are here and not only on the full
 * record. The full `Disc` — tracks with durations, all images, notes — is
 * fetched only when a disc is opened.
 */
export const discSummarySchema = discSchema.pick({
  id: true,
  title: true,
  artist: true,
  releaseDate: true,
  country: true,
  labels: true,
  format: true,
  genres: true,
  addedAt: true,
});

export const collectionIndexSchema = z.object({
  /** Bumped when the schema changes so stale clients can detect it. */
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  discs: z.array(
    discSummarySchema.extend({
      /** Front cover thumbnail for the tile. */
      thumbnail: discImageSchema.nullable(),
      /**
       * Track titles only — no positions or durations.
       *
       * Search has to match track titles (requirement 3.1) with no network
       * request, so they must live in the index. Budget: at 400 discs and ~14
       * tracks each this is roughly 140 KB of text, which compresses well and is
       * a fair price for instant search. Durations stay out; they are needed only
       * in the detail view.
       */
      trackTitles: z.array(z.string()),
    }),
  ),
});

export type Track = z.infer<typeof trackSchema>;
export type DiscImage = z.infer<typeof discImageSchema>;
export type Disc = z.infer<typeof discSchema>;
export type DiscSummary = z.infer<typeof discSummarySchema>;
export type CollectionIndex = z.infer<typeof collectionIndexSchema>;
export type DiscImageKind = DiscImage['kind'];
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

/** One entry as it appears in the collection index: a summary plus tile data. */
export type DiscIndexEntry = CollectionIndex['discs'][number];

/** True when the owner has hand-corrected this field and re-sync must skip it. */
export function isManuallySet(disc: Pick<Disc, 'manualFields'>, field: OverridableField): boolean {
  return disc.manualFields.includes(field);
}
