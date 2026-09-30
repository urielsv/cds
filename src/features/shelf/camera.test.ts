import { describe, expect, it } from 'vitest';

import {
  clampCamera,
  fitCamera,
  gridLayout,
  initialCamera,
  mixCamera,
  revealTile,
  rubberBand,
  rubberBandCamera,
  rubberBandScale,
  panBounds,
  scaleLimits,
  snapCamera,
  snapCells,
  stepZoom,
  TILE_SIZE,
  tileRect,
  unbandCamera,
  unbandScale,
  unRubberBand,
  type Viewport,
  visibleRange,
  zoomAt,
  zoomStops,
} from './camera';

const phone: Viewport = { width: 390, height: 844, insetTop: 47, insetBottom: 110 };

describe('gridLayout', () => {
  it('lays one disc out as 1×1', () => {
    expect(gridLayout(1, phone)).toMatchObject({ columns: 1, rows: 1 });
  });

  it('shapes the plane roughly like the screen', () => {
    const layout = gridLayout(150, phone);
    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(150);
    const aspect = layout.worldWidth / layout.worldHeight;
    expect(aspect).toBeGreaterThan((phone.width / phone.height) * 0.7);
    expect(aspect).toBeLessThan((phone.width / phone.height) * 1.4);
  });

  it('goes wide on a landscape screen', () => {
    const layout = gridLayout(150, { width: 1440, height: 900 });
    expect(layout.columns).toBeGreaterThan(layout.rows);
  });
});

describe('scaleLimits', () => {
  it('zooms in until one cover fills the width of a portrait screen', () => {
    const limits = scaleLimits(gridLayout(150, phone), phone);
    expect(limits.max * TILE_SIZE).toBeCloseTo(390);
  });

  it('zooms out only until the wall exactly fills the screen, never further', () => {
    const layout = gridLayout(150, phone);
    const limits = scaleLimits(layout, phone);
    const width = layout.worldWidth * limits.min;
    const height = layout.worldHeight * limits.min;
    expect(width).toBeGreaterThanOrEqual(phone.width - 0.01);
    expect(height).toBeGreaterThanOrEqual(phone.height - 0.01);
    // …and one axis is exactly flush, so it is the furthest zoom that fills.
    expect(Math.min(width - phone.width, height - phone.height)).toBeCloseTo(0);
  });

  it('never shrinks covers into illegible dots for a huge collection', () => {
    const limits = scaleLimits(gridLayout(20_000, phone), phone);
    expect(limits.min * TILE_SIZE).toBeGreaterThanOrEqual(10);
  });
});

describe('clampCamera', () => {
  const layout = gridLayout(150, phone);

  it('keeps the plane from being dragged off screen', () => {
    const clamped = clampCamera({ x: 500, y: 900, scale: 1 }, layout, phone);
    // Flush with the top of the screen: covers run under the notch rather
    // than leaving a strip of background above the first row.
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });

  it('ends the last row flush with the bottom of the screen, under the bar', () => {
    const clamped = clampCamera({ x: -1e6, y: -1e6, scale: 1 }, layout, phone);
    expect(clamped.y + layout.worldHeight).toBeCloseTo(phone.height);
    expect(clamped.x + layout.worldWidth).toBeCloseTo(phone.width);
  });

  it('never lets a small collection leave background around it', () => {
    const small = gridLayout(3, phone);
    const clamped = clampCamera({ x: 50, y: 50, scale: 0.1 }, small, phone);
    expect(clamped.x).toBeLessThanOrEqual(0);
    expect(clamped.y).toBeLessThanOrEqual(0);
    expect(clamped.x + small.worldWidth * clamped.scale).toBeGreaterThanOrEqual(phone.width - 0.01);
    expect(clamped.y + small.worldHeight * clamped.scale).toBeGreaterThanOrEqual(
      phone.height - 0.01,
    );
  });
});

describe('zoomAt', () => {
  it('keeps the point under the fingers fixed', () => {
    const camera = { x: -120, y: -40, scale: 0.8 };
    const zoomed = zoomAt(camera, 1.6, 200, 300);
    const before = { x: (200 - camera.x) / camera.scale, y: (300 - camera.y) / camera.scale };
    const after = { x: (200 - zoomed.x) / zoomed.scale, y: (300 - zoomed.y) / zoomed.scale };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe('rubber banding', () => {
  const layout = gridLayout(150, phone);

  it('is 1:1 inside the bounds', () => {
    const inside = { x: -50, y: -50, scale: 1 };
    expect(rubberBandCamera(inside, layout, phone)).toEqual(inside);
  });

  it('resists increasingly and never exceeds the dimension', () => {
    expect(rubberBand(0, 100)).toBe(0);
    expect(rubberBand(50, 100)).toBeLessThan(50);
    expect(rubberBand(10_000, 100)).toBeLessThan(100);
    expect(rubberBand(-50, 100)).toBeCloseTo(-rubberBand(50, 100));
  });

  it('inverts exactly, so a caught stretch does not jump', () => {
    for (const overshoot of [-400, -30, 0, 12, 250]) {
      expect(unRubberBand(rubberBand(overshoot, 844), 844)).toBeCloseTo(overshoot, 6);
    }
    const stretched = rubberBandCamera({ x: 120, y: -1e5, scale: 1 }, layout, phone);
    const raw = unbandCamera(stretched, layout, phone);
    expect(raw.x).toBeCloseTo(120, 4);
    expect(rubberBandCamera(raw, layout, phone).y).toBeCloseTo(stretched.y, 4);
  });

  it('stretches a pinch past the zoom limits and inverts that too', () => {
    const limits = scaleLimits(layout, phone);
    const past = limits.min * 0.5;
    const banded = rubberBandScale(past, limits);
    expect(banded).toBeLessThan(limits.min);
    expect(banded).toBeGreaterThan(past);
    expect(unbandScale(banded, limits)).toBeCloseTo(past, 6);
  });
});

describe('initialCamera and fitCamera', () => {
  it('opens a big collection at about four covers across, at the start', () => {
    const layout = gridLayout(400, phone);
    const camera = initialCamera(layout, phone);
    const tile = TILE_SIZE * camera.scale;
    expect(phone.width / tile).toBeGreaterThan(3.5);
    expect(phone.width / tile).toBeLessThan(4.6);
    expect(camera.x).toBe(0);
  });

  it('opens a small collection zoomed all the way out', () => {
    const layout = gridLayout(6, phone);
    expect(initialCamera(layout, phone)).toEqual(fitCamera(layout, phone));
  });
});

describe('visibleRange', () => {
  it('covers the screen plus the overscan', () => {
    const layout = gridLayout(400, phone);
    const camera = { x: 0, y: 0, scale: 1 };
    const range = visibleRange(camera, layout, phone, 1);
    expect(range.firstColumn).toBe(0);
    expect(range.lastColumn).toBe(Math.min(layout.columns - 1, Math.floor(390 / TILE_SIZE) + 1));
    expect(range.lastRow).toBe(Math.floor(844 / TILE_SIZE) + 1);
  });
});

describe('tileRect and revealTile', () => {
  const layout = gridLayout(400, phone);
  const cell = (column: number, row: number, span = 1) => ({ column, row, span });

  it('places covers edge to edge', () => {
    const camera = { x: 10, y: 20, scale: 0.5 };
    const a = tileRect(cell(0, 0), camera);
    const b = tileRect(cell(1, 0), camera);
    expect(b.x - a.x).toBe(a.size);
    expect(tileRect(cell(0, 1), camera).y - a.y).toBe(a.size);
  });

  it('sizes a multi-cell block by its span', () => {
    const camera = { x: 0, y: 0, scale: 0.5 };
    expect(tileRect(cell(0, 0, 3), camera).size).toBe(3 * tileRect(cell(0, 0), camera).size);
  });

  it('pans just enough to bring an off-screen cover into view', () => {
    const camera = { x: 0, y: phone.insetTop, scale: 1 };
    const target = cell(0, 10);
    const moved = revealTile(target, camera, layout, phone);
    const rect = tileRect(target, moved);
    expect(rect.y + rect.size).toBeLessThanOrEqual(phone.height - phone.insetBottom + 0.01);
    expect(rect.y).toBeGreaterThanOrEqual(phone.insetTop - 0.01);
  });
});

describe('mixCamera', () => {
  it('starts and ends exactly on the given cameras', () => {
    const from = { x: 0, y: 0, scale: 0.5 };
    const to = { x: -300, y: -200, scale: 2 };
    const start = mixCamera(from, to, 0, phone);
    const end = mixCamera(from, to, 1, phone);
    expect(start.x).toBeCloseTo(from.x);
    expect(end.x).toBeCloseTo(to.x);
    expect(end.y).toBeCloseTo(to.y);
    expect(mixCamera(from, to, 0.5, phone).scale).toBeCloseTo(1);
  });
});

const desktop: Viewport = { width: 1440, height: 900, insetTop: 0, insetBottom: 90 };

describe('zoomStops', () => {
  it('rests only where a whole number of covers spans the screen', () => {
    const layout = gridLayout(400, phone);
    const stops = zoomStops(layout, phone);
    // Every stop but the "whole collection" one is an exact column count.
    for (const stop of stops.slice(1)) {
      const across = phone.width / (stop * TILE_SIZE);
      expect(across).toBeCloseTo(Math.round(across), 6);
    }
    expect(stops.at(-1)! * TILE_SIZE).toBeCloseTo(phone.width);
  });

  it('ends where the wall exactly fills the screen', () => {
    const layout = gridLayout(150, phone);
    const stops = zoomStops(layout, phone);
    expect(stops[0]).toBeCloseTo(
      Math.max(phone.width / layout.worldWidth, phone.height / layout.worldHeight),
    );
  });

  it('never offers a cover taller than a landscape screen', () => {
    const stops = zoomStops(gridLayout(150, desktop), desktop);
    expect(stops.at(-1)! * TILE_SIZE).toBeLessThanOrEqual(desktop.height);
    expect(desktop.width / (stops.at(-1)! * TILE_SIZE)).toBeCloseTo(2);
  });

  it('is ascending and has no near-duplicates', () => {
    const stops = zoomStops(gridLayout(150, desktop), desktop);
    for (let i = 1; i < stops.length; i += 1) {
      expect(Math.log(stops[i]! / stops[i - 1]!)).toBeGreaterThan(0.02);
    }
  });

  it('gives a single disc one stop', () => {
    expect(zoomStops(gridLayout(1, phone), phone)).toHaveLength(1);
  });
});

describe('snapping', () => {
  const layout = gridLayout(400, phone);
  const stops = zoomStops(layout, phone);
  const fourAcross = phone.width / (4 * TILE_SIZE);

  it('settles an in-between pinch on the nearest stop', () => {
    const snapped = snapCamera({ x: 0, y: 0, scale: fourAcross * 1.08 }, layout, phone);
    expect(snapped.scale).toBeCloseTo(fourAcross);
  });

  it('carries a quick pinch on to the next stop', () => {
    const slow = snapCamera({ x: 0, y: 0, scale: fourAcross * 1.08 }, layout, phone, {
      scaleVelocity: 0,
    });
    const quick = snapCamera({ x: 0, y: 0, scale: fourAcross * 1.08 }, layout, phone, {
      scaleVelocity: 0.003,
    });
    expect(quick.scale).toBeGreaterThan(slow.scale);
  });

  it('always moves at least one stop after a deliberate pinch', () => {
    const snapped = snapCamera({ x: 0, y: 0, scale: fourAcross * 1.14 }, layout, phone, {
      fromScale: fourAcross,
    });
    expect(snapped.scale).toBeGreaterThan(fourAcross * 1.01);
  });

  it('springs back from a tiny, accidental pinch', () => {
    const snapped = snapCamera({ x: 0, y: 0, scale: fourAcross * 1.04 }, layout, phone, {
      fromScale: fourAcross,
    });
    expect(snapped.scale).toBeCloseTo(fourAcross);
  });

  it('lines whole covers up with the screen edges, on both axes', () => {
    const cell = fourAcross * TILE_SIZE;
    const snapped = snapCells({ x: -cell * 3.4, y: -cell * 2.6, scale: fourAcross }, layout, phone);
    expect(snapped.x / cell).toBeCloseTo(-3);
    expect(snapped.y / cell).toBeCloseTo(-3);
  });

  it('sits flush at the end of the wall rather than leaving a strip of background', () => {
    const scale = fourAcross;
    const bottom = snapCells({ x: 0, y: -1e6, scale }, layout, phone);
    const bounds = panBounds(layout, phone, scale);
    expect(bottom.y).toBeCloseTo(bounds.y.min);
    expect(bottom.y + layout.worldHeight * scale).toBeCloseTo(phone.height);

    const right = snapCells({ x: -1e6, y: 0, scale }, layout, phone);
    expect(right.x + layout.worldWidth * scale).toBeCloseTo(phone.width);
  });

  it('starts flush at the top-left corner', () => {
    const snapped = snapCells({ x: 4, y: 6, scale: fourAcross }, layout, phone);
    expect(snapped.x).toBeCloseTo(0);
    expect(snapped.y).toBeCloseTo(0);
  });

  it('crops a collection too small to fill the screen rather than framing it', () => {
    const small = gridLayout(2, phone);
    const stops = zoomStops(small, phone);
    expect(stops).toHaveLength(1);
    const snapped = snapCells({ x: 0, y: 0, scale: stops[0]! }, small, phone);
    expect(small.worldWidth * snapped.scale).toBeGreaterThanOrEqual(phone.width - 0.01);
    expect(small.worldHeight * snapped.scale).toBeGreaterThanOrEqual(phone.height - 0.01);
  });

  it('keeps the point under the fingers near its place while snapping', () => {
    const camera = { x: -300, y: -200, scale: fourAcross * 1.1 };
    const snapped = snapCamera(camera, layout, phone, { focus: { x: 100, y: 400 } });
    const worldBefore = (400 - camera.y) / camera.scale;
    const worldAfter = (400 - snapped.y) / snapped.scale;
    // The zoom is anchored exactly; the lattice snap then shifts the view by up
    // to half a cover, which is what keeps whole covers at the screen edges.
    expect(Math.abs(worldAfter - worldBefore)).toBeLessThan(TILE_SIZE / 2);
  });

  it('steps one stop per button press, in both directions', () => {
    const start = { x: 0, y: 0, scale: fourAcross };
    const index = stops.findIndex((s) => Math.abs(s - fourAcross) < 1e-9);
    expect(stepZoom(start, 1, layout, phone).scale).toBeCloseTo(stops[index + 1]!);
    expect(stepZoom(start, -1, layout, phone).scale).toBeCloseTo(stops[index - 1]!);
  });

  it('steps from between two stops to the next one in that direction', () => {
    const between = { x: 0, y: 0, scale: fourAcross * 1.1 };
    expect(stepZoom(between, -1, layout, phone).scale).toBeCloseTo(fourAcross);
  });

  it('stops at either end', () => {
    const max = stops.at(-1)!;
    expect(stepZoom({ x: 0, y: 0, scale: max }, 1, layout, phone).scale).toBeCloseTo(max);
  });
});
