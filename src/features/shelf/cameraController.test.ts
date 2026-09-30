import { describe, expect, it, vi } from 'vitest';

import { gridLayoutOf, scaleForColumns, type Viewport } from './camera';
import { CameraController } from './cameraController';

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
