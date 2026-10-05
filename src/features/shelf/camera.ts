/**
 * Geometry for the mosaic's camera: where the plane of covers sits on screen,
 * how far it may pan, how far it may zoom.
 *
 * The mosaic is a flat "world" of square tiles, `TILE_SIZE` world units each,
 * laid edge to edge with no gaps. The camera maps world to screen as
 * `screen = world * scale + offset`, and is applied as a single transform on
 * one surface element — never per tile.
 *
 * Everything here is pure so the awkward maths (focal-point zoom, rubber-band
 * edges, what is visible) can be tested without a DOM.
 */

/** World units per tile. Screen size is this times the camera scale. */
export const TILE_SIZE = 160;

/** Below this on-screen size a cover is just a coloured dot. */
const MIN_TILE_PX = 10;

/** A cover's square of cells on the wall. Mirrors `Placement` in `layout.ts`. */
export interface Placement {
  column: number;
  row: number;
  span: number;
}

export interface Camera {
  /** Screen position of the wall's top-left corner, and its scale. */
  x: number;
  y: number;
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
  /**
   * Screen space taken by the notch at the top and the floating bar at the
   * bottom. The page pads the wall by exactly these, so they bound how far it
   * scrolls (see `panBounds`): it starts below the notch and ends above the
   * bar, and passes under both in between. Also used when bringing a focused
   * cover into the clear part of the screen.
   */
  insetTop: number;
  insetBottom: number;
}

export interface GridLayout {
  columns: number;
  rows: number;
  worldWidth: number;
  worldHeight: number;
  /**
   * When set, the wall always spans the screen width exactly and zooming
   * re-flows it: these are the column counts it may re-flow to, and every
   * zoom stop is one of them. There is then nothing to pan sideways — the
   * wall scrolls one way, like a photo library. Unset, the wall is a fixed
   * plane that pans in both directions (the geometry tests use that).
   */
  zoomColumns?: readonly number[];
}

/** The world size of a wall of this many cells. */
export function gridLayoutOf(
  columns: number,
  rows: number,
  zoomColumns?: readonly number[],
): GridLayout {
  const layout: GridLayout = {
    columns,
    rows,
    worldWidth: columns * TILE_SIZE,
    worldHeight: rows * TILE_SIZE,
  };
  if (zoomColumns) layout.zoomColumns = zoomColumns;
  return layout;
}

/** Scale at which `columns` covers exactly span the screen width. */
export function scaleForColumns(viewport: Pick<Viewport, 'width'>, columns: number): number {
  return viewport.width / (Math.max(1, columns) * TILE_SIZE);
}

/** How many covers across the screen `scale` shows, to the nearest whole cover. */
export function columnsAtScale(viewport: Pick<Viewport, 'width'>, scale: number): number {
  return Math.max(1, Math.round(viewport.width / (scale * TILE_SIZE)));
}

/**
 * The column counts a width-filling wall may re-flow to on this screen, fewest
 * (largest covers) first.
 *
 * A count is allowed when a cover is no taller than the screen, no smaller
 * than legible, not more columns than there are albums, and the re-flowed wall
 * is still at least a screen tall — zooming out further would leave background
 * below the last row. `rowsFor` gives the wall's height in rows at a count
 * (a mosaic's height depends on how its blocks pack). A collection too
 * small to fill the screen at any count keeps the single largest one.
 */
export function widthColumns(
  viewport: Pick<Viewport, 'width' | 'height'>,
  count: number,
  rowsFor: (columns: number) => number,
): number[] {
  const allowed: number[] = [];
  for (const across of COLUMN_STOPS) {
    const tile = viewport.width / across;
    if (tile > viewport.height + 0.5) continue;
    if (tile < MIN_TILE_PX) break;
    if (across > Math.max(1, count) && allowed.length > 0) break;
    const fills = rowsFor(across) * tile >= viewport.height - 0.5;
    if (!fills && allowed.length > 0) break;
    allowed.push(across);
  }
  return allowed;
}

/** The allowed count nearest `wanted`, measured in log space (zoom is multiplicative). */
export function nearestColumns(allowed: readonly number[], wanted: number): number {
  let best = allowed[0] ?? 1;
  for (const option of allowed) {
    if (Math.abs(Math.log(option / wanted)) < Math.abs(Math.log(best / wanted))) best = option;
  }
  return best;
}

/** Covers across a phone screen when the wall first opens. */
export function initialColumnsWanted(viewport: Pick<Viewport, 'width'>): number {
  return viewport.width / clamp(viewport.width / 4, 88, 180);
}

/**
 * Lays `count` covers out as a plane roughly the shape of the screen, so that
 * zoomed all the way out the whole collection fills it: one disc is 1×1, and a
 * 150-disc collection on a portrait phone is about 8×19.
 *
 * This is the even arrangement. A mosaic of blocks of different sizes is
 * packed by `layout.ts` instead, which hands the resulting cell counts to
 * `gridLayoutOf`.
 */
export function gridLayout(
  count: number,
  viewport: Pick<Viewport, 'width' | 'height'>,
): GridLayout {
  const n = Math.max(1, count);
  const aspect = viewport.width > 0 && viewport.height > 0 ? viewport.width / viewport.height : 1;
  const columns = Math.min(n, Math.max(1, Math.round(Math.sqrt(n * aspect))));
  return gridLayoutOf(columns, Math.ceil(n / columns));
}

export interface ScaleLimits {
  min: number;
  max: number;
  /** Furthest-out scale: the wall exactly fills the screen. Equal to `min`. */
  fit: number;
}

/**
 * How many covers across the screen the zoom may rest at. Dense at the close
 * end, where each step is a big visual change, sparser further out. Every
 * resting zoom is one of these (or "the whole collection"), so the wall always
 * settles with whole covers edge to edge across the screen — never a sliver of
 * a column at either side.
 */
const COLUMN_STOPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128];

/** Scales closer than this (in log space, ~2%) count as the same stop. */
const STOP_EPSILON = 0.02;

/**
 * The smallest scale at which the wall still covers the whole screen on both
 * axes. Below it, background would show beside or below the covers — the
 * "padding" a wall of covers must never have — so it is the zoom-out limit.
 */
function coverScale(layout: GridLayout, viewport: Pick<Viewport, 'width' | 'height'>): number {
  return Math.max(viewport.width / layout.worldWidth, viewport.height / layout.worldHeight);
}

/**
 * The zoom levels the wall settles on, smallest scale first.
 *
 * Each is the scale at which exactly N covers span the screen width, skipping
 * any where a single cover would be taller than the screen (a wide desktop
 * window starts at two across, not one). The last stop out is the furthest the
 * wall can go while still filling the screen, or legibility, whichever comes
 * first. A collection too small to fill the screen at one cover across has a
 * single stop: filled, and cropped.
 */
export function zoomStops(
  layout: GridLayout,
  viewport: Pick<Viewport, 'width' | 'height'>,
): number[] {
  if (layout.zoomColumns && layout.zoomColumns.length > 0) {
    return layout.zoomColumns
      .map((columns) => scaleForColumns(viewport, columns))
      .sort((a, b) => a - b);
  }
  const floor = Math.max(coverScale(layout, viewport), MIN_TILE_PX / TILE_SIZE);
  const stops: number[] = [];
  for (const across of COLUMN_STOPS) {
    const scale = viewport.width / (across * TILE_SIZE);
    if (scale * TILE_SIZE > viewport.height + 0.5) continue;
    if (scale < floor * (1 + STOP_EPSILON)) break;
    stops.push(scale);
  }
  // Only add the floor when it is genuinely further out than the last stop.
  const last = stops.at(-1);
  if (last === undefined || Math.log(last / floor) > STOP_EPSILON) stops.push(floor);
  return stops.sort((a, b) => a - b);
}

/**
 * Zoomed fully in, one cover fills the screen width (or two, on a screen
 * wider than it is tall). Zoomed fully out, the wall exactly fills the screen
 * on its tighter axis — never smaller, so no background ever shows. Both ends
 * are zoom stops.
 */
export function scaleLimits(layout: GridLayout, viewport: Viewport): ScaleLimits {
  const stops = zoomStops(layout, viewport);
  const min = stops[0] ?? 1;
  const max = stops.at(-1) ?? 1;
  return { min, max, fit: min };
}

/** Index of the stop nearest `scale`, measured in log space. */
export function nearestStopIndex(stops: readonly number[], scale: number): number {
  let best = 0;
  let bestDistance = Infinity;
  stops.forEach((stop, i) => {
    const distance = Math.abs(Math.log(stop / scale));
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Aligns the wall to the cell lattice, so the screen always comes to rest
 * showing whole covers: a column edge on the left, a row edge at the top. At a
 * zoom stop the screen is an exact number of covers wide, so nothing is ever
 * left half-visible at an edge. The clamp afterwards wins at the extremes, so
 * the wall always ends flush with the screen edge.
 */
export function snapCells(camera: Camera, layout: GridLayout, viewport: Viewport): Camera {
  const cell = TILE_SIZE * camera.scale;
  const bounds = panBounds(layout, viewport, camera.scale);
  const snapped = { ...camera };

  /**
   * Rounds to the lattice, except near the far end of the wall, where the edge
   * itself wins. The far extreme is only on the lattice when the screen is a
   * whole number of covers long, so rounding there would leave a strip of
   * empty background at the edge.
   */
  const align = (value: number, range: { min: number; max: number }): number => {
    if (range.min >= range.max) return range.min;
    const rounded = Math.round(value / cell) * cell;
    if (rounded - range.min < cell) return range.min;
    if (range.max - rounded < cell) return range.max;
    return rounded;
  };

  if (layout.worldWidth * camera.scale > viewport.width + 0.5) {
    snapped.x = align(camera.x, bounds.x);
  }
  if (layout.worldHeight * camera.scale > viewport.height + 0.5) {
    snapped.y = align(camera.y, bounds.y);
  }
  return clampCamera(snapped, layout, viewport);
}

export interface SnapOptions {
  /** Screen point the zoom should stay anchored to (the fingers, the cursor). */
  focus?: { x: number; y: number } | undefined;
  /** Rate of zoom at release, in log-scale per millisecond. */
  scaleVelocity?: number | undefined;
  /** Scale when the gesture began, so a deliberate pinch always changes stop. */
  fromScale?: number | undefined;
}

/**
 * How far ahead a pinch's momentum is projected when choosing where it lands.
 * Chosen so a quick flick of the fingers carries one stop further than a slow
 * pinch to the same spread, which is what makes it feel intentional.
 */
const SCALE_PROJECTION_MS = 140;

/** A pinch of more than ~13% always moves at least one stop. */
const DELIBERATE_PINCH = 0.12;

/**
 * Where the camera comes to rest after a gesture: the nearest zoom stop
 * (projected along the pinch's momentum), anchored at the focus, with whole
 * columns across the screen.
 */
export function snapCamera(
  camera: Camera,
  layout: GridLayout,
  viewport: Viewport,
  options: SnapOptions = {},
): Camera {
  const stops = zoomStops(layout, viewport);
  const projected = camera.scale * Math.exp((options.scaleVelocity ?? 0) * SCALE_PROJECTION_MS);
  let index = nearestStopIndex(stops, projected);

  if (options.fromScale !== undefined) {
    const startIndex = nearestStopIndex(stops, options.fromScale);
    const change = Math.log(camera.scale / options.fromScale);
    if (index === startIndex && Math.abs(change) > DELIBERATE_PINCH) {
      index = clamp(index + Math.sign(change), 0, stops.length - 1);
    }
  }

  const scale = stops[index] ?? camera.scale;
  const focus = options.focus ?? { x: viewport.width / 2, y: viewport.height / 2 };
  return snapCells(zoomAt(camera, scale, focus.x, focus.y), layout, viewport);
}

/**
 * One zoom step in (`+1`) or out (`-1`) from wherever the camera is, for
 * buttons, keys and mouse-wheel notches.
 */
export function stepZoom(
  camera: Camera,
  direction: 1 | -1,
  layout: GridLayout,
  viewport: Viewport,
  focus?: { x: number; y: number },
): Camera {
  const stops = zoomStops(layout, viewport);
  const current = nearestStopIndex(stops, camera.scale);
  const currentScale = stops[current] ?? camera.scale;
  const onStop = Math.abs(Math.log(currentScale / camera.scale)) < STOP_EPSILON;
  // Off a stop, the "next" one in that direction may be the nearest itself.
  const beyond = direction > 0 ? currentScale > camera.scale : currentScale < camera.scale;
  const index = clamp(onStop || !beyond ? current + direction : current, 0, stops.length - 1);
  const scale = stops[index] ?? camera.scale;
  const anchor = focus ?? { x: viewport.width / 2, y: viewport.height / 2 };
  return snapCells(zoomAt(camera, scale, anchor.x, anchor.y), layout, viewport);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface AxisRange {
  min: number;
  max: number;
}

/**
 * Allowed offsets across: the content may pan until its edge meets the screen
 * edge, and no further. Content narrower than the screen is centred.
 */
function axisRange(content: number, screen: number): AxisRange {
  if (content <= screen) {
    const centred = (screen - content) / 2;
    return { min: centred, max: centred };
  }
  return { min: screen - content, max: 0 };
}

/**
 * Allowed offsets down the page: from the wall's top just below the top inset
 * (scroll position 0) to its end just above the bottom inset (the end of the
 * page). A wall too short to scroll sits at the top, as a short page does.
 */
function verticalRange(content: number, screen: number, top: number, bottom: number): AxisRange {
  return { min: Math.min(top, screen - bottom - content), max: top };
}

export interface PanBounds {
  x: AxisRange;
  y: AxisRange;
}

/**
 * Edge to edge across; top to bottom, the wall can scroll clear of the notch
 * at the top and of the floating bar at the bottom. The shelf is the page's
 * own scrolling content, padded by exactly those insets, so these bounds are
 * the native scroll range: the wall's top rests below the notch at scroll 0,
 * and its last row rises above the bar at the end. In between, covers pass
 * under both — and under the browser's own translucent bars. A pinch may
 * stretch past these bounds (see `rubberBandCamera`), but always springs back.
 */
export function panBounds(layout: GridLayout, viewport: Viewport, scale: number): PanBounds {
  return {
    x: axisRange(layout.worldWidth * scale, viewport.width),
    y: verticalRange(
      layout.worldHeight * scale,
      viewport.height,
      viewport.insetTop,
      viewport.insetBottom,
    ),
  };
}

/** The nearest camera that is fully within bounds. */
export function clampCamera(camera: Camera, layout: GridLayout, viewport: Viewport): Camera {
  const limits = scaleLimits(layout, viewport);
  const scale = clamp(camera.scale, limits.min, limits.max);
  const bounds = panBounds(layout, viewport, scale);
  return {
    scale,
    x: clamp(camera.x, bounds.x.min, bounds.x.max),
    y: clamp(camera.y, bounds.y.min, bounds.y.max),
  };
}

/**
 * iOS-style rubber banding: past the edge, content follows the finger with
 * rapidly increasing resistance and can never be dragged more than
 * `dimension` away. The constant is the one UIScrollView is widely measured to
 * use. This — resistance, then a spring home — is what makes an edge feel like
 * the end of a physical object; a hard stop reads as the interface refusing.
 */
const RUBBER_BAND_C = 0.55;

export function rubberBand(overshoot: number, dimension: number): number {
  if (overshoot === 0 || dimension <= 0) return 0;
  const magnitude = Math.abs(overshoot);
  const banded = (1 - 1 / ((magnitude * RUBBER_BAND_C) / dimension + 1)) * dimension;
  return Math.sign(overshoot) * banded;
}

/**
 * The inverse of `rubberBand`: how far past the edge the finger must be for the
 * content to sit `banded` past it. Needed whenever a gesture or spring picks up
 * from content that is already stretched — starting from the stretched
 * position as if it were unstretched would make it jump inward.
 */
export function unRubberBand(banded: number, dimension: number): number {
  if (banded === 0 || dimension <= 0) return 0;
  // The band can only approach `dimension`; keep the inverse finite.
  const b = Math.min(Math.abs(banded), dimension * 0.999);
  const magnitude = (dimension / RUBBER_BAND_C) * (1 / (1 - b / dimension) - 1);
  return Math.sign(banded) * magnitude;
}

function bandAxis(value: number, range: AxisRange, dimension: number): number {
  if (value < range.min) return range.min + rubberBand(value - range.min, dimension);
  if (value > range.max) return range.max + rubberBand(value - range.max, dimension);
  return value;
}

function unbandAxis(value: number, range: AxisRange, dimension: number): number {
  if (value < range.min) return range.min + unRubberBand(value - range.min, dimension);
  if (value > range.max) return range.max + unRubberBand(value - range.max, dimension);
  return value;
}

/**
 * Applies rubber-band resistance to a camera a gesture or spring has carried
 * past the edge. Inside the bounds this is the identity, so a drag stays 1:1.
 */
export function rubberBandCamera(camera: Camera, layout: GridLayout, viewport: Viewport): Camera {
  const bounds = panBounds(layout, viewport, camera.scale);
  return {
    scale: camera.scale,
    x: bandAxis(camera.x, bounds.x, viewport.width),
    y: bandAxis(camera.y, bounds.y, viewport.height),
  };
}

/** The inverse of `rubberBandCamera`, at the camera's own scale. */
export function unbandCamera(camera: Camera, layout: GridLayout, viewport: Viewport): Camera {
  const bounds = panBounds(layout, viewport, camera.scale);
  return {
    scale: camera.scale,
    x: unbandAxis(camera.x, bounds.x, viewport.width),
    y: unbandAxis(camera.y, bounds.y, viewport.height),
  };
}

/** How far, in log-scale, a pinch may be stretched past the zoom limits. */
const SCALE_BAND = 0.5;

/**
 * Softens a pinch past the zoom limits the same way, in log space so zooming
 * out and in feel symmetrical.
 */
export function rubberBandScale(scale: number, limits: ScaleLimits): number {
  const log = Math.log(scale);
  const lo = Math.log(limits.min);
  const hi = Math.log(limits.max);
  if (log < lo) return Math.exp(lo + rubberBand(log - lo, SCALE_BAND));
  if (log > hi) return Math.exp(hi + rubberBand(log - hi, SCALE_BAND));
  return scale;
}

export function unbandScale(scale: number, limits: ScaleLimits): number {
  const log = Math.log(scale);
  const lo = Math.log(limits.min);
  const hi = Math.log(limits.max);
  if (log < lo) return Math.exp(lo + unRubberBand(log - lo, SCALE_BAND));
  if (log > hi) return Math.exp(hi + unRubberBand(log - hi, SCALE_BAND));
  return scale;
}

/**
 * Zooms to `scale` while keeping the world point under the screen point
 * `(fx, fy)` fixed — the thing that makes a pinch feel anchored to the
 * fingers rather than to the corner of the screen.
 */
export function zoomAt(camera: Camera, scale: number, fx: number, fy: number): Camera {
  const worldX = (fx - camera.x) / camera.scale;
  const worldY = (fy - camera.y) / camera.scale;
  return { scale, x: fx - worldX * scale, y: fy - worldY * scale };
}

/** Camera zoomed all the way out: the wall exactly filling the screen, centred. */
export function fitCamera(layout: GridLayout, viewport: Viewport): Camera {
  const { min } = scaleLimits(layout, viewport);
  return clampCamera(
    {
      scale: min,
      x: (viewport.width - layout.worldWidth * min) / 2,
      y: (viewport.height - layout.worldHeight * min) / 2,
    },
    layout,
    viewport,
  );
}

/**
 * Where the shelf opens: covers at a comfortable browsing size (about four
 * across on a phone, larger tiles on a wide screen), starting from the first
 * disc in the current order. A collection small enough to fill the screen at
 * that size is simply shown zoomed all the way out.
 */
export function initialCamera(layout: GridLayout, viewport: Viewport): Camera {
  const stops = zoomStops(layout, viewport);
  const targetTilePx = clamp(viewport.width / 4, 88, 180);
  const scale =
    stops[nearestStopIndex(stops, targetTilePx / TILE_SIZE)] ?? targetTilePx / TILE_SIZE;
  if (scale <= (stops[0] ?? scale)) return fitCamera(layout, viewport);
  return snapCells({ scale, x: 0, y: 0 }, layout, viewport);
}

export interface TileRange {
  firstColumn: number;
  lastColumn: number;
  firstRow: number;
  lastRow: number;
}

/**
 * Tiles intersecting the screen, plus `overscan` tiles on every side so a
 * flick does not reveal unrendered space before the next render lands.
 */
export function visibleRange(
  camera: Camera,
  layout: GridLayout,
  viewport: Pick<Viewport, 'width' | 'height'>,
  overscan: number,
): TileRange {
  const tile = TILE_SIZE * camera.scale;
  return {
    firstColumn: clamp(Math.floor(-camera.x / tile) - overscan, 0, layout.columns - 1),
    lastColumn: clamp(
      Math.floor((viewport.width - camera.x) / tile) + overscan,
      0,
      layout.columns - 1,
    ),
    firstRow: clamp(Math.floor(-camera.y / tile) - overscan, 0, layout.rows - 1),
    lastRow: clamp(Math.floor((viewport.height - camera.y) / tile) + overscan, 0, layout.rows - 1),
  };
}

export function sameRange(a: TileRange, b: TileRange): boolean {
  return (
    a.firstColumn === b.firstColumn &&
    a.lastColumn === b.lastColumn &&
    a.firstRow === b.firstRow &&
    a.lastRow === b.lastRow
  );
}

/** Screen rectangle of a placed cover under `camera`. */
export function tileRect(
  placement: Placement,
  camera: Camera,
): { x: number; y: number; size: number } {
  const cell = TILE_SIZE * camera.scale;
  return {
    x: camera.x + placement.column * cell,
    y: camera.y + placement.row * cell,
    size: placement.span * cell,
  };
}

/**
 * The smallest pan that brings a cover fully into the usable part of the
 * screen, leaving the camera alone if it already is. A cover taller than the
 * screen is aligned to its top rather than pulled off the bottom.
 */
export function revealTile(
  placement: Placement,
  camera: Camera,
  layout: GridLayout,
  viewport: Viewport,
): Camera {
  const rect = tileRect(placement, camera);
  let { x, y } = camera;
  const top = viewport.insetTop;
  const bottom = viewport.height - viewport.insetBottom;

  if (rect.x < 0) x -= rect.x;
  else if (rect.x + rect.size > viewport.width) x -= rect.x + rect.size - viewport.width;
  if (rect.y < top) y += top - rect.y;
  else if (rect.y + rect.size > bottom) y -= rect.y + rect.size - bottom;

  return clampCamera({ ...camera, x, y }, layout, viewport);
}

/**
 * Interpolates between cameras for programmatic moves. The world point at the
 * centre of the screen travels linearly while scale changes geometrically, so
 * a zoom feels even throughout and a combined pan-and-zoom does not swing out
 * sideways the way interpolating raw offsets would.
 */
export function mixCamera(
  from: Camera,
  to: Camera,
  t: number,
  viewport: Pick<Viewport, 'width' | 'height'>,
): Camera {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const fromWorldX = (cx - from.x) / from.scale;
  const fromWorldY = (cy - from.y) / from.scale;
  const toWorldX = (cx - to.x) / to.scale;
  const toWorldY = (cy - to.y) / to.scale;

  const scale = from.scale * Math.pow(to.scale / from.scale, t);
  const worldX = fromWorldX + (toWorldX - fromWorldX) * t;
  const worldY = fromWorldY + (toWorldY - fromWorldY) * t;
  return { scale, x: cx - worldX * scale, y: cy - worldY * scale };
}
