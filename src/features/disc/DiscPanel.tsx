import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

import { CountryBadge } from '@/components/CountryBadge';
import { REDUCED_TRANSITION, transition } from '@/motion/tokens';
import { type DiscIndexEntry } from '@shared/disc';
import { releaseYear } from '@shared/format';

interface DiscPanelProps {
  disc: DiscIndexEntry;
  onClose: () => void;
}

/**
 * The opened disc.
 *
 * Spike-stage: renders what the collection index carries. Track durations, the
 * back cover, packaging and personal notes arrive with the real detail document
 * (spec task 5.1) — the index deliberately does not carry them.
 */
export function DiscPanel({ disc, onClose }: DiscPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const closeRef = useRef<HTMLButtonElement>(null);
  const year = releaseYear(disc.releaseDate);

  // Focus moves into the panel on open so a keyboard or screen reader user is not
  // left behind on the shelf. Returning focus to the originating tile on close is
  // handled by the shelf, which owns that element.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <motion.div
      className="disc-panel"
      role="dialog"
      aria-modal="true"
      aria-label={`${disc.title} by ${disc.artist}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reduced ? REDUCED_TRANSITION : transition('base')}
    >
      {/* Scrim. A plain button so dismissing by tapping outside is also a real,
          labelled control rather than a click handler on a div. */}
      <button type="button" className="disc-panel__scrim" onClick={onClose} aria-label="Close" />

      <motion.div
        className="disc-panel__sheet"
        initial={reduced ? { opacity: 0 } : { y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { y: 24, opacity: 0 }}
        transition={reduced ? REDUCED_TRANSITION : transition('slow', 'entrance')}
      >
        <div className="disc-panel__art">
          <motion.img
            // The pairing that makes the panel grow out of the tapped tile.
            layoutId={`cover-${disc.id}`}
            className="disc-panel__cover"
            src={disc.thumbnail?.url ?? ''}
            alt={`Cover of ${disc.title} by ${disc.artist}`}
            width={disc.thumbnail?.width ?? 300}
            height={disc.thumbnail?.height ?? 300}
            draggable={false}
          />
        </div>

        <div className="disc-panel__body">
          <header className="disc-panel__header">
            <h2 className="disc-panel__title">{disc.title}</h2>
            <p className="disc-panel__artist">{disc.artist}</p>
          </header>

          <dl className="disc-panel__facts">
            {year !== null && (
              <div className="disc-panel__fact">
                <dt>Released</dt>
                <dd>{disc.releaseDate}</dd>
              </div>
            )}
            {disc.country !== null && (
              <div className="disc-panel__fact">
                <dt>Origin</dt>
                <dd>
                  <CountryBadge country={disc.country} size="detail" />
                </dd>
              </div>
            )}
            {disc.format !== null && (
              <div className="disc-panel__fact">
                <dt>Format</dt>
                <dd>{disc.format}</dd>
              </div>
            )}
            {disc.labels.length > 0 && (
              <div className="disc-panel__fact">
                <dt>Label</dt>
                <dd>{disc.labels.join(' · ')}</dd>
              </div>
            )}
          </dl>

          {disc.genres.length > 0 && (
            <ul className="disc-panel__genres">
              {disc.genres.map((genre) => (
                <li key={genre} className="disc-panel__genre">
                  {genre}
                </li>
              ))}
            </ul>
          )}

          <section className="disc-panel__tracks">
            <h3 className="disc-panel__tracks-heading">
              {disc.trackTitles.length} track{disc.trackTitles.length === 1 ? '' : 's'}
            </h3>
            <ol className="disc-panel__tracklist">
              {disc.trackTitles.map((track, i) => (
                <li key={`${track}-${String(i)}`} className="disc-panel__track">
                  <span className="disc-panel__track-number">{i + 1}</span>
                  <span className="disc-panel__track-title">{track}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <button ref={closeRef} type="button" className="disc-panel__close" onClick={onClose}>
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}
