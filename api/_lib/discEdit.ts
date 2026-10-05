/**
 * Deleting and editing a disc: the whole write path for the two owner-only
 * mutations, independent of HTTP and of Blob so they can be tested against the
 * same in-memory fake the ingest tests use.
 *
 * Both follow the rule that governs every write here: the index is the only
 * thing the app reads to find discs, so it must never point at something that
 * does not exist.
 *
 *  - DELETE rewrites the index WITHOUT the entry first, then removes the disc
 *    document and its image blobs. If the index write fails, nothing else has
 *    happened; if a later del() fails, the collection is already correct and a
 *    stray blob is only a (free-to-leave) storage leak.
 *  - EDIT writes any new image blobs, then the disc document, then the index
 *    LAST, then deletes the now-orphaned old image blobs. A failure before the
 *    index flip leaves the collection exactly as it was; new blobs written so
 *    far are cleaned up with del(), which is free.
 */

import { z } from 'zod';

import { removeFromIndex, toIndexEntry, updateIndexEntry } from '../../shared/collection.js';
import {
  type Disc,
  type DiscImage,
  type DiscIndexEntry,
  OVERRIDABLE_FIELDS,
} from '../../shared/disc.js';

import { artworkSchema, decodeJpeg } from './ingest.js';
import { type CollectionStore } from './store.js';

export class DiscNotFoundError extends Error {
  constructor() {
    super('No disc with that id.');
    this.name = 'DiscNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteDisc(
  id: string,
  deps: { store: CollectionStore; now?: () => Date },
): Promise<{ indexUrl: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const index = await deps.store.readIndex();
  const entry = index.discs.find((disc) => disc.id === id);
  if (!entry) throw new DiscNotFoundError();

  // Collect every image blob the disc owns before it is unreferenced. The index
  // entry only carries the thumbnail; the full set lives on the disc document.
  const disc = await deps.store.readDisc(id);
  const imageUrls = new Set<string>();
  if (entry.thumbnail) imageUrls.add(entry.thumbnail.url);
  for (const image of disc?.images ?? []) imageUrls.add(image.url);

  // Index first: once the entry is gone, nothing references the disc.
  const stored = await deps.store.writeIndex(removeFromIndex(index, id, now));

  // Now safe to remove the backing objects. del() is free; failures here leave
  // the collection correct, only a stray blob behind.
  await deps.store.removeDisc(id).catch(() => undefined);
  await deps.store.remove([...imageUrls]).catch(() => undefined);

  return { indexUrl: stored.url };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/**
 * Only the fields the UI exposes for editing. `genres` is a list; `country` and
 * `format` are nullable strings. Each must be a member of OVERRIDABLE_FIELDS so
 * it is recorded in `manualFields` and survives a future MusicBrainz re-sync.
 */
export const editRequestSchema = z
  .object({
    country: z.string().trim().min(1).max(8).nullable().optional(),
    format: z.string().trim().min(1).max(60).nullable().optional(),
    genres: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
    /** A new cover, resized in the browser. null means "remove the artwork". */
    artwork: artworkSchema.nullable().optional(),
  })
  // At least one thing must actually change.
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No changes were provided.',
  });

export type EditRequest = z.infer<typeof editRequestSchema>;

const EDITABLE_FIELDS = ['country', 'format', 'genres'] as const;

export async function editDisc(
  id: string,
  request: EditRequest,
  deps: { store: CollectionStore; now?: () => Date },
): Promise<{ entry: DiscIndexEntry; indexUrl: string }> {
  const now = (deps.now ?? (() => new Date()))();

  // Decode new artwork first: bad bytes should fail before any storage work.
  const changingArtwork = Object.prototype.hasOwnProperty.call(request, 'artwork');
  const tileBytes = request.artwork ? decodeJpeg(request.artwork.tile.data) : null;
  const largeBytes = request.artwork?.large ? decodeJpeg(request.artwork.large.data) : null;

  const index = await deps.store.readIndex();
  const existing = index.discs.find((disc) => disc.id === id);
  if (!existing) throw new DiscNotFoundError();
  const disc = await deps.store.readDisc(id);
  if (!disc) throw new DiscNotFoundError();

  // Build the edited disc, recording each changed overridable field so a
  // re-sync will not clobber the hand-correction.
  const manual = new Set(disc.manualFields);
  const next: Disc = { ...disc };
  for (const field of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) continue;
    if (field === 'genres') {
      if (request.genres === undefined) continue;
      next.genres = request.genres;
    } else {
      next[field] = request[field] ?? null;
    }
    // OVERRIDABLE_FIELDS is the source of truth; guard keeps the types honest.
    if ((OVERRIDABLE_FIELDS as readonly string[]).includes(field)) {
      manual.add(field);
    }
  }
  next.manualFields = [...manual];

  const written: string[] = [];
  let oldImagesToRemove: string[] = [];
  // Colour lives only on the index entry, not the disc document; preserve the
  // current one unless new artwork supplies a fresh colour.
  let color = existing.color ?? null;

  try {
    if (changingArtwork) {
      const images: DiscImage[] = [];
      if (request.artwork && tileBytes) {
        const placeholder = request.artwork.placeholder;
        const tile = await deps.store.putImage(`collection/images/${id}/front-tile.jpg`, tileBytes);
        written.push(tile.url);
        images.push({
          url: tile.url,
          width: request.artwork.tile.width,
          height: request.artwork.tile.height,
          placeholder,
          kind: 'front',
        });
        if (request.artwork.large && largeBytes) {
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
        color = request.artwork.color;
      } else {
        // artwork === null: the owner removed the cover.
        color = null;
      }
      // Remove the previous blobs only AFTER the index points at the new set.
      oldImagesToRemove = disc.images
        .map((image) => image.url)
        .filter((url) => !images.some((im) => im.url === url));
      next.images = images;
    }

    // Disc document, then the index entry projected from it — index LAST.
    await deps.store.writeDisc(next);
    const entry = toIndexEntry(next, color);
    const stored = await deps.store.writeIndex(updateIndexEntry(index, entry, now));

    // Now that the index references the new images, the old ones are orphaned.
    if (oldImagesToRemove.length > 0) {
      await deps.store.remove(oldImagesToRemove).catch(() => undefined);
    }

    return { entry, indexUrl: stored.url };
  } catch (error) {
    // Roll back anything newly written; leave the collection as it was.
    await deps.store.remove(written).catch(() => undefined);
    throw error;
  }
}
