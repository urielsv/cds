import { describe, expect, it, vi } from 'vitest';

import { gridLayoutOf, scaleForColumns, TILE_SIZE, type Viewport } from './camera';
import { CameraController, timeConstant } from './cameraController';

const phone: Viewport = { width: 390, height: 844, insetTop: 47, insetBottom: 110 };

/** A width-filling wall of `columns` across, at rest at the top. */
function controllerAt(columns: number, rows = 40) {
  const controller = new CameraController();
  controller.setReducedMotion(true); // Arrive immediately; assert end states.
  controller.configure(gridLayoutOf(columns, rows, [2, 3, 4, 5, 6, 8]), phone);
  controller.set({ scale: scaleForColumns(phone, columns), x: 0, y: 0 });
  return controller;
}

describe('CameraController on a width-filling wall', () => {
  it('has nothing to pan sideways at rest', () => {
    expect(controllerAt(4).lockedX).toBe(true);
  });

  it('ignores the sideways part of a flick', () => {
    const controller = controllerAt(4);
    controller.fling(3, -2);
    expect(controller.camera.x).toBe(0);
    expect(controller.camera.y).toBeLessThan(0);
  });

  it('asks the wall to re-flow when a pinch lands on another column count', () => {
    const controller = controllerAt(4);
    const reflow = vi.fn();
    controller.reflow = reflow;
    // Pinched out to about five across.
    controller.set({ scale: scaleForColumns(phone, 5.1), x: 0, y: 0 });
    controller.settle({ focus: { x: 100, y: 200 } });
    expect(reflow).toHaveBeenCalledWith(scaleForColumns(phone, 5), { x: 100, y: 200 });
  });

  it('settles in place when a pinch comes back to the same column count', () => {
    const controller = controllerAt(4);
    const reflow = vi.fn();
    controller.reflow = reflow;
    controller.set({ scale: scaleForColumns(phone, 4.1), x: 0, y: 0 });
    controller.settle({ focus: { x: 100, y: 200 } });
    expect(reflow).not.toHaveBeenCalled();
    expect(controller.camera.scale).toBeCloseTo(scaleForColumns(phone, 4));
  });

  it('re-flows for the zoom buttons too', async () => {
    const controller = controllerAt(4);
    const reflow = vi.fn();
    controller.reflow = reflow;
    await controller.step(-1);
    expect(reflow).toHaveBeenCalledWith(scaleForColumns(phone, 5), expect.any(Object));
  });
});

describe('fling momentum', () => {
  it('lands a flick on a whole row, the full kinetic distance away', () => {
    const controller = controllerAt(4);
    const cell = TILE_SIZE * controller.camera.scale;
    // 2 px/ms upwards: momentum carries ~650 px, snapped to the row grid.
    controller.fling(0, -2);
    const y = controller.camera.y;
    expect(Math.abs(y / cell - Math.round(y / cell))).toBeLessThan(1e-6);
    expect(Math.abs(y)).toBeGreaterThan(650 - cell);
    expect(Math.abs(y)).toBeLessThan(650 + cell);
  });
});

describe('timeConstant', () => {
  it('starts at the finger speed and covers the snapped distance', () => {
    expect(timeConstant(-650, -2)).toBeCloseTo(325);
  });

  it('is zero when there is nothing to travel', () => {
    expect(timeConstant(0.2, 1)).toBe(0);
  });

  it('gives up (spring instead) for the wrong direction or no speed', () => {
    expect(timeConstant(100, -1)).toBeNull();
    expect(timeConstant(100, 0)).toBeNull();
  });

  it('gives up when snapping stretched the throw too far either way', () => {
    // A slow 0.1 px/ms flick snapped a whole 200 px cell along: tau 2000 ms.
    expect(timeConstant(200, 0.1)).toBeNull();
    // A fast flick snapped back to a tenth of its reach.
    expect(timeConstant(65, 2)).toBeNull();
  });
});
