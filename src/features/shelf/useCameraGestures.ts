import { type RefObject, useEffect } from 'react';

import { type Camera, clamp, rubberBandCamera, rubberBandScale, zoomAt } from './camera';
import { type CameraController } from './cameraController';

/** Only the last stretch of a pinch decides how fast it was still zooming. */
const VELOCITY_WINDOW_MS = 90;

/** Wheel-to-zoom sensitivity for trackpad pinches (sent as ctrl+wheel). */
const WHEEL_ZOOM_RATE = 0.01;

/**
 * Trackpads send many small deltas; a mouse wheel sends one large one per
 * notch (usually 100). Anything this big is treated as a notch.
 */
const WHEEL_NOTCH = 40;

/** Wheel and trackpad input have no "end" event: this much quiet ends a zoom. */
const WHEEL_IDLE_MS = 160;

interface Point {
  x: number;
  y: number;
}

interface WebKitGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/**
 * Zoom gestures for the wall. Scrolling is not here: it is the page's own
 * native scroll (see `CameraController`), so one finger, the wheel, the
 * keyboard and the scrollbar all just work, with the platform's own momentum.
 *
 * What is here is everything native scrolling cannot do — a pinch that re-flows
 * the wall to more or fewer covers across. The shelf is `touch-action: pan-y`,
 * so the browser neither zooms the page nor pans sideways, and a two-finger
 * touch is ours: its moves are cancelled so the page holds still while the
 * wall follows the fingers exactly, then springs to a zoom stop on release.
 */
export function useCameraGestures(
  viewportRef: RefObject<HTMLElement | null>,
  controller: CameraController,
  onPanningChange: (pinching: boolean) => void,
): void {
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    // Pinch baselines, in screen (client) coordinates — the camera's own space.
    let pinching = false;
    let suppressClick = false;
    let startCamera: Camera = controller.camera;
    let startCentroid: Point = { x: 0, y: 0 };
    let startDistance = 1;
    let gestureFromScale = controller.camera.scale;
    let scaleSamples: { v: number; t: number }[] = [];
    let lastFocus: Point = { x: 0, y: 0 };

    const pair = (touches: TouchList): [Point, Point] | null => {
      const a = touches[0];
      const b = touches[1];
      if (!a || !b) return null;
      return [
        { x: a.clientX, y: a.clientY },
        { x: b.clientX, y: b.clientY },
      ];
    };
    const centreOf = ([a, b]: [Point, Point]): Point => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
    const spreadOf = ([a, b]: [Point, Point]): number =>
      Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));

    const beginPinch = (points: [Point, Point]) => {
      // A pinch during a zoom spring catches it where it is.
      controller.stop();
      controller.beginGesture();
      controller.lease();
      pinching = true;
      suppressClick = true;
      startCentroid = centreOf(points);
      startDistance = spreadOf(points);
      startCamera = controller.unstretched(startCentroid);
      gestureFromScale = startCamera.scale;
      scaleSamples = [];
      lastFocus = startCentroid;
      onPanningChange(true);
    };

    const endPinch = (timeStamp: number) => {
      pinching = false;
      controller.endGesture();
      onPanningChange(false);
      // Lands on a zoom stop, carried by how fast the fingers were still
      // spreading or closing as they lifted.
      const a = scaleSamples[0];
      const b = scaleSamples.at(-1);
      const fresh = b !== undefined && timeStamp - b.t < VELOCITY_WINDOW_MS;
      const scaleVelocity = a && b && fresh && b.t > a.t ? (b.v - a.v) / (b.t - a.t) : 0;
      controller.settle({ focus: lastFocus, scaleVelocity, fromScale: gestureFromScale });
    };

    /**
     * The non-passive `touchmove` listener exists only while two fingers are
     * down. Attached all the time, it would make every one-finger scroll wait
     * for the main thread before moving — exactly the latency native
     * scrolling is here to avoid. Added on the second finger's `touchstart`,
     * it is in place before that touch's first move.
     */
    let listening = false;
    const listen = (on: boolean) => {
      if (on === listening) return;
      listening = on;
      if (on) element.addEventListener('touchmove', onTouchMove, { passive: false });
      else element.removeEventListener('touchmove', onTouchMove);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        suppressClick = false;
        // A finger landing mid-move is about to scroll the page, which needs
        // the wall at rest under it: finish the move now.
        if (controller.isMoving) controller.finish();
        return;
      }
      listen(true);
      const points = pair(event.touches);
      if (points && !pinching) beginPinch(points);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!pinching) return;
      if (!event.cancelable) {
        // The first finger had already started scrolling the page, and that
        // cannot be cancelled now: leave the touch to the scroll.
        pinching = false;
        controller.endGesture();
        onPanningChange(false);
        controller.settle();
        return;
      }
      event.preventDefault();
      const points = pair(event.touches);
      if (!points) return;

      const current = centreOf(points);
      const limits = controller.limits();
      // Past the zoom limits the pinch stretches with resistance and springs
      // back on release, rather than stopping dead under the fingers.
      const scale = rubberBandScale((startCamera.scale * spreadOf(points)) / startDistance, limits);
      // Zoom about where the fingers started, then carry that point to where
      // the fingers are now: pinch and two-finger pan in one motion.
      const zoomed = zoomAt(startCamera, scale, startCentroid.x, startCentroid.y);
      lastFocus = current;
      scaleSamples.push({ v: Math.log(scale), t: event.timeStamp });
      while (
        scaleSamples.length > 2 &&
        event.timeStamp - (scaleSamples[0]?.t ?? event.timeStamp) > VELOCITY_WINDOW_MS
      ) {
        scaleSamples.shift();
      }
      controller.set(
        rubberBandCamera(
          {
            scale,
            x: zoomed.x + current.x - startCentroid.x,
            y: zoomed.y + current.y - startCentroid.y,
          },
          controller.layout,
          controller.viewport,
        ),
      );
    };

    const onTouchEnd = (event: TouchEvent) => {
      // Down to one finger (or none) ends the pinch: the remaining finger
      // cannot take over as a scroll mid-touch, so the wall settles now.
      if (pinching && event.touches.length < 2) endPinch(event.timeStamp);
      if (event.touches.length === 0) listen(false);
    };

    // A finger that lifts last after a pinch can still produce a click on the
    // cover beneath it; the pinch must not also open a disc.
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    let wheelIdle = 0;
    let wheelFromScale = controller.camera.scale;
    const local = (event: { clientX: number; clientY: number }): Point => ({
      x: event.clientX,
      y: event.clientY,
    });

    const endWheelZoom = (point: Point) => {
      wheelIdle = 0;
      controller.endGesture();
      controller.settle({ focus: point, fromScale: wheelFromScale });
    };

    const onWheel = (event: WheelEvent) => {
      const zooming = event.ctrlKey || event.metaKey;
      if (!zooming) {
        // An ordinary wheel or two-finger trackpad swipe scrolls the page
        // natively. It only has to take over from a programmatic move.
        if (controller.isMoving && wheelIdle === 0) controller.finish();
        return;
      }
      // Ctrl+wheel is a trackpad pinch (Chromium, Firefox) or a deliberate
      // zoom; the page itself must not zoom.
      event.preventDefault();
      const scaleFactor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const dy = event.deltaY * scaleFactor;
      const point = local(event);

      // A mouse wheel's notch is a big, discrete delta: one notch, one stop.
      if (Math.abs(dy) >= WHEEL_NOTCH) {
        void controller.step(dy < 0 ? 1 : -1, point);
        return;
      }

      if (wheelIdle === 0) {
        wheelFromScale = controller.camera.scale;
        controller.stop();
        controller.beginGesture();
        controller.lease();
      }
      window.clearTimeout(wheelIdle);
      wheelIdle = window.setTimeout(() => {
        endWheelZoom(point);
      }, WHEEL_IDLE_MS);

      const limits = controller.limits();
      const scale = clamp(
        controller.camera.scale * Math.exp(-dy * WHEEL_ZOOM_RATE),
        limits.min,
        limits.max,
      );
      controller.set(controller.clamped(zoomAt(controller.camera, scale, point.x, point.y)));
    };

    // Safari reports pinches as proprietary gesture events and would zoom the
    // whole page if they were not cancelled. On a touch screen the touch
    // handlers drive the pinch; on a Mac trackpad these are the pinch.
    let gestureStartScale = 1;
    let gestureCamera = controller.camera;
    let gestureActive = false;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      if (pinching) return;
      gestureActive = true;
      controller.stop();
      controller.beginGesture();
      controller.lease();
      gestureStartScale = (event as WebKitGestureEvent).scale;
      gestureCamera = controller.camera;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      if (pinching || !gestureActive) return;
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
      if (pinching || !gestureActive) return;
      gestureActive = false;
      controller.endGesture();
      controller.settle({ focus: lastFocus, fromScale: gestureCamera.scale });
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);
    element.addEventListener('click', onClickCapture, true);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart);
    element.addEventListener('gesturechange', onGestureChange);
    element.addEventListener('gestureend', onGestureEnd);

    return () => {
      window.clearTimeout(wheelIdle);
      if (pinching || gestureActive || wheelIdle !== 0) controller.endGesture();
      listen(false);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
      element.removeEventListener('click', onClickCapture, true);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
      element.removeEventListener('gestureend', onGestureEnd);
    };
  }, [viewportRef, controller, onPanningChange]);
}
