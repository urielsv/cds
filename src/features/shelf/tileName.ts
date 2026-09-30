import { type DiscIndexEntry } from '@shared/disc';
import { releaseYear } from '@shared/format';

/** What a screen reader announces for a cover: title, artist, year, and whether it matches. */
export function accessibleTileName(disc: DiscIndexEntry, dimmed = false): string {
  const year = releaseYear(disc.releaseDate);
  const rating = disc.rating === null ? '' : `, rated ${String(disc.rating)} of 5`;
  return `${disc.title} by ${disc.artist}${year === null ? '' : `, ${year}`}${rating}${
    dimmed ? ', not in results' : ''
  }`;
}
