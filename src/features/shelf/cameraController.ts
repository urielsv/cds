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
 * Momentum decays exponentially with this time constant, as kinetic scrolling
 * does: the wall keeps the finger's speed at release and slows smoothly, and a
 * flick at velocity v travels v × this far in total. 325 ms is the classic
 * kinetic-scrolling constant and is close to iOS's own scroll views. Physics,
 * not an animation duration, which is why it is not one of the motion tokens —
 * the slow-down is shaped by the throw, not by a fixed clock.
 *
 * It replaced a spring with a fixed visual duration, which carried a throw
 * only ~40% as far as iOS does and then braked it hard: on a phone, a flick
 * felt like it was caught rather than released.
 */
const MOMENTUM_TIME_CONSTANT_MS = 325;

/**
 * Snapping the landing to whole covers changes the distance, so each axis gets
 * its own time constant that lands exactly on the cell while still starting at
 * the finger's speed. Outside this band (a tiny flick snapped a whole cell
 * further, say) the stretch would read as a lurch or a crawl, and the release
 * falls back to a spring instead.
 */
const MIN_TIME_CONSTANT_MS = MOMENTUM_TIME_CONSTANT_MS * 0.5;
const MAX_TIME_CONSTANT_MS = MOMENTUM_TIME_CONSTANT_MS * 1.8;

/** Momentum ends once every axis is this close to its landing, in pixels. */
const MOMENTUM_REST_PX = 0.5;

/**
 * The time constant that carries an axis `distance` pixels when it starts at
 * `velocity` px/ms: 0 when there is nothing to travel, null when exponential
 * momentum cannot get there naturally (no speed, the wrong way, or a stretch
 * outside the band) and a spring should take over.
 */
export function timeConstant(distance: number, velocity: number): number | null {
  if (Math.abs(distance) <= MOMENTUM_REST_PX) return 0;
  if (velocity === 0 || Math.sign(distance) !== Math.sign(velocity)) return null;
  const tau = distance / velocity;
  return tau >= MIN_TIME_CONSTANT_MS && tau <= MAX_TIME_CONSTANT_MS ? tau : null;
}

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
   * snapped — and reached by exponential momentum that starts at the finger's
   * velocity, so there is no change of pace as the finger lifts and no drift
   * while the wall makes up its mind. Two cases use a spring instead: a throw
   * that would run past the end of the wall (the spring carries it into the
   * rubber band and back, as an edge does natively), and an axis already
   * stretched past its edge, which gets no throw and is pulled home.
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

    const ideal = {
      ...start,
      x: start.x + velocity.x * MOMENTUM_TIME_CONSTANT_MS,
      y: start.y + velocity.y * MOMENTUM_TIME_CONSTANT_MS,
    };
    const landing = snapCells(ideal, this.layout, this.viewport);

    const hitsEdge = past(ideal.x, bounds.x) || past(ideal.y, bounds.y);
    const tx = timeConstant(landing.x - start.x, velocity.x);
    const ty = timeConstant(landing.y - start.y, velocity.y);
    if (!hitsEdge && tx !== null && ty !== null) {
      this.coastTo(start, landing, tx, ty);
      return;
    }

    const distance = Math.hypot(landing.x - start.x, landing.y - start.y);
    // A throw of more than a screen gets slightly longer to cover the ground,
    // so a long flick does not blur past.
    const far = distance > Math.max(this.viewport.width, this.viewport.height);
    void this.springTo(landing, velocity, far ? 'slow' : 'base');
  }

  /**
   * Exponential momentum from `from` to `to`, each axis with its own time
   * constant (0 for an axis that does not move). Motion's `animate` is used
   * only as the frame clock — a linear 0→duration in milliseconds — so the
   * position is the closed-form decay, exact at every frame whatever the frame
   * rate, and it ends precisely on the landing cell.
   */
  private coastTo(from: Camera, to: Camera, tx: number, ty: number): void {
    if (this.reducedMotion) {
      this.set(to);
      this.release();
      return;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Time for an axis's remaining distance to fall below the rest threshold.
    const settleMs = (distance: number, tau: number) =>
      tau === 0 || Math.abs(distance) <= MOMENTUM_REST_PX
        ? 0
        : tau * Math.log(Math.abs(distance) / MOMENTUM_REST_PX);
    const duration = Math.max(settleMs(dx, tx), settleMs(dy, ty));
    if (duration === 0) {
      this.set(to);
      this.release();
      return;
    }
    const along = (distance: number, tau: number, t: number) =>
      tau === 0 ? distance : distance * (1 - Math.exp(-t / tau));

    this.lease();
    const controls = animate(0, duration, {
      duration: duration / 1000,
      ease: 'linear',
      onUpdate: (t: number) => {
        this.set({ scale: to.scale, x: from.x + along(dx, tx, t), y: from.y + along(dy, ty, t) });
      },
      onComplete: () => {
        if (this.running !== running) return;
        this.running = null;
        this.set(to);
        this.release();
      },
    });
    const running: Controls = {
      stop: () => {
        controls.stop();
      },
    };
    this.running = running;
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
