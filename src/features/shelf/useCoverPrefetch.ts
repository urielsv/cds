import { useEffect } from 'react';

import { type DiscIndexEntry } from '@shared/disc';

import { type TileRange } from './camera';
import { coverLoader } from '@/lib/coverLoader';
import { type WallPlacement } from './layout';

/**
 * How far around the mounted window to warm, in screens, on every side. Two
 * screens is what a hard flick in any direction can reach (see `THROW_REACH_MS`
 * in the controller), so a throw lands on covers that are already cached —
 * sideways as well as up and down.
 */
const WARM_SCREENS = 2;

/** Never less than this many cells around the window, however zoomed in. */
const MIN_RING_CELLS = 3;

/**
 * Warming waits for the view to settle this long. A flick passes over many rows
 * the user never sees, and fetching those would spend the budget on scenery.
 */
const SETTLE_MS = 120;

/**
 * Most covers handed to the loader per settle. Two screens around a zoomed-out
 * view can be most of the collection; this keeps one settle from queueing
 * megabytes the user may never pan to. The loader's memory budget bounds the
 * session as a whole.
 */
const MAX_PER_SETTLE = 160;

/** Artwork is served from one or two hosts; more than this is not a CDN. */
const MAX_PRECONNECT = 2;

interface NetworkNavigator extends Navigator {
  connection?: { saveData?: boolean; effectiveType?: string };
}

/**
 * Covers to warm around `range`, nearest first: every cover within `ring`
 * cells of the window on any side, excluding those inside it (mounted tiles
 * fetch their own). Distance is measured to the window's edge, so the column
 * just off the right of the screen comes before the row five screens down.
 */
export function prefetchOrder(
  wall: WallPlacement,
  range: TileRange,
  ring: { columns: number; rows: number },
): number[] {
  if (range.lastRow < range.firstRow || range.lastColumn < range.firstColumn) return [];
  const firstRow = Math.max(0, range.firstRow - ring.rows);
  const lastRow = Math.min(wall.rows - 1, range.lastRow + ring.rows);

  const found: { index: number; distance: number }[] = [];
  const seen = new Set<number>();
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (const index of wall.byRow[row] ?? []) {
      if (seen.has(index)) continue;
      seen.add(index);
      const p = wall.placements[index];
      if (!p) continue;
      const right = p.column + p.span - 1;
      const bottom = p.row + p.span - 1;
      // Cells between the cover and the window on each axis; 0 if overlapping.
      const dx = Math.max(0, range.firstColumn - right, p.column - range.lastColumn);
      const dy = Math.max(0, range.firstRow - bottom, p.row - range.lastRow);
      if (dx === 0 && dy === 0) continue;
      if (dx > ring.columns || dy > ring.rows) continue;
      found.push({ index, distance: Math.max(dx, dy) + (dx + dy) / 1000 });
    }
  }
  return found.sort((a, b) => a.distance - b.distance).map((entry) => entry.index);
}

/**
 * Warms the cover art around the viewport.
 *
 * Hands the covers within two screens of the window to the loader's
 * background queue, nearest first, once the view has settled. The loader
 * holds them in memory and only spends network the screen is not using, so a
 * pan or throw lands on covers that are already there — including the ones
 * off to the sides.
 *
 * Skipped entirely when the user has asked to save data or is on a very slow
 * connection.
 */
export function useCoverPrefetch(
  discs: readonly DiscIndexEntry[],
  wall: WallPlacement,
  range: TileRange,
): void {
  // Open the connection to wherever the artwork lives as soon as the index is
  // known, so the first screen of covers does not also pay DNS + TLS. Derived
  // from the data rather than hard-coded, because the Blob store's host is
  // per-deployment.
  useEffect(() => {
    const origins = new Set<string>();
    for (const disc of discs) {
      const url = disc.thumbnail?.url;
      if (url === undefined) continue;
      try {
        origins.add(new URL(url, window.location.href).origin);
      } catch {
        /* Not a URL we can preconnect to; the image will still load. */
      }
      if (origins.size >= MAX_PRECONNECT) break;
    }
    const warmed = new Set(
      Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"]'), (l) =>
        l.href.replace(/\/$/, ''),
      ),
    );
    for (const origin of origins) {
      if (origin === window.location.origin || warmed.has(origin)) continue;
      const link = document.createElement('link');
      link.rel = 'preconnect';
      // Covers are fetched with CORS and no credentials (see coverLoader),
      // which use the anonymous connection pool; a preconnect without
      // `crossorigin` would warm a socket they never use.
      link.crossOrigin = 'anonymous';
      link.href = origin;
      document.head.append(link);
    }
  }, [discs]);

  useEffect(() => {
    const connection = (navigator as NetworkNavigator).connection;
    if (connection?.saveData === true) return;
    if (connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return;

    const timer = window.setTimeout(() => {
      const visibleColumns = range.lastColumn - range.firstColumn + 1;
      const visibleRows = range.lastRow - range.firstRow + 1;
      const order = prefetchOrder(wall, range, {
        columns: Math.max(MIN_RING_CELLS, visibleColumns * WARM_SCREENS),
        rows: Math.max(MIN_RING_CELLS, visibleRows * WARM_SCREENS),
      });

      const urls: string[] = [];
      for (const index of order) {
        const url = discs[index]?.thumbnail?.url;
        if (url === undefined || coverLoader.isSettled(url)) continue;
        urls.push(url);
        if (urls.length >= MAX_PER_SETTLE) break;
      }
      coverLoader.prefetch(urls);
    }, SETTLE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [discs, wall, range]);
}
