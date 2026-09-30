/**
 * Rating a disc: the one edit the wall itself depends on, since the rating
 * decides how large a cover is drawn.
 *
 * Kept apart from ingest because it touches one field of one disc and must
 * cost a bounded, tiny number of Blob writes: the disc document, then the
 * index — the same order as ingest, for the same reason.
 */

import { z } from 'zod';

import { type CollectionIndex, discSchema } from '../../shared/disc.js';

import { type CollectionStore } from './store.js';

export const rateRequestSchema = z.object({
  /** 1–5 stars, or null to clear the rating. */
  rating: z.number().int().min(1).max(5).nullable(),
});

export type RateRequest = z.infer<typeof rateRequestSchema>;

export class DiscNotFoundError extends Error {
  constructor(id: string) {
    super(`No disc with id ${id}.`);
    this.name = 'DiscNotFoundError';
  }
}

export async function rateDisc(
  id: string,
  rating: number | null,
  deps: { store: CollectionStore; now?: () => Date },
): Promise<CollectionIndex['discs'][number]> {
  const now = (deps.now ?? (() => new Date()))();
  const index = await deps.store.readIndex();
  const existing = index.discs.find((disc) => disc.id === id);
  if (!existing) throw new DiscNotFoundError(id);

  // The full record is the source of truth, so it changes first. In demo or
  // early deployments the document may be missing; the index entry is still
  // updated, because that is what the wall reads.
  const document = await deps.store.readDisc(id);
  if (document !== null) {
    await deps.store.writeDisc(discSchema.parse({ ...document, rating }));
  }

  const entry = { ...existing, rating };
  await deps.store.writeIndex({
    version: 1,
    generatedAt: now.toISOString(),
    discs: index.discs.map((disc) => (disc.id === id ? entry : disc)),
  });
  return entry;
}
