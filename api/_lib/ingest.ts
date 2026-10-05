/**
 * Adding a disc: the whole write path, independent of HTTP and of Blob so it
 * can be tested against fakes. Follows `.kiro/skills/add-disc-ingest`.
 *
 * Artwork arrives already resized. The owner's browser fetched it from the
 * Cover Art Archive, drew it to a canvas at the sizes the UI renders, and
 * computed the placeholder and average colour — work done once, on the phone,
 * with no request-time image transformation and no image library in a
 * function bundle.
 */

import { z } from 'zod';

import {
  findDuplicate,
  type DuplicateReason,
  toIndexEntry,
  uniqueDiscId,
} from '../../shared/collection.js';
import {
  type CollectionIndex,
  type DiscImage,
  type DiscIndexEntry,
  mbidSchema,
} from '../../shared/disc.js';
import { discSlug } from '../../shared/format.js';
import { mapRelease } from '../../shared/musicbrainz.js';

import { type MusicBrainzClient } from './musicbrainz.js';
import { type CollectionStore } from './store.js';

/** Base64 of a ~1200px JPEG stays well under this; it bounds abuse too. */
const MAX_IMAGE_BASE64 = 1_600_000;

const imageSchema = z.object({
  data: z.string().min(16).max(MAX_IMAGE_BASE64),
  width: z.number().int().min(16).max(4096),
  height: z.number().int().min(16).max(4096),
});

/** The resized-in-the-browser artwork payload, shared by add and edit flows. */
export const artworkSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable(),
  placeholder: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .max(4000)
    .nullable(),
  tile: imageSchema,
  large: imageSchema.nullable(),
});

export const ingestRequestSchema = z.object({
  mbid: mbidSchema,
  notes: z.string().max(4000).nullable().optional(),
  /** Set after the owner has seen the duplicate warning and chosen to add anyway. */
  allowDuplicate: z.boolean().optional(),
  artwork: artworkSchema.nullable(),
});

export type IngestRequest = z.infer<typeof ingestRequestSchema>;

export type IngestResult =
  | { kind: 'created'; entry: DiscIndexEntry; indexUrl: string }
  | { kind: 'duplicate'; existingId: string; existingTitle: string; reason: DuplicateReason };

/** Decodes base64 and refuses anything that is not actually a JPEG. */
export function decodeJpeg(data: string): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(data, 'base64'));
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new InvalidArtworkError();
  }
  return bytes;
}

export class InvalidArtworkError extends Error {
  constructor() {
    super('Artwork must be a JPEG image.');
    this.name = 'InvalidArtworkError';
  }
}

export async function ingestDisc(
  request: IngestRequest,
  deps: { store: CollectionStore; musicbrainz: MusicBrainzClient; now?: () => Date },
): Promise<IngestResult> {
  const now = (deps.now ?? (() => new Date()))();

  // Decode first: bad artwork should fail before any network or storage work.
  const tileBytes = request.artwork ? decodeJpeg(request.artwork.tile.data) : null;
  const largeBytes = request.artwork?.large ? decodeJpeg(request.artwork.large.data) : null;

  const release = await deps.musicbrainz.lookupRelease(request.mbid);
  // Read the index exactly once; everything below mutates this copy.
  const index: CollectionIndex = await deps.store.readIndex();

  const taken = new Set(index.discs.map((disc) => disc.id));
  const draft = mapRelease(release, {
    id: 'pending',
    now: now.toISOString(),
    notes: request.notes ?? null,
  });
  const id = uniqueDiscId(
    discSlug(draft.artist, draft.title, draft.releaseDate),
    taken,
    request.mbid,
  );

  const duplicate = findDuplicate(index.discs, draft);
  if (duplicate && request.allowDuplicate !== true) {
    const existing = index.discs.find((disc) => disc.id === duplicate.id);
    return {
      kind: 'duplicate',
      existingId: duplicate.id,
      existingTitle: existing ? `${existing.title} — ${existing.artist}` : duplicate.id,
      reason: duplicate.reason,
    };
  }

  const written: string[] = [];
  try {
    // 1. Images. They come before the disc document because the document
    //    records their URLs, which only exist once written.
    const images: DiscImage[] = [];
    const placeholder = request.artwork?.placeholder ?? null;
    if (request.artwork && tileBytes) {
      const tile = await deps.store.putImage(`collection/images/${id}/front-tile.jpg`, tileBytes);
      written.push(tile.url);
      images.push({
        url: tile.url,
        width: request.artwork.tile.width,
        height: request.artwork.tile.height,
        placeholder,
        kind: 'front',
      });
    }
    if (request.artwork?.large && largeBytes) {
      const large = await deps.store.putImage(
        `collection/images/${id}/front-large.jpg`,
        largeBytes,
      );
      written.push(large.url);
      images.push({
        url: large.url,
        width: request.artwork.large.width,
        height: request.artwork.large.height,
        placeholder,
        kind: 'front',
      });
    }

    // 2. The full disc document.
    const disc = { ...draft, id, images };
    const document = await deps.store.writeDisc(disc);
    written.push(document.url);

    // 3. Last, the index — the only thing the app reads to find discs, so it
    //    must never point at anything that does not exist yet.
    const entry = toIndexEntry(disc, request.artwork?.color ?? null);
    const nextIndex: CollectionIndex = {
      version: 1,
      generatedAt: now.toISOString(),
      discs: [entry, ...index.discs],
    };
    const stored = await deps.store.writeIndex(nextIndex);
    return { kind: 'created', entry, indexUrl: stored.url };
  } catch (error) {
    // Deletes are free. Leave the collection exactly as it was.
    await deps.store.remove(written).catch(() => undefined);
    throw error;
  }
}
