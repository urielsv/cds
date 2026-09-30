import { animate, type Transition } from 'motion/react';

import { type DurationName, springTransition, transition } from '@/motion/tokens';

import {
  type Camera,
  clampCamera,
  columnsAtScale,
  type GridLayout,
  mixCamera,
  panBounds,
  rubberBandCamera,
  scaleLimits,
  snapCamera,
  snapCells,
  type SnapOptions,
  stepZoom,
  unbandCamera,
  unbandScale,
  type Viewport,
  zoomAt,
} from './camera';

/**
 * How far a flick throws the wall: the distance a finger moving at release
 * velocity would cover in this many milliseconds. Physics, not an animation
 * duration, which is why it is not one of the motion tokens — it decides how
 * far a hard flick goes, not how long the movement takes.
 */
const THROW_REACH_MS = 190;

type Listener = (camera: Camera) => void;

interface Controls {
  stop: () => void;
}

interface Velocity {
  /** Pixels per millisecond, as measured from pointer events. */
  x: number;
  y: number;
}

/**
 * Owns the camera outside React.
 *
 * During a gesture the camera changes every frame; routing that through React
 * state would re-render the tile tree sixty times a second. Instead the
 * controller writes the one surface transform directly, and tells React only
 * about what React needs — which tiles are in range — via the listener.
 *
 * Releases are Motion springs rather than tweens. A spring starts at the speed
 * the wall already has, so a throw continues the finger's motion instead of
 * restarting it, and a wall stretched past its edge is pulled home with a
 * force proportional to the stretch — which is what an edge feels like on
 * native scroll views.
 */
export class CameraController {
  camera: Camera = { x: 0, y: 0, scale: 1 };
  layout: GridLayout = { columns: 1, rows: 1, worldWidth: 1, worldHeight: 1 };
  viewport: Viewport = { width: 0, height: 0, insetTop: 0, insetBottom: 0 };
  reducedMotion = false;

  /**
   * Set by the wall when it re-flows on zoom (see `GridLayout.zoomColumns`).
   * Called instead of animating whenever a zoom would land on a different
   * column count, with the scale to land at and the screen point to keep
   * still; the wall re-flows and then animates the camera itself.
   */
  reflow: ((targetScale: number, focus: { x: number; y: number }) => void) | null = null;

  private surface: HTMLElement | null = null;
  private readonly listeners = new Set<Listener>();
  private running: Controls | null = null;
  private leased = false;

  private configured = false;

  /**
   * Updates the geometry and returns what it was before, so the caller can
   * keep the view steady across a resize. `placed` is false the first time.
   */
  configure(
    layout: GridLayout,
    viewport: Viewport,
  ): { layout: GridLayout; viewport: Viewport; placed: boolean } {
    const previous = { layout: this.layout, viewport: this.viewport, placed: this.configured };
    this.layout = layout;
    this.viewport = viewport;
    this.configured = true;
    return previous;
  }

  setReflow(
    handler: ((targetScale: number, focus: { x: number; y: number }) => void) | null,
  ): void {
    this.reflow = handler;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }

  attach(surface: HTMLElement | null): void {
    this.surface = surface;
    this.apply();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Sets the camera immediately, exactly as given (a gesture may stretch it). */
  set(camera: Camera): void {
    this.camera = camera;
    this.apply();
  }

  clamped(camera: Camera = this.camera): Camera {
    return clampCamera(camera, this.layout, this.viewport);
  }

  limits() {
    return scaleLimits(this.layout, this.viewport);
  }

  /**
   * The camera a gesture should treat as its starting point: the current one
   * with any rubber-band stretch undone, zoom anchored at `focus`. Picking up
   * from the stretched position as if it were real would make the wall jump
   * inward the moment a finger lands on it mid-bounce.
   */
  unstretched(focus: { x: number; y: number }): Camera {
    const positions = unbandCamera(this.camera, this.layout, this.viewport);
    const scale = unbandScale(this.camera.scale, this.limits());
    return scale === this.camera.scale ? positions : zoomAt(positions, scale, focus.x, focus.y);
  }

  /**
   * True when the wall is no wider than the screen at the camera's scale —
   * always, at rest, for a width-filling wall. There is then nothing to pan
   * sideways, and a drag moves the wall vertically only.
   */
  get lockedX(): boolean {
    return this.layout.worldWidth * this.camera.scale <= this.viewport.width + 0.5;
  }

  /** Whether landing at `scale` means re-flowing to a different column count. */
  private reflowsAt(scale: number): boolean {
    return (
      this.reflow !== null &&
      this.layout.zoomColumns !== undefined &&
      columnsAtScale(this.viewport, scale) !== this.layout.columns
    );
  }

  /**
   * Zooms to `scale`, re-flowing the wall if that is a different column count,
   * anchored at `focus` (default: the centre of the screen).
   */
  zoomTo(scale: number, focus?: { x: number; y: number }): Promise<void> {
    const anchor = focus ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    if (this.reflowsAt(scale)) {
      this.stop();
      this.reflow?.(scale, anchor);
      return Promise.resolve();
    }
    return this.animateTo(
      snapCells(zoomAt(this.camera, scale, anchor.x, anchor.y), this.layout, this.viewport),
    );
  }

  /** Cancels any momentum or programmatic move — a touch catches the content. */
  stop(): void {
    this.running?.stop();
    this.running = null;
  }

  get isMoving(): boolean {
    return this.running !== null;
  }

  /**
   * `will-change` is a lease, not a gift: the surface is promoted to its own
   * layer only while it moves, then released so the browser re-rasterises it
   * sharply at the new scale instead of stretching a stale bitmap.
   */
  lease(): void {
    if (this.leased || !this.surface) return;
    this.leased = true;
    this.surface.style.willChange = 'transform';
  }

  release(): void {
    if (!this.leased || !this.surface) return;
    this.leased = false;
    this.surface.style.willChange = '';
  }

  /**
   * Animates to `target` along the pan-and-zoom path of `mixCamera`. Tweens by
   * default, for moves nobody is touching (buttons, keys, reveal); a release
   * passes a spring.
   */
  animateTo(target: Camera, options: Transition = transition('base', 'standard')): Promise<void> {
    this.stop();
    const to = this.clamped(target);
    const from = this.camera;

    if (this.reducedMotion) {
      // Reduced motion: arrive, do not travel.
      this.set(to);
      this.release();
      return Promise.resolve();
    }

    this.lease();
    return new Promise((resolve) => {
      const controls = animate(0, 1, {
        ...options,
        onUpdate: (t: number) => {
          this.set(mixCamera(from, to, t, this.viewport));
        },
        onComplete: () => {
          this.running = null;
          this.set(to);
          this.release();
          resolve();
        },
      });
      this.running = {
        stop: () => {
          controls.stop();
          resolve();
        },
      };
    });
  }

  /**
   * Brings the camera to rest after a gesture: onto the nearest zoom stop,
   * inside the bounds, with whole covers across the screen.
   */
  settle(options: SnapOptions = {}): void {
    const target = snapCamera(this.camera, this.layout, this.viewport, options);
    if (this.reflowsAt(target.scale)) {
      this.stop();
      this.reflow?.(target.scale, options.focus ?? this.centre());
      return;
    }
    const c = this.camera;
    const moved =
      Math.abs(target.x - c.x) > 0.5 ||
      Math.abs(target.y - c.y) > 0.5 ||
      Math.abs(target.scale / c.scale - 1) > 0.001;
    if (!moved) {
      this.set(target);
      this.release();
      return;
    }
    if (Math.abs(target.scale / c.scale - 1) > 0.001) {
      // A zoom change travels the pan-and-zoom path, sprung so it eases out
      // of wherever the pinch left it rather than starting from standstill.
      void this.animateTo(target, springTransition('fast'));
      return;
    }
    void this.springTo(target, { x: 0, y: 0 }, 'fast');
  }

  /** One zoom stop in or out, animated, anchored at `focus` (default: centre). */
  step(direction: 1 | -1, focus?: { x: number; y: number }): Promise<void> {
    const target = stepZoom(this.camera, direction, this.layout, this.viewport, focus);
    if (this.reflowsAt(target.scale)) return this.zoomTo(target.scale, focus);
    return this.animateTo(target, transition('fast'));
  }

  private centre(): { x: number; y: number } {
    return { x: this.viewport.width / 2, y: this.viewport.height / 2 };
  }

  /**
   * Releases a pan: throws the wall along the flick and lands it on whole
   * covers.
   *
   * The landing cell is decided at release — projected along the flick,
   * clamped, snapped — and reached by a spring that starts at the finger's
   * velocity, so there is no change of pace as the finger lifts and no drift
   * while the wall makes up its mind. An axis already stretched past its edge
   * gets no throw: it is pulled home, as a scroll view does.
   */
  fling(vx: number, vy: number): void {
    this.stop();
    const start = unbandCamera(this.camera, this.layout, this.viewport);
    const bounds = panBounds(this.layout, this.viewport, start.scale);
    const past = (value: number, range: { min: number; max: number }) =>
      value < range.min - 0.5 || value > range.max + 0.5;
    const velocity = {
      // A wall that fits the width does not travel sideways, however the
      // finger drifted.
      x: past(start.x, bounds.x) || this.lockedX ? 0 : vx,
      y: past(start.y, bounds.y) ? 0 : vy,
    };

    const landing = snapCells(
      {
        ...start,
        x: start.x + velocity.x * THROW_REACH_MS,
        y: start.y + velocity.y * THROW_REACH_MS,
      },
      this.layout,
      this.viewport,
    );
    const distance = Math.hypot(landing.x - start.x, landing.y - start.y);
    // A throw of more than a screen gets slightly longer to cover the ground,
    // so a long flick does not blur past.
    const far = distance > Math.max(this.viewport.width, this.viewport.height);
    void this.springTo(landing, velocity, far ? 'slow' : 'base');
  }

  /**
   * Springs each axis to `target` independently, each starting at its own
   * velocity — a diagonal flick keeps its direction and its speed on both
   * axes. Travels in unstretched coordinates and is drawn through the rubber
   * band, so a spring that overshoots an edge meets the same resistance a
   * finger would, and one that starts stretched does not jump.
   */
  private springTo(target: Camera, velocity: Velocity, duration: DurationName): Promise<void> {
    this.stop();
    const to = this.clamped(target);

    if (this.reducedMotion || !isFinite(velocity.x + velocity.y)) {
      this.set(to);
      this.release();
      return Promise.resolve();
    }

    const from = unbandCamera(this.camera, this.layout, this.viewport);
    const scale = to.scale;
    let x = from.x;
    let y = from.y;

    // Both axes tick in the same Motion frame; draw once per frame, not once
    // per axis.
    let queued = false;
    const draw = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (this.running === controls) {
          this.set(rubberBandCamera({ scale, x, y }, this.layout, this.viewport));
        }
      });
    };

    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    let ax: Controls | null = null;
    let ay: Controls | null = null;
    // Created before the animations start, so a spring that completes
    // synchronously (nothing to travel) still finds itself running.
    const controls: Controls = {
      stop: () => {
        ax?.stop();
        ay?.stop();
        resolveDone();
      },
    };
    this.running = controls;

    let remaining = 2;
    const finish = () => {
      remaining -= 1;
      if (remaining > 0 || this.running !== controls) return;
      this.running = null;
      this.set(to);
      this.release();
      resolveDone();
    };

    this.lease();
    // Motion measures spring velocity per second; pointer velocity is per ms.
    ax = animate(from.x, to.x, {
      ...springTransition(duration, velocity.x * 1000),
      onUpdate: (value: number) => {
        x = value;
        draw();
      },
      onComplete: finish,
    });
    ay = animate(from.y, to.y, {
      ...springTransition(duration, velocity.y * 1000),
      onUpdate: (value: number) => {
        y = value;
        draw();
      },
      onComplete: finish,
    });
    return done;
  }

  private apply(): void {
    const { x, y, scale } = this.camera;
    if (this.surface) {
      // The only style write per frame, on the only element that moves.
      this.surface.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    }
    for (const listener of this.listeners) listener(this.camera);
  }
}
