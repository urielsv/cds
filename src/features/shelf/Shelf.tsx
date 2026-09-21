import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { type DiscIndexEntry } from '@shared/disc';

import { DiscTile } from './DiscTile';

interface ShelfProps {
  discs: readonly DiscIndexEntry[];
  onOpen: (disc: DiscIndexEntry) => void;
  openDiscId: string | null;
}

/** Tile footprint including its gap, in pixels. Matches the CSS tokens. */
const TILE_WIDTH = 148;
const TILE_HEIGHT = 210;

/**
 * Keep enough off-screen tiles mounted that a fast flick does not reveal gaps,
 * without mounting a screenful of invisible work. Two was too few on a fast
 * swipe; above four the win disappears and the mounted count grows.
 */
const OVERSCAN = 3;

/**
 * The browsable shelf: a two-dimensional plane of discs that pans in both
 * directions.
 *
 * Built on native scrolling rather than a hand-rolled pointer-drag transform.
 * That is deliberate: iOS momentum and rubber-band physics are extremely hard to
 * reproduce convincingly, and native scroll tracks the finger perfectly for free.
 * Desktop gets drag-to-pan layered on top, since there is no touch surface there.
 *
 * Virtualised on both axes, so frame cost does not grow with the collection.
 */
export function Shelf({ discs, onOpen, openDiscId }: ShelfProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () => {
      setViewportWidth(element.clientWidth);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  /**
   * Lay the collection out as a wide, roughly square plane so there is something
   * to explore in both directions, but never narrower than the viewport or the
   * horizontal axis becomes pointless.
   */
  const columnCount = useMemo(() => {
    if (discs.length === 0) return 1;
    const squareish = Math.ceil(Math.sqrt(discs.length) * 1.3);
    const minimumToFill = Math.max(1, Math.floor(viewportWidth / TILE_WIDTH));
    return Math.max(squareish, minimumToFill);
  }, [discs.length, viewportWidth]);

  const rowCount = Math.max(1, Math.ceil(discs.length / columnCount));

  /*
   * React Compiler cannot memoize `useVirtualizer` because it returns functions,
   * so it skips memoizing this component. That is acceptable and even preferable
   * here: the shelf's performance is managed explicitly through virtualisation
   * and compositor-only transforms rather than by automatic memoization, and the
   * virtualizers must recompute on every scroll frame anyway.
   */
  /* eslint-disable react-hooks/incompatible-library */
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TILE_HEIGHT,
    overscan: OVERSCAN,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columnCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TILE_WIDTH,
    overscan: OVERSCAN,
  });
  /* eslint-enable react-hooks/incompatible-library */

  // Desktop drag-to-pan. Touch devices already have native panning, and hijacking
  // it there would fight momentum scrolling.
  const dragState = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    const element = scrollRef.current;
    if (!element) return;

    dragState.current = {
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    };
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    const element = scrollRef.current;
    if (!state || !element) return;

    // 1:1 with the pointer, no easing: any lag here destroys the sense of
    // handling a physical thing.
    element.scrollLeft = state.left - (event.clientX - state.x);
    element.scrollTop = state.top - (event.clientY - state.y);
  }, []);

  const endDrag = useCallback(() => {
    dragState.current = null;
  }, []);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      className="shelf"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      {/* One sized surface. Tiles are positioned inside it, so panning moves this
          single element rather than updating every tile. */}
      <div
        className="shelf__surface"
        style={{
          width: columnVirtualizer.getTotalSize(),
          height: rowVirtualizer.getTotalSize(),
        }}
      >
        {virtualRows.map((row) =>
          virtualColumns.map((column) => {
            const index = row.index * columnCount + column.index;
            const disc = discs[index];
            if (!disc) return null;

            return (
              <div
                key={disc.id}
                className="shelf__cell"
                style={{
                  width: column.size,
                  height: row.size,
                  // translate3d keeps positioning on the compositor.
                  transform: `translate3d(${column.start}px, ${row.start}px, 0)`,
                }}
              >
                <DiscTile disc={disc} onOpen={onOpen} isOpen={disc.id === openDiscId} />
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
