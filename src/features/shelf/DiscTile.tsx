import { memo, useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { type DiscIndexEntry } from '@shared/disc';
import { releaseYear } from '@shared/format';

import { type Placement, TILE_SIZE } from './camera';
import { isDark } from './contrast';
import { coverLoader } from '@/lib/coverLoader';
import { accessibleTileName } from './tileName';

/**
 * Tiles overlap their neighbours by this many world units. Adjacent images
 * scaled by a fractional camera transform otherwise anti-alias their shared
 * edge and leave a hairline of background showing between every cover — the
 * one thing a borderless mosaic cannot have.
 */
const SEAM_OVERLAP = 0.75;

interface DiscTileProps {
  disc: DiscIndexEntry;
  index: number;
  /** Where this cover sits on the wall, in cells, and how many it spans. */
  placement: Placement;
  /** Greyed out because it does not match the current search or filters. */
  dimmed: boolean;
  /** Hidden while its disc is open, so the cover appears to have left the wall. */
  lifted: boolean;
  /** Just added: plays the settle-in once. */
  arrived: boolean;
  /** Roving tabindex: exactly one tile in the mosaic is in the tab order. */
  focusable: boolean;
  onOpen: (disc: DiscIndexEntry, index: number) => void;
  onFocusTile: (index: number) => void;
  registerElement: (id: string, element: HTMLButtonElement | null) => void;
}

/**
 * One cover in the mosaic: nothing but the artwork, edge to edge.
 *
 * Positioned in world units inside the camera surface, so its transform is
 * written once when it mounts or moves in the order — never during a pan.
 */
export const DiscTile = memo(function DiscTile({
  disc,
  index,
  placement,
  dimmed,
  lifted,
  arrived,
  focusable,
  onOpen,
  onFocusTile,
  registerElement,
}: DiscTileProps) {
  const thumbnail = disc.thumbnail;
  const coverUrl = thumbnail?.url;

  // Re-renders only when this tile's own cover changes state.
  const subscribe = useCallback(
    (listener: () => void) =>
      coverUrl === undefined ? () => undefined : coverLoader.subscribeUrl(coverUrl, listener),
    [coverUrl],
  );
  useSyncExternalStore(subscribe, () =>
    coverUrl === undefined ? '' : coverLoader.snapshot(coverUrl),
  );
  const state = coverUrl === undefined ? 'idle' : coverLoader.state(coverUrl);
  const src = coverUrl === undefined ? null : coverLoader.src(coverUrl);
  const failed = state === 'failed';

  // Mounted: this cover is wanted now, ahead of anything being prefetched.
  useEffect(() => {
    if (coverUrl === undefined) return;
    return coverLoader.want(coverUrl);
  }, [coverUrl]);

  // A cover already in memory mounts visible — no fade, no placeholder flash
  // on every pan back over it. Anything else fades in once it has painted.
  const [shown, setShown] = useState(() => state === 'ready');
  const reveal = useCallback(() => {
    if (coverUrl !== undefined) coverLoader.markLoaded(coverUrl);
    setShown(true);
  }, [coverUrl]);

  /**
   * An image already complete before React attaches a load listener (a blob,
   * or a cache hit) never fires `onLoad`. Without this check it would stay
   * invisible behind its colour — the faster the cover, the more likely.
   */
  const watchCover = useCallback(
    (image: HTMLImageElement | null) => {
      if (image?.complete === true && image.naturalWidth > 0) reveal();
    },
    [reveal],
  );

  const pending = coverUrl !== undefined && !shown && !failed;
  // Label ink chosen against the tile's own colour, so it reads on any cover.
  const ink =
    disc.color !== null && disc.color !== undefined && isDark(disc.color) ? 'light' : 'dark';

  const year = releaseYear(disc.releaseDate);
  const size = placement.span * TILE_SIZE;

  const className = [
    'disc-tile',
    dimmed && 'disc-tile--dimmed',
    lifted && 'disc-tile--lifted',
    arrived && 'disc-tile--arrived',
    shown && 'disc-tile--loaded',
    pending && 'disc-tile--pending',
    pending && `disc-tile--ink-${ink}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // A real <button>: the primary interactive element of the app must be
    // reachable and activatable by keyboard and screen reader.
    <button
      ref={(element) => {
        registerElement(disc.id, element);
      }}
      type="button"
      className={className}
      data-index={index}
      tabIndex={focusable ? 0 : -1}
      style={{
        width: size + SEAM_OVERLAP,
        height: size + SEAM_OVERLAP,
        // The average cover colour fills the tile before the artwork arrives,
        // so the wall reads as a wall of colour rather than of holes.
        backgroundColor: disc.color ?? undefined,
        // …and the stored tiny placeholder, when there is one, sharpens that
        // into a blurred preview of the actual cover.
        backgroundImage:
          thumbnail?.placeholder && !shown ? `url("${thumbnail.placeholder}")` : undefined,
        transform: `translate3d(${placement.column * TILE_SIZE}px, ${placement.row * TILE_SIZE}px, 0)`,
        // Blocks are drawn above their neighbours so the seam overlap of a
        // large cover never shows as a line across a small one.
        zIndex: placement.span,
      }}
      onClick={() => {
        onOpen(disc, index);
      }}
      onFocus={() => {
        onFocusTile(index);
      }}
      aria-label={accessibleTileName(disc, dimmed)}
    >
      {thumbnail && !failed ? (
        src !== null && (
          <img
            ref={watchCover}
            className="disc-tile__cover"
            src={src}
            alt=""
            width={thumbnail.width}
            height={thumbnail.height}
            // Not `lazy`: the wall only mounts covers at or near the screen, so
            // windowing already does what lazy loading would.
            loading="eager"
            fetchPriority="high"
            decoding="async"
            draggable={false}
            onLoad={reveal}
            onError={() => {
              coverLoader.markFailed(thumbnail.url);
            }}
          />
        )
      ) : (
        // No artwork, or it would not load: a typographic cover rather than an
        // empty square.
        <span className="disc-tile__typeset" aria-hidden="true">
          <span className="disc-tile__typeset-title">{disc.title}</span>
          <span className="disc-tile__typeset-artist">{disc.artist}</span>
        </span>
      )}

      {/* While its cover is on the way, a tile says what it is. Every slot
          reads differently — the shelf is legible before any artwork — and it
          is gone the moment the cover lands. Hidden by CSS when zoomed too far
          out to read. */}
      {pending && (
        <span className="disc-tile__pending-label" aria-hidden="true">
          <span className="disc-tile__pending-title">{disc.title}</span>
          <span className="disc-tile__pending-artist">{disc.artist}</span>
        </span>
      )}

      {/* Hover caption for pointer users. Decorative: the button's accessible
          name already carries the same text. */}
      <span className="disc-tile__caption" aria-hidden="true">
        <span className="disc-tile__caption-title">{disc.title}</span>
        <span className="disc-tile__caption-artist">
          {disc.artist}
          {year === null ? '' : ` · ${year}`}
        </span>
      </span>
    </button>
  );
});
