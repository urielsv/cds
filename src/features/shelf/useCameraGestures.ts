import { type RefObject, useEffect } from 'react';

import { type Camera, clamp, rubberBandCamera, rubberBandScale, zoomAt } from './camera';
import { type CameraController } from './cameraController';

/**
 * Movement before a press becomes a pan. Below this a press is a tap on a
 * cover; above it the tap is cancelled. Touch gets more slack than a mouse
 * because fingertips wobble.
 */
const TOUCH_SLOP_PX = 8;
const MOUSE_SLOP_PX = 3;

/** Only the last stretch of the drag decides the fling speed. */
const VELOCITY_WINDOW_MS = 90;

/** Wheel-to-zoom sensitivity for trackpad pinches (sent as ctrl+wheel). */
const WHEEL_ZOOM_RATE = 0.01;

/**
 * Trackpads send many small deltas; a mouse wheel sends one large one per
 * notch (usually 100). Anything this big is treated as a notch.
 */
const WHEEL_NOTCH = 40;

interface Point {
  x: number;
  y: number;
}

interface Sample extends Point {
  t: number;
}

interface WebKitGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/**
 * Pan, pinch, fling, wheel and trackpad gestures for the mosaic.
 *
 * Built on pointer events with `touch-action: none`, so the browser never
 * competes for the gesture: native scrolling cannot zoom a transformed plane,
 * and letting it pan while we zoom produces the stutter this avoids.
 *
 * While a finger is down the camera follows it exactly — no easing, no
 * smoothing. Easing belongs to the release only (fling and settle).
 */
export function useCameraGestures(
  viewportRef: RefObject<HTMLElement | null>,
  controller: CameraController,
  onPanningChange: (panning: boolean) => void,
): void {
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const pointers = new Map<number, Point>();
    let panning = false;
    let suppressClick = false;
    let pressOrigin: Point | null = null;
    let pressType = 'mouse';

    // Gesture baselines, re-taken whenever the number of fingers changes so
    // lifting one finger of a pinch does not make the content jump.
    let startCamera: Camera = controller.camera;
    let startCentroid: Point = { x: 0, y: 0 };
    let startDistance = 1;
    let samples: Sample[] = [];

    // Pinch bookkeeping for the snap on release: where the fingers were, how
    // fast the zoom was changing, and where the gesture started from.
    let pinched = false;
    let gestureFromScale = controller.camera.scale;
    let scaleSamples: { v: number; t: number }[] = [];
    let lastFocus: Point = { x: 0, y: 0 };

    // The viewport's position is read once per gesture, not per move: a layout
    // read inside a pointermove handler is exactly the per-frame work to avoid.
    let rect = element.getBoundingClientRect();
    const measure = () => {
      rect = element.getBoundingClientRect();
    };
    const local = (event: { clientX: number; clientY: number }): Point => ({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });

    let wheelIdle = 0;
    let wheelFromScale = controller.camera.scale;
    const WHEEL_IDLE_MS = 160;

    const centroid = (): Point => {
      let x = 0;
      let y = 0;
      for (const point of pointers.values()) {
        x += point.x;
        y += point.y;
      }
      return { x: x / pointers.size, y: y / pointers.size };
    };

    const spread = (): number => {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return 1;
      return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    };

    const rebase = () => {
      startCentroid = centroid();
      startDistance = spread();
      startCamera = controller.unstretched(startCentroid);
      samples = [];
    };

    const setPanning = (value: boolean) => {
      if (panning === value) return;
      panning = value;
      onPanningChange(value);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // A touch during momentum catches the content, like a hand on a spinning
      // record. That touch must not also open whatever cover it landed on.
      const wasMoving = controller.isMoving;
      controller.stop();
      suppressClick = wasMoving;
      if (pointers.size === 0) measure();

      if (pointers.size === 0) {
        pinched = false;
        scaleSamples = [];
        gestureFromScale = controller.camera.scale;
      }
      pointers.set(event.pointerId, local(event));
      pressType = event.pointerType;
      if (pointers.size === 1) pressOrigin = local(event);
      if (pointers.size >= 2) {
        // Two fingers is always a gesture, never a tap.
        suppressClick = true;
        startPan(event);
      }
      rebase();
    };

    const startPan = (event: PointerEvent) => {
      if (panning) return;
      setPanning(true);
      controller.lease();
      // Capture only once it is definitely a pan: capturing on press would
      // retarget the click away from the cover button and break every tap.
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* The pointer may already be gone; nothing to capture. */
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, local(event));

      if (!panning) {
        const origin = pressOrigin;
        const point = local(event);
        const slop = pressType === 'mouse' ? MOUSE_SLOP_PX : TOUCH_SLOP_PX;
        if (!origin || Math.hypot(point.x - origin.x, point.y - origin.y) < slop) return;
        suppressClick = true;
        startPan(event);
        rebase();
        return;
      }

      const current = centroid();
      const layout = controller.layout;
      const viewport = controller.viewport;
      let next: Camera;

      if (pointers.size >= 2) {
        const limits = controller.limits();
        // Past the zoom limits the pinch stretches with resistance and springs
        // back on release, rather than stopping dead under the fingers.
        const scale = rubberBandScale((startCamera.scale * spread()) / startDistance, limits);
        // Zoom about where the fingers started, then carry that point to where
        // the fingers are now: pinch and two-finger pan in one motion.
        const zoomed = zoomAt(startCamera, scale, startCentroid.x, startCentroid.y);
        pinched = true;
        lastFocus = current;
        scaleSamples.push({ v: Math.log(scale), t: event.timeStamp });
        while (
          scaleSamples.length > 2 &&
          event.timeStamp - (scaleSamples[0]?.t ?? event.timeStamp) > VELOCITY_WINDOW_MS
        ) {
          scaleSamples.shift();
        }
        next = {
          scale,
          x: zoomed.x + current.x - startCentroid.x,
          y: zoomed.y + current.y - startCentroid.y,
        };
      } else {
        next = {
          scale: startCamera.scale,
          // A wall that spans the screen width scrolls one way only. Sideways
          // travel, even rubber-banded, reads as the wall coming loose.
          x: controller.lockedX ? startCamera.x : startCamera.x + current.x - startCentroid.x,
          y: startCamera.y + current.y - startCentroid.y,
        };
      }

      // Past an edge the wall follows the finger with growing resistance, as a
      // native scroll view does; release springs it home (see `fling`).
      controller.set(rubberBandCamera(next, layout, viewport));

      const now = event.timeStamp;
      samples.push({ ...current, t: now });
      while (samples.length > 2 && now - (samples[0]?.t ?? now) > VELOCITY_WINDOW_MS) {
        samples.shift();
      }
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;

      if (pointers.size > 0) {
        // Went from pinch to one finger: carry on panning from here.
        rebase();
        return;
      }

      pressOrigin = null;
      if (!panning) return;
      setPanning(false);

      if (pinched) {
        // A pinch lands on a zoom stop, carried by how fast the fingers were
        // still spreading or closing as they lifted.
        const a = scaleSamples[0];
        const b = scaleSamples.at(-1);
        const fresh = b !== undefined && event.timeStamp - b.t < VELOCITY_WINDOW_MS;
        const scaleVelocity = a && b && fresh && b.t > a.t ? (b.v - a.v) / (b.t - a.t) : 0;
        controller.settle({ focus: lastFocus, scaleVelocity, fromScale: gestureFromScale });
        return;
      }

      const first = samples[0];
      const last = samples.at(-1);

      if (event.type !== 'pointercancel' && first && last && last.t > first.t) {
        const dt = last.t - first.t;
        const age = event.timeStamp - last.t;
        // A finger that stopped before lifting should not fling.
        if (age < VELOCITY_WINDOW_MS) {
          controller.fling((last.x - first.x) / dt, (last.y - first.y) / dt);
          return;
        }
      }
      controller.settle();
    };

    // Runs in the capture phase so it sees the click before the cover button.
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const onWheel = (event: WheelEvent) => {
      // Always ours: letting it through would scroll or zoom the page instead.
      event.preventDefault();
      const scaleFactor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const dx = event.deltaX * scaleFactor;
      const dy = event.deltaY * scaleFactor;
      const point = local(event);
      const zooming = event.ctrlKey || event.metaKey;

      // A mouse wheel's notch is a big, discrete delta: one notch, one stop.
      if (zooming && Math.abs(dy) >= WHEEL_NOTCH) {
        void controller.step(dy < 0 ? 1 : -1, point);
        return;
      }

      if (wheelIdle === 0) wheelFromScale = controller.camera.scale;
      controller.stop();
      controller.lease();
      window.clearTimeout(wheelIdle);
      // Wheel and trackpad input have no "end" event: once it goes quiet,
      // settle onto a zoom stop and whole columns.
      wheelIdle = window.setTimeout(() => {
        wheelIdle = 0;
        if (!controller.isMoving && !panning) {
          controller.settle(zooming ? { focus: point, fromScale: wheelFromScale } : {});
        }
      }, WHEEL_IDLE_MS);

      if (zooming) {
        // Trackpad pinch arrives as ctrl+wheel in Chromium and Firefox.
        const limits = controller.limits();
        const scale = clamp(
          controller.camera.scale * Math.exp(-dy * WHEEL_ZOOM_RATE),
          limits.min,
          limits.max,
        );
        controller.set(controller.clamped(zoomAt(controller.camera, scale, point.x, point.y)));
      } else {
        controller.set(
          controller.clamped({
            ...controller.camera,
            x: controller.lockedX ? controller.camera.x : controller.camera.x - dx,
            y: controller.camera.y - dy,
          }),
        );
      }
    };

    // Safari (macOS trackpad and iOS) reports pinches as proprietary gesture
    // events, and would zoom the whole page if they were not cancelled.
    let gestureStartScale = 1;
    let gestureCamera = controller.camera;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      // On touch screens the pointer handlers already drive the pinch.
      if (pointers.size > 0) return;
      measure();
      gestureStartScale = (event as WebKitGestureEvent).scale;
      gestureCamera = controller.camera;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      if (pointers.size > 0) return;
      const gesture = event as WebKitGestureEvent;
      const limits = controller.limits();
      const scale = clamp(
        (gestureCamera.scale * gesture.scale) / gestureStartScale,
        limits.min,
        limits.max,
      );
      const point = local(gesture);
      lastFocus = point;
      controller.set(controller.clamped(zoomAt(gestureCamera, scale, point.x, point.y)));
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      if (pointers.size > 0) return;
      controller.settle({ focus: lastFocus, fromScale: gestureCamera.scale });
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerEnd);
    element.addEventListener('pointercancel', onPointerEnd);
    element.addEventListener('click', onClickCapture, true);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart);
    element.addEventListener('gesturechange', onGestureChange);
    element.addEventListener('gestureend', onGestureEnd);
    window.addEventListener('resize', measure);

    return () => {
      window.clearTimeout(wheelIdle);
      window.removeEventListener('resize', measure);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerEnd);
      element.removeEventListener('pointercancel', onPointerEnd);
      element.removeEventListener('click', onClickCapture, true);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
      element.removeEventListener('gestureend', onGestureEnd);
    };
  }, [viewportRef, controller, onPanningChange]);
}
