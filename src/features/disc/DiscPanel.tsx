import { animate, useReducedMotion } from 'motion/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { CountryBadge } from '@/components/CountryBadge';
import { EditDiscSheet } from '@/features/disc/EditDiscSheet';
import { loadDisc } from '@/lib/collection';
import { coverLoader } from '@/lib/coverLoader';
import { REDUCED_TRANSITION, transition } from '@/motion/tokens';
import { type Disc, type DiscIndexEntry } from '@shared/disc';
import { formatDuration, releaseYear, totalRuntimeMs } from '@shared/format';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How much of the record's colour reaches the page canvas while it is open:
 * roughly what survives of it through the backdrop (the cover at 55% under a
 * 62% white scrim), so the strip under the status bar reads as the same room.
 */
const CANVAS_TINT = 25;

interface DiscPanelProps {
  disc: DiscIndexEntry;
  /** Where the tile is on screen right now; null when it cannot be located. */
  originRect: () => ScreenRect | null;
  /** Called once the closing animation has finished and the panel can unmount. */
  onClosed: () => void;
  /** Owner-only: show Edit/Delete affordances. Server re-checks every write. */
  canEdit?: boolean;
  /** Owner edited this disc; the index entry has been replaced. */
  onEdited?: (entry: DiscIndexEntry) => void;
  /** Owner deleted this disc; it should leave the shelf and the panel close. */
  onDeleted?: (id: string) => void;
  /** The session lapsed mid-edit; prompt a re-sign-in. */
  onSessionExpired?: () => void;
}

function isOnScreen(rect: ScreenRect | null): rect is ScreenRect {
  return (
    rect !== null &&
    rect.width > 0 &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0 &&
    rect.x < window.innerWidth &&
    rect.y < window.innerHeight
  );
}

/** Transform that makes an element at `to` appear exactly at `from`. */
function invert(from: ScreenRect, to: DOMRect) {
  return {
    x: from.x - to.left,
    y: from.y - to.top,
    scale: from.width / to.width,
  };
}

/**
 * The opened disc.
 *
 * The cover grows out of the tile that was tapped and shrinks back into it
 * (requirements 2.1, 2.6). This is a hand-written, transform-only FLIP rather
 * than Motion's `layoutId`, for a concrete reason: the tile lives inside the
 * mosaic's camera surface, which carries its own `scale()` transform. Motion's
 * projection only corrects for ancestors that are Motion components, so a
 * shared layout animation from inside that surface is off by the camera scale
 * on the way back. Measuring both ends in screen space and animating the one
 * element outside the surface is exact at every zoom level.
 */
export function DiscPanel({
  disc,
  originRect,
  onClosed,
  canEdit = false,
  onEdited,
  onDeleted,
  onSessionExpired,
}: DiscPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLElement | null>(null);
  const setCover = useCallback((element: HTMLElement | null) => {
    coverRef.current = element;
  }, []);
  const backdropRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const [detail, setDetail] = useState<Disc | null>(null);
  const [editing, setEditing] = useState(false);

  /**
   * The panel is page content, placed where the page is scrolled (see
   * `.disc-panel`): only the page's own content shows under Safari's
   * translucent toolbars. The page is held still while it is open, or a
   * scroll that chained out of a short track list would carry the panel away
   * with the wall.
   */
  const [top] = useState(() => window.scrollY);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    const previousBackground = root.style.backgroundColor;
    root.style.overflow = 'hidden';
    // Opened at (or near) the top of the page, there is no page above the
    // panel for its backdrop to extend into, and Safari shows the page's
    // canvas under the status bar instead — white. Colour the canvas like the
    // room: the record's colour, washed out as the backdrop's scrim washes it.
    // On the root, not the body: Safari tints its toolbar fade from the body's
    // colour, which stays clear (see global.css).
    if (disc.color) {
      root.style.backgroundColor = `color-mix(in srgb, ${disc.color} ${String(CANVAS_TINT)}%, #fff)`;
    }
    return () => {
      root.style.overflow = previous;
      root.style.backgroundColor = previousBackground;
    };
  }, [disc.color]);

  const year = releaseYear(disc.releaseDate);
  const cover = detail?.images.find((image) => image.kind === 'front' && image.width > 600);
  const coverUrl = disc.thumbnail?.url;

  // The cover was almost certainly just on the shelf, so it is already in
  // memory: show that copy at once instead of asking the network again. (For
  // the demo, asking again means ~1.7 s of uncacheable redirects before the
  // cached image — a panel that opens onto a blank square.)
  const subscribeCover = useCallback(
    (listener: () => void) =>
      coverUrl === undefined ? () => undefined : coverLoader.subscribeUrl(coverUrl, listener),
    [coverUrl],
  );
  const loadedCover = useSyncExternalStore(subscribeCover, () =>
    coverUrl === undefined ? null : coverLoader.src(coverUrl),
  );
  // Held while the panel is open, so the copy on show is never evicted from
  // under it, and fetched first if it somehow is not in memory yet.
  useEffect(() => {
    if (coverUrl === undefined) return;
    return coverLoader.want(coverUrl);
  }, [coverUrl]);

  /**
   * The large image replaces the tile-sized one only once it is downloaded
   * and decoded, so the swap is a sharpening in place. Offering both through
   * `srcset` instead lets the browser pick the large one up front and show
   * nothing until it arrives — replacing an image already on screen with a
   * wait.
   */
  const [largeReady, setLargeReady] = useState<string | null>(null);
  useEffect(() => {
    if (!cover) return;
    let cancelled = false;
    const image = new Image();
    image.decoding = 'async';
    image.src = cover.url;
    // `decode()` where it exists, so the swap never shows a half-decoded image.
    const decoded =
      typeof image.decode === 'function'
        ? image.decode()
        : new Promise<void>((resolve, reject) => {
            image.onload = () => {
              resolve();
            };
            image.onerror = reject;
          });
    decoded
      .then(() => {
        if (!cancelled) setLargeReady(cover.url);
      })
      .catch(() => {
        /* Keep showing the tile-sized cover; it is complete, just smaller. */
      });
    return () => {
      cancelled = true;
    };
  }, [cover]);
  const coverSrc = largeReady ?? loadedCover ?? coverUrl;

  // The full record adds durations, catalogue number and notes. The panel is
  // complete without it; this only enriches it when it arrives.
  useEffect(() => {
    const controller = new AbortController();
    loadDisc(disc.id, controller.signal)
      .then(setDetail)
      .catch(() => {
        /* The index entry is enough to show; the detail is a bonus. */
      });
    return () => {
      controller.abort();
    };
  }, [disc.id]);

  // Opening. Runs before paint, so the cover is never seen in its final place
  // first and then jumping back to the tile.
  useLayoutEffect(() => {
    const coverElement = coverRef.current;
    const backdrop = backdropRef.current;
    const body = bodyRef.current;
    if (!coverElement || !backdrop || !body) return;

    closeRef.current?.focus({ preventScroll: true });

    const fade = reduced ? REDUCED_TRANSITION : transition('base');
    void animate(backdrop, { opacity: [0, 1] }, fade);
    void animate(
      body,
      reduced ? { opacity: [0, 1] } : { opacity: [0, 1], y: [16, 0] },
      reduced ? REDUCED_TRANSITION : { ...transition('slow', 'entrance'), delay: 0.06 },
    );

    const origin = originRect();
    if (reduced || !isOnScreen(origin)) {
      // Reduced motion, or a tile that is not on screen: cross-fade instead of
      // flying. The destination is the same; only the travel is dropped.
      void animate(coverElement, { opacity: [0, 1] }, fade);
      return;
    }
    const start = invert(origin, coverElement.getBoundingClientRect());
    void animate(
      coverElement,
      { x: [start.x, 0], y: [start.y, 0], scale: [start.scale, 1] },
      transition('deliberate', 'entrance'),
    );
    // Deliberately run once: the opening happens exactly once per panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const coverElement = coverRef.current;
    const backdrop = backdropRef.current;
    const body = bodyRef.current;
    if (!coverElement || !backdrop || !body) {
      onClosed();
      return;
    }

    const fade = reduced ? REDUCED_TRANSITION : transition('base', 'exit');
    void animate(backdrop, { opacity: 0 }, fade);
    void animate(body, { opacity: 0 }, reduced ? REDUCED_TRANSITION : transition('fast', 'exit'));
    if (closeRef.current) void animate(closeRef.current, { opacity: 0 }, fade);

    const origin = originRect();
    if (reduced || !isOnScreen(origin)) {
      void animate(coverElement, { opacity: 0 }, fade).then(onClosed);
      return;
    }
    // Measure where the cover is now — the sheet may have been scrolled — and
    // send it home, relative to that.
    const rect = coverElement.getBoundingClientRect();
    const current = { x: 0, y: 0, scale: 1 };
    const target = invert(origin, rect);
    void animate(
      coverElement,
      {
        x: [current.x, target.x],
        y: [current.y, target.y],
        scale: [current.scale, target.scale],
      },
      transition('slow', 'standard'),
    ).then(onClosed);
  }, [onClosed, originRect, reduced]);

  // Escape closes; Tab stays inside the dialog while it is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !rootRef.current) return;
      const focusable = [
        ...rootRef.current.querySelectorAll<HTMLElement>('button, [href], [tabindex="0"]'),
      ].filter((element) => !element.hasAttribute('disabled'));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [close]);

  const tracks =
    detail?.tracks ??
    disc.trackTitles.map((title, i) => ({
      position: i + 1,
      title,
      lengthMs: null,
      artist: null,
    }));
  const runtime = detail ? totalRuntimeMs(detail.tracks) : null;
  const facts: { label: string; value: ReactNode }[] = [];
  if (disc.releaseDate !== null) facts.push({ label: 'Released', value: disc.releaseDate });
  if (disc.country !== null) {
    facts.push({
      label: 'Origin',
      value: (
        <CountryBadge
          country={disc.country}
          size="detail"
          isManual={detail?.manualFields.includes('country') ?? false}
        />
      ),
    });
  }
  if (disc.format !== null) {
    facts.push({
      label: 'Format',
      value:
        detail && detail.discCount > 1
          ? `${disc.format} ×${String(detail.discCount)}`
          : disc.format,
    });
  }
  if (disc.labels.length > 0) facts.push({ label: 'Label', value: disc.labels.join(' · ') });
  if (detail?.catalogNumber) facts.push({ label: 'Catalogue', value: detail.catalogNumber });
  if (detail?.packaging) facts.push({ label: 'Packaging', value: detail.packaging });
  if (detail?.barcode) facts.push({ label: 'Barcode', value: detail.barcode });

  return (
    <div
      ref={rootRef}
      className="disc-panel"
      style={{ top }}
      role="dialog"
      aria-modal="true"
      aria-label={`${disc.title} by ${disc.artist}`}
    >
      <div ref={backdropRef} className="disc-panel__backdrop">
        {/* The cover itself, blurred to fill the screen: the room takes on the
            colour of the record. One static element, painted once. */}
        {coverSrc && <img className="disc-panel__ambient" src={loadedCover ?? coverSrc} alt="" />}
        <div className="disc-panel__scrim" />
      </div>

      <div className="disc-panel__scroll">
        {/* The tap-outside-to-close target lives inside the scroller, behind
            the content, rather than under it. iOS Safari will not scroll a
            container that is `pointer-events: none` (as it used to be, so
            taps fell through to the scrim) even when the finger lands on a
            child that takes pointer events: the track list could not scroll. */}
        <div className="disc-panel__content">
          <button
            type="button"
            className="disc-panel__dismiss"
            onClick={close}
            aria-label="Close"
            tabIndex={-1}
          />
          <div className="disc-panel__layout">
            <div className="disc-panel__art">
              {coverSrc ? (
                <img
                  ref={setCover}
                  className="disc-panel__cover"
                  src={coverSrc}
                  alt={`Cover of ${disc.title} by ${disc.artist}`}
                  width={disc.thumbnail?.width ?? 500}
                  height={disc.thumbnail?.height ?? 500}
                  style={{ backgroundColor: disc.color ?? undefined }}
                  draggable={false}
                />
              ) : (
                <div
                  ref={setCover}
                  className="disc-panel__cover disc-panel__cover--typeset"
                  style={{ backgroundColor: disc.color ?? undefined }}
                  role="img"
                  aria-label={`No artwork for ${disc.title}`}
                >
                  <span>{disc.title}</span>
                </div>
              )}
            </div>

            <div ref={bodyRef} className="disc-panel__body">
              <header className="disc-panel__header">
                <h2 className="disc-panel__title">{disc.title}</h2>
                <p className="disc-panel__artist">
                  {disc.artist}
                  {year !== null && <span className="disc-panel__year"> · {year}</span>}
                </p>
              </header>

              {facts.length > 0 && (
                <dl className="disc-panel__facts">
                  {facts.map((fact) => (
                    <div key={fact.label} className="disc-panel__fact">
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {disc.genres.length > 0 && (
                <ul className="disc-panel__genres" aria-label="Genres">
                  {disc.genres.map((genre) => (
                    <li key={genre} className="disc-panel__genre">
                      {genre}
                    </li>
                  ))}
                </ul>
              )}

              {detail?.notes && <p className="disc-panel__notes">{detail.notes}</p>}

              {tracks.length > 0 && (
                <section className="disc-panel__tracks" aria-label="Tracks">
                  <h3 className="disc-panel__tracks-heading">
                    {tracks.length} track{tracks.length === 1 ? '' : 's'}
                    {runtime !== null && ` · ${formatDuration(runtime)}`}
                  </h3>
                  <ol className="disc-panel__tracklist">
                    {tracks.map((track) => (
                      <li key={track.position} className="disc-panel__track">
                        <span className="disc-panel__track-number">{track.position}</span>
                        <span className="disc-panel__track-title">
                          {track.title}
                          {track.artist !== null && (
                            <span className="disc-panel__track-artist"> — {track.artist}</span>
                          )}
                        </span>
                        {track.lengthMs !== null && (
                          <span className="disc-panel__track-length">
                            {formatDuration(track.lengthMs)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>

      <button ref={closeRef} type="button" className="disc-panel__close glass" onClick={close}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span className="visually-hidden">Close</span>
      </button>

      {canEdit && (
        <button
          type="button"
          className="disc-panel__edit glass"
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit
        </button>
      )}

      {editing && (
        <EditDiscSheet
          entry={disc}
          detail={detail}
          onClose={() => {
            setEditing(false);
          }}
          onEdited={(entry) => {
            setEditing(false);
            onEdited?.(entry);
          }}
          onDeleted={(id) => {
            setEditing(false);
            // Close the panel; App removes the entry from the shelf.
            onDeleted?.(id);
            onClosed();
          }}
          onSessionExpired={() => {
            setEditing(false);
            onSessionExpired?.();
          }}
        />
      )}
    </div>
  );
}
