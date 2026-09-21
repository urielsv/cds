import { motion, useReducedMotion } from 'motion/react';

import { CountryBadge } from '@/components/CountryBadge';
import { REDUCED_TRANSITION, transition } from '@/motion/tokens';
import { type DiscIndexEntry } from '@shared/disc';
import { releaseYear } from '@shared/format';

interface DiscTileProps {
  disc: DiscIndexEntry;
  onOpen: (disc: DiscIndexEntry) => void;
  /** Suppresses the shared-element pairing while this tile's disc is open. */
  isOpen: boolean;
}

export function DiscTile({ disc, onOpen, isOpen }: DiscTileProps) {
  const reduced = useReducedMotion() ?? false;
  const year = releaseYear(disc.releaseDate);

  return (
    // A real <button>: this is the primary interactive element of the whole app
    // and must be reachable and activatable by keyboard, not a div with a
    // handler. The motion wrapper animates it without changing its semantics.
    <motion.button
      type="button"
      className="disc-tile"
      onClick={() => {
        onOpen(disc);
      }}
      // Only transform and opacity: these run on the compositor, so a shelf full
      // of tiles stays at 60fps.
      //
      // Spread conditionally rather than passing `undefined`: with
      // `exactOptionalPropertyTypes` an explicit undefined is not the same as an
      // absent prop, and Motion's types reject it.
      {...(reduced
        ? {}
        : {
            whileHover: { scale: 1.04, y: -4 },
            whileTap: { scale: 0.97 },
          })}
      transition={reduced ? REDUCED_TRANSITION : transition('fast')}
      aria-label={`${disc.title} by ${disc.artist}${year === null ? '' : `, ${year}`}`}
    >
      <span className="disc-tile__case">
        {/* The disc peeking out from behind the cover. Purely decorative, but it
            is what makes a tile read as an object in a case rather than a photo. */}
        <span aria-hidden="true" className="disc-tile__disc" />

        {!isOpen && (
          <motion.img
            // Pairs with the cover in the detail view so opening grows out of
            // this tile. Dropped while open so the detail view owns the element.
            layoutId={`cover-${disc.id}`}
            className="disc-tile__cover"
            src={disc.thumbnail?.url ?? ''}
            alt=""
            width={disc.thumbnail?.width ?? 300}
            height={disc.thumbnail?.height ?? 300}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        )}
      </span>

      <span className="disc-tile__meta">
        <span className="disc-tile__title">{disc.title}</span>
        <span className="disc-tile__artist">{disc.artist}</span>
        <span className="disc-tile__footer">
          {year !== null && <span className="disc-tile__year">{year}</span>}
          <CountryBadge country={disc.country} />
        </span>
      </span>
    </motion.button>
  );
}
