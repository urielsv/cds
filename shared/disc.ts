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
  /** ISO 3166 country code, or "XW" for worldwide. */
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
  /** When this disc was added to the collection. */
  addedAt: z.iso.datetime(),
});

/**
 * The trimmed projection used by the grid. The full `Disc` is only fetched when
 * a tile is opened, which keeps the initial collection payload small enough to
 * download once and filter entirely on the client.
 */
export const discSummarySchema = discSchema.pick({
  id: true,
  title: true,
  artist: true,
  releaseDate: true,
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
    }),
  ),
});

export type Track = z.infer<typeof trackSchema>;
export type DiscImage = z.infer<typeof discImageSchema>;
export type Disc = z.infer<typeof discSchema>;
export type DiscSummary = z.infer<typeof discSummarySchema>;
export type CollectionIndex = z.infer<typeof collectionIndexSchema>;
export type DiscImageKind = DiscImage['kind'];
