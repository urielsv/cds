import { describe, expect, it, vi } from 'vitest';

import { gridLayoutOf, scaleForColumns, type Viewport } from './camera';
import { CameraController, type Scroller } from './cameraController';

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

/** A page that scrolls instantly within [0, max]. */
function fakePage(max: number): Scroller & { scrolled: number[] } {
  let y = 0;
  const scrolled: number[] = [];
  return {
    scrolled,
    get y() {
      return y;
    },
    to(next) {
      y = Math.min(max, Math.max(0, next));
      scrolled.push(y);
    },
  };
}

describe('CameraController bound to the page scroll', () => {
  function scrolling(max = 5000) {
    const controller = controllerAt(4);
    const page = fakePage(max);
    controller.attachScroller(page);
    const surface = document.createElement('div');
    controller.attach(surface);
    return { controller, page, surface };
  }

  it('rests the wall by scrolling the page, not by moving the wall', () => {
    const { controller, page, surface } = scrolling();
    controller.set({ ...controller.camera, y: phone.insetTop - 600 });
    expect(page.y).toBe(600);
    expect(surface.style.transform).toMatch(/^translate3d\(0px, 0px, 0\)/);
  });

  it('follows a native scroll without writing a transform', () => {
    const { controller, page, surface } = scrolling();
    const before = surface.style.transform;
    page.to(320);
    controller.syncScroll();
    expect(controller.camera.y).toBe(phone.insetTop - 320);
    expect(surface.style.transform).toBe(before);
  });

  it('draws a pinch as a transform and leaves the page where it is', () => {
    const { controller, page, surface } = scrolling();
    page.to(200);
    controller.syncScroll();
    controller.beginGesture();
    const scale = controller.camera.scale * 1.3;
    // 60px above where the page alone would put the wall's top.
    controller.set({ scale, x: -40, y: phone.insetTop - 260 });
    expect(page.y).toBe(200);
    expect(surface.style.transform).toBe(`translate3d(-40px, -60px, 0) scale(${String(scale)})`);
    controller.endGesture();
  });

  it('follows the browser when it cannot scroll as far as asked', () => {
    const { controller, page } = scrolling(1000);
    controller.set({ ...controller.camera, y: phone.insetTop - 1500 });
    expect(page.y).toBe(1000);
    expect(controller.camera.y).toBe(phone.insetTop - 1000);
  });

  it('finishes a move at its destination when a finger lands', () => {
    const controller = controllerAt(4);
    controller.setReducedMotion(false);
    const page = fakePage(5000);
    controller.attachScroller(page);
    void controller.animateTo({ ...controller.camera, y: phone.insetTop - 800 });
    expect(controller.isMoving).toBe(true);
    controller.finish();
    expect(controller.isMoving).toBe(false);
    expect(page.y).toBe(800);
  });
});
