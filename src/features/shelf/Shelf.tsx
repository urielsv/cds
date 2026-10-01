import { useReducedMotion } from 'motion/react';
import {
  type Ref,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { durationMs, springTransition, transition } from '@/motion/tokens';
import { type DiscIndexEntry } from '@shared/disc';

import {
  type Camera,
  clamp,
  columnsAtScale,
  gridLayoutOf,
  initialColumnsWanted,
  nearestColumns,
  type Placement,
  revealTile,
  sameRange,
  scaleForColumns,
  snapCamera,
  snapCells,
  TILE_SIZE,
  tileRect,
  type TileRange,
  type Viewport,
  visibleRange,
  widthColumns,
  zoomAt,
} from './camera';
import { CameraController } from './cameraController';
import { DiscTile } from './DiscTile';
import { ShelfIntro } from './ShelfIntro';
import { indexAt, packMosaic, rowCounter, spansFor } from './layout';
import { useCoverPrefetch } from './useCoverPrefetch';
import { useCameraGestures } from './useCameraGestures';

/**
 * Tiles mounted beyond each screen edge. One ring is enough at this tile size:
 * the range is recomputed on every camera frame, and a fling moves at most a
 * fraction of a tile per frame. Two rings cost ~40% more mounted tiles on a
 * phone for no visible gain.
 */
const OVERSCAN = 1;

/**
 * Above this many mounted tiles, changes that affect every tile (dimming for a
 * search, sliding into a new order) happen instantly instead of animating:
 * animating one property across hundreds of elements is exactly what drops
 * frames on a phone. Zoomed in, only a few dozen are mounted and they animate.
 */
const ANIMATE_ALL_LIMIT = 72;

export interface ShelfHandle {
  /** Screen rectangle of a disc's tile, for the open/close transition. */
  rectFor: (id: string) => { x: number; y: number; width: number; height: number } | null;
  /** One zoom stop in (`1`) or out (`-1`). */
  zoomStep: (direction: 1 | -1) => void;
  showAll: () => void;
  /** Pans (and if needed zooms) until the disc is comfortably in view. */
  reveal: (id: string) => Promise<void>;
  focusDisc: (id: string) => void;
}

interface ShelfProps {
  discs: readonly DiscIndexEntry[];
  /** Ids matching the current search and filters; null means all match. */
  matches: ReadonlySet<string> | null;
  openDiscId: string | null;
  arrivedDiscId: string | null;
  onOpen: (disc: DiscIndexEntry) => void;
  ref?: Ref<ShelfHandle>;
}

const EMPTY_RANGE: TileRange = { firstColumn: 0, lastColumn: -1, firstRow: 0, lastRow: -1 };

/** Covers across before the screen has been measured. */
const UNMEASURED_COLUMNS = 4;

/**
 * A zoom that re-flows the wall, waiting for the render that lays it out at
 * the new column count. `index` is the cover to keep still, at fraction
 * `(fx, fy)` of its block, under the screen point `focus`.
 */
interface PendingReflow {
  index: number;
  fx: number;
  fy: number;
  focus: { x: number; y: number };
  fromScale: number;
  resolve: () => void;
}

/**
 * The collection as one continuous wall of covers — no borders, no gaps, no
 * captions — that pans and zooms like a map.
 *
 * One transformed surface holds every tile at a fixed world position; panning
 * and zooming only ever change that surface's transform (via
 * `CameraController`), and only the tiles near the screen are mounted. So the
 * cost of a frame depends on the screen, not on the size of the collection.
 */
export function Shelf({ discs, matches, openDiscId, arrivedDiscId, onOpen, ref }: ShelfProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const insetProbeRef = useRef<HTMLDivElement>(null);
  const tileElements = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<number | null>(null);

  const reduced = useReducedMotion() ?? false;
  const [controller] = useState(() => new CameraController());
  useEffect(() => {
    controller.setReducedMotion(reduced);
  }, [controller, reduced]);

  const [viewport, setViewport] = useState<Viewport>({
    width: 0,
    height: 0,
    insetTop: 0,
    insetBottom: 0,
  });
  const [range, setRange] = useState<TileRange>(EMPTY_RANGE);
  const [panning, setPanning] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reordering, setReordering] = useState(false);
  const [introUrls, setIntroUrls] = useState<string[] | null>(null);
  const introCaptured = useRef(false);

  /**
   * The wall always spans the screen width; zooming changes how many covers
   * that is, and re-flows the collection to match — the model of a photo
   * library. There is nothing to pan sideways, which on a phone is what makes
   * the wall read as a list to scroll rather than a map to hunt around.
   */
  const spans = useMemo(() => spansFor(discs.length), [discs.length]);
  const rowsFor = useMemo(() => rowCounter(spans), [spans]);
  const allowedColumns = useMemo(
    () =>
      viewport.width > 0 && viewport.height > 0
        ? widthColumns(viewport, spans.length, rowsFor)
        : [UNMEASURED_COLUMNS],
    // Insets do not affect which counts fill the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewport.width, viewport.height, spans.length, rowsFor],
  );
  const [wantedColumns, setWantedColumns] = useState<number | null>(null);
  const columns = nearestColumns(
    allowedColumns,
    wantedColumns ?? (viewport.width > 0 ? initialColumnsWanted(viewport) : UNMEASURED_COLUMNS),
  );

  /**
   * Where every cover sits, in cells. Recomputed only when the collection, the
   * arrangement, or the zoom's column count changes — never mid-gesture.
   */
  const wall = useMemo(() => packMosaic(spans, columns), [spans, columns]);
  const layout = useMemo(
    () => gridLayoutOf(wall.columns, wall.rows, allowedColumns),
    [wall, allowedColumns],
  );
  const wallRef = useRef(wall);
  const pendingReflow = useRef<PendingReflow | null>(null);
  const indexById = useMemo(() => new Map(discs.map((disc, i) => [disc.id, i])), [discs]);
  const placementFor = useCallback(
    (index: number): Placement => wall.placements[index] ?? { column: 0, row: 0, span: 1 },
    [wall],
  );

  // ---- Measuring -----------------------------------------------------------

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const measure = () => {
      // Safe-area insets only exist in CSS (`env()`), so an invisible probe
      // positioned with them is measured instead. Resize-time only.
      const probe = insetProbeRef.current;
      const height = element.clientHeight;
      const insetTop = probe?.offsetTop ?? 0;
      const insetBottom = probe ? Math.max(0, height - probe.offsetTop - probe.offsetHeight) : 0;
      setViewport((previous) =>
        previous.width === element.clientWidth &&
        previous.height === height &&
        previous.insetTop === insetTop &&
        previous.insetBottom === insetBottom
          ? previous
          : { width: element.clientWidth, height, insetTop, insetBottom },
      );
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // ---- Camera --------------------------------------------------------------

  useLayoutEffect(() => {
    controller.attach(surfaceRef.current);
    return () => {
      controller.stop();
      controller.attach(null);
    };
  }, [controller]);

  useLayoutEffect(() => {
    wallRef.current = wall;
  }, [wall]);

  useLayoutEffect(() => {
    if (viewport.width === 0 || viewport.height === 0) return;
    const {
      layout: before,
      viewport: beforeViewport,
      placed,
    } = controller.configure(layout, viewport);
    const fitted = scaleForColumns(viewport, layout.columns);

    const reflow = pendingReflow.current;
    if (reflow) {
      pendingReflow.current = null;
      // The wall has just re-flowed. Put the anchor cover back exactly under
      // the fingers at the scale the gesture left, then spring to the new
      // column count's fit — so the one cover being looked at stays put and
      // everything else rearranges around it.
      const p = wall.placements[reflow.index] ?? { column: 0, row: 0, span: 1 };
      const pointAt = (scale: number) => ({
        x: (p.column + reflow.fx * p.span) * TILE_SIZE * scale,
        y: (p.row + reflow.fy * p.span) * TILE_SIZE * scale,
      });
      const from = pointAt(reflow.fromScale);
      controller.set({
        scale: reflow.fromScale,
        x: reflow.focus.x - from.x,
        y: reflow.focus.y - from.y,
      });
      const to = snapCells(
        { scale: fitted, x: 0, y: reflow.focus.y - pointAt(fitted).y },
        layout,
        viewport,
      );
      void controller.animateTo(to, springTransition('fast')).then(reflow.resolve);
      return;
    }

    if (!placed || beforeViewport.width === 0) {
      controller.set(snapCells({ scale: fitted, x: 0, y: 0 }, layout, viewport));
      return;
    }

    // A rotation, a resize, a new order or arrangement: keep looking at the
    // same stretch of the collection rather than jumping back to the top.
    controller.stop();
    const old = controller.camera;
    const fy = (beforeViewport.height / 2 - old.y) / (before.worldHeight * old.scale);
    controller.set(
      snapCells(
        { scale: fitted, x: 0, y: viewport.height / 2 - fy * layout.worldHeight * fitted },
        layout,
        viewport,
      ),
    );
    controller.release();
  }, [controller, layout, viewport, wall]);

  /**
   * Re-flows the wall to the column count at `targetScale`, keeping the cover
   * under `focus` (or the cover `anchorIndex`, centred on it) where it is.
   */
  const requestReflow = useCallback(
    (targetScale: number, focus: { x: number; y: number }, anchorIndex?: number) =>
      new Promise<void>((resolve) => {
        const current = wallRef.current;
        const vp = controller.viewport;
        const next = nearestColumns(allowedColumns, columnsAtScale(vp, targetScale));
        if (next === current.columns) {
          void controller
            .animateTo(zoomAt(controller.camera, targetScale, focus.x, focus.y))
            .then(resolve);
          return;
        }

        const camera = controller.camera;
        let index = anchorIndex ?? null;
        let fx = 0.5;
        let fy = 0.5;
        if (index === null) {
          const wx = (focus.x - camera.x) / (camera.scale * TILE_SIZE);
          const wy = (focus.y - camera.y) / (camera.scale * TILE_SIZE);
          const row = clamp(Math.floor(wy), 0, current.rows - 1);
          const column = clamp(Math.floor(wx), 0, current.columns - 1);
          // An empty cell (the tail of the last row) anchors on the last cover.
          index = indexAt(current, column, row) ?? Math.max(0, current.placements.length - 1);
          const p = current.placements[index];
          if (p) {
            fx = clamp((wx - p.column) / p.span, 0, 1);
            fy = clamp((wy - p.row) / p.span, 0, 1);
          }
        }
        pendingReflow.current = { index, fx, fy, focus, fromScale: camera.scale, resolve };
        setWantedColumns(next);
      }),
    [allowedColumns, controller],
  );

  useLayoutEffect(() => {
    controller.setReflow((targetScale, focus) => {
      void requestReflow(targetScale, focus);
    });
    return () => {
      controller.setReflow(null);
    };
  }, [controller, requestReflow]);

  useEffect(() => {
    const update = (camera: Camera) => {
      const next = visibleRange(camera, controller.layout, controller.viewport, OVERSCAN);
      setRange((previous) => (sameRange(previous, next) ? previous : next));

      // The intro waits for the covers actually on screen (no overscan), and
      // only for the very first screen the wall ever shows.
      if (introCaptured.current || controller.viewport.width === 0) return;
      const screen = visibleRange(camera, controller.layout, controller.viewport, 0);
      if (screen.lastRow < screen.firstRow) return;
      introCaptured.current = true;
      const urls = new Set<string>();
      for (let row = screen.firstRow; row <= screen.lastRow; row += 1) {
        for (const index of wall.byRow[row] ?? []) {
          const placement = wall.placements[index];
          if (!placement) continue;
          if (placement.column + placement.span <= screen.firstColumn) continue;
          if (placement.column > screen.lastColumn) continue;
          const url = discs[index]?.thumbnail?.url;
          if (url !== undefined) urls.add(url);
        }
      }
      setIntroUrls([...urls]);
    };
    update(controller.camera);
    return controller.subscribe(update);
  }, [controller, layout, viewport, wall, discs]);

  const handlePanningChange = useCallback((value: boolean) => {
    setPanning(value);
  }, []);
  useCameraGestures(viewportRef, controller, handlePanningChange);

  // Warm the artwork just outside the window, so panning reveals covers that
  // are already cached rather than ones that begin loading as they appear.
  useCoverPrefetch(discs, wall, range);

  // ---- Reordering ----------------------------------------------------------

  // When the order changes (a new sort, "group matches"), tiles already on
  // screen slide to their new places. Only for a short window, and only when
  // few enough are mounted — see ANIMATE_ALL_LIMIT.
  const orderKey = useMemo(() => discs.map((disc) => disc.id).join('|'), [discs]);
  const firstOrder = useRef(true);
  useEffect(() => {
    if (firstOrder.current) {
      firstOrder.current = false;
      return;
    }
    setReordering(true);
    const timer = window.setTimeout(() => {
      setReordering(false);
    }, durationMs('slow'));
    return () => {
      window.clearTimeout(timer);
    };
  }, [orderKey]);

  // ---- Keyboard --------------------------------------------------------------

  const registerElement = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) tileElements.current.set(id, element);
    else tileElements.current.delete(id);
  }, []);

  const handleOpen = useCallback(
    (disc: DiscIndexEntry, index: number) => {
      setActiveIndex(index);
      onOpen(disc);
    },
    [onOpen],
  );

  const moveFocus = useCallback(
    (index: number) => {
      const target = clamp(index, 0, discs.length - 1);
      pendingFocus.current = target;
      setActiveIndex(target);
      void controller.animateTo(
        snapCells(
          revealTile(
            placementFor(target),
            controller.camera,
            controller.layout,
            controller.viewport,
          ),
          controller.layout,
          controller.viewport,
        ),
        transition('base'),
      );
    },
    [controller, discs.length, placementFor],
  );

  // Focus lands after the render that mounts the target tile. `preventScroll`
  // matters: the viewport clips overflow, and a browser scrolling it to reveal
  // focus would silently shift the whole plane out from under the camera.
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    const disc = discs[index];
    const element = disc ? tileElements.current.get(disc.id) : undefined;
    if (element) {
      pendingFocus.current = null;
      element.focus({ preventScroll: true });
    }
  });

  // Buttons and keys step between the same stops a pinch settles on.
  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      void controller.step(direction);
    },
    [controller],
  );

  const showAll = useCallback(() => {
    void controller.zoomTo(controller.limits().min);
  }, [controller]);

  const handleKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (discs.length === 0) return;
    const columns = layout.columns;
    const keys: Record<string, () => void> = {
      ArrowRight: () => {
        moveFocus(activeIndex + 1);
      },
      ArrowLeft: () => {
        moveFocus(activeIndex - 1);
      },
      ArrowDown: () => {
        moveFocus(activeIndex + columns);
      },
      ArrowUp: () => {
        moveFocus(activeIndex - columns);
      },
      Home: () => {
        moveFocus(0);
      },
      End: () => {
        moveFocus(discs.length - 1);
      },
      '+': () => {
        zoomStep(1);
      },
      '=': () => {
        zoomStep(1);
      },
      '-': () => {
        zoomStep(-1);
      },
      '0': showAll,
    };
    const action = keys[event.key];
    if (action && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      action();
    }
  });

  // Keys bubble up from whichever cover has focus. Listened for natively
  // because the handler belongs to the wall as a whole, not to one element.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    element.addEventListener('keydown', handleKeyDown);
    return () => {
      element.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // ---- Imperative handle -----------------------------------------------------

  useImperativeHandle(
    ref,
    () => ({
      rectFor: (id) => {
        const index = indexById.get(id);
        const element = viewportRef.current;
        if (index === undefined || !element) return null;
        const rect = tileRect(placementFor(index), controller.camera);
        const origin = element.getBoundingClientRect();
        return {
          x: origin.left + rect.x,
          y: origin.top + rect.y,
          width: rect.size,
          height: rect.size,
        };
      },
      zoomStep,
      showAll,
      reveal: async (id) => {
        const index = indexById.get(id);
        if (index === undefined) return;
        const limits = controller.limits();
        const vp = controller.viewport;
        // Bring the disc in at a size where it is actually recognisable, on
        // the nearest zoom stop.
        const wanted = Math.max(controller.camera.scale, Math.min(limits.max, 120 / TILE_SIZE));
        const scale = snapCamera(
          { ...controller.camera, scale: wanted },
          controller.layout,
          vp,
        ).scale;
        if (columnsAtScale(vp, scale) !== controller.layout.columns) {
          await requestReflow(scale, { x: vp.width / 2, y: vp.height / 2 }, index);
          return;
        }
        const zoomed = { ...controller.camera, scale };
        const rect = tileRect(placementFor(index), zoomed);
        const centred = {
          scale,
          x: zoomed.x + vp.width / 2 - (rect.x + rect.size / 2),
          y: zoomed.y + vp.height / 2 - (rect.y + rect.size / 2),
        };
        await controller.animateTo(snapCells(centred, controller.layout, vp));
      },
      focusDisc: (id) => {
        const index = indexById.get(id);
        if (index === undefined) return;
        pendingFocus.current = index;
        setActiveIndex(index);
        const element = tileElements.current.get(id);
        if (element) {
          pendingFocus.current = null;
          element.focus({ preventScroll: true });
        }
      },
    }),
    [controller, indexById, placementFor, requestReflow, showAll, zoomStep],
  );

  // ---- Render ----------------------------------------------------------------

  const tiles: { disc: DiscIndexEntry; index: number; placement: Placement }[] = [];
  const seen = new Set<number>();
  // Covers are looked up by the rows they occupy, so a 3x3 block is found from
  // any of its rows and blocks of different sizes cost the same to window.
  for (let row = range.firstRow; row <= range.lastRow; row += 1) {
    for (const index of wall.byRow[row] ?? []) {
      if (seen.has(index)) continue;
      const disc = discs[index];
      const placement = wall.placements[index];
      if (!disc || !placement) continue;
      if (placement.column + placement.span <= range.firstColumn) continue;
      if (placement.column > range.lastColumn) continue;
      tiles.push({ disc, index, placement });
      seen.add(index);
    }
  }
  // The roving-focus tile stays mounted even off screen, so Tab always has
  // somewhere to land and focus is never lost to virtualisation.
  const safeActive = clamp(activeIndex, 0, Math.max(0, discs.length - 1));
  const activeDisc = discs[safeActive];
  if (activeDisc && !seen.has(safeActive)) {
    tiles.push({ disc: activeDisc, index: safeActive, placement: placementFor(safeActive) });
  }

  const animateAll = tiles.length <= ANIMATE_ALL_LIMIT;
  const matchCount = matches === null ? discs.length : matches.size;

  const className = [
    'shelf',
    panning && 'shelf--panning',
    animateAll && 'shelf--animate',
    animateAll && reordering && 'shelf--reordering',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={viewportRef}
      className={className}
      // `application`: arrow keys move between covers here rather than being
      // taken by a screen reader's browse mode, which could not reach covers
      // outside the virtualised window anyway.
      role="application"
      aria-roledescription="album wall"
      aria-label={`Collection, ${String(discs.length)} album${discs.length === 1 ? '' : 's'}${
        matches === null ? '' : `, ${String(matchCount)} matching`
      }. Arrow keys move between albums, plus and minus zoom.`}
    >
      <div ref={insetProbeRef} className="shelf__inset-probe" aria-hidden="true" />
      <ShelfIntro urls={discs.length === 0 ? [] : introUrls} />
      <div
        ref={surfaceRef}
        className="shelf__surface"
        style={{ width: layout.worldWidth, height: layout.worldHeight }}
      >
        {tiles.map(({ disc, index, placement }) => (
          <DiscTile
            key={disc.id}
            disc={disc}
            index={index}
            placement={placement}
            dimmed={matches !== null && !matches.has(disc.id)}
            lifted={disc.id === openDiscId}
            arrived={disc.id === arrivedDiscId}
            focusable={index === safeActive}
            onOpen={handleOpen}
            onFocusTile={setActiveIndex}
            registerElement={registerElement}
          />
        ))}
      </div>
    </div>
  );
}
