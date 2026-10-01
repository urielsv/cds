import { type DiscIndexEntry } from '@shared/disc';
import { releaseYear } from '@shared/format';

/** What a screen reader announces for a cover: title, artist, year, and whether it matches. */
export function accessibleTileName(disc: DiscIndexEntry, dimmed = false): string {
  const year = releaseYear(disc.releaseDate);
  return `${disc.title} by ${disc.artist}${year === null ? '' : `, ${year}`}${
    dimmed ? ', not in results' : ''
  }`;
}
