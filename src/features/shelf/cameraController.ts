import { animate, type Transition } from 'motion/react';

import { springTransition, transition } from '@/motion/tokens';

import {
  type Camera,
  clampCamera,
  columnsAtScale,
  type GridLayout,
  mixCamera,
  panBounds,
  scaleForColumns,
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

type Listener = (camera: Camera) => void;

interface Controls {
  stop: () => void;
  /** Where the move was going, so a touch can finish it rather than strand it. */
  target: Camera;
}

/** The page's own vertical scroll position, behind an interface so tests can fake it. */
export interface Scroller {
  readonly y: number;
  to: (y: number) => void;
}

export const windowScroller: Scroller = {
  get y() {
    return window.scrollY;
  },
  to(y) {
    window.scrollTo(0, y);
  },
};

/**
 * Owns the camera outside React.
 *
 * The wall is the page's own scrolling content, so moving up and down it is
 * native scrolling: the browser's momentum, its edge bounce, and — the reason
 * for the design — content that passes under Safari's translucent bars, as it
 * does on any ordinary page. A hand-rolled pan on a fixed layer can never do
 * that last part: Safari tints its bars with the page colour wherever the page
 * itself is not scrolling underneath.
 *
 * The camera is therefore two things at once. At rest (the fitted scale, no
 * sideways offset) its `y` *is* the scroll position, and setting it scrolls
 * the page. In motion — a pinch, the spring after one, a zoom — the wall is
 * drawn with a transform relative to wherever the page is scrolled, and the
 * move ends by scrolling the page to its resting place, so the hand-off is
 * invisible.
 *
 * Either way it writes at most one transform, on the one surface that holds
 * every tile, and tells React only what React needs — which tiles are in
 * range — via the listener.
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
  private scroller: Scroller | null = null;
  private scrollY = 0;
  private readonly listeners = new Set<Listener>();
  private running: Controls | null = null;
  private leased = false;
  private gesturing = false;
  private lastTransform = '';

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
    this.lastTransform = '';
    this.apply();
  }

  /**
   * Binds the camera's resting position to the page scroll. Without a
   * scroller (unit tests) the camera is a plain transform, as it would be on a
   * fixed layer.
   */
  attachScroller(scroller: Scroller | null): void {
    this.scroller = scroller;
    this.scrollY = scroller?.y ?? 0;
  }

  /**
   * The page scrolled — a finger, momentum, the keyboard, or our own
   * `scrollTo`. At rest the camera simply follows; mid-move it keeps its
   * screen position and the transform absorbs the difference.
   */
  syncScroll(): void {
    if (!this.scroller) return;
    this.scrollY = this.scroller.y;
    if (this.running === null && !this.gesturing && this.restScale()) {
      this.camera = { ...this.camera, y: this.surfaceTop() - this.scrollY };
    }
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
   * A pinch (or trackpad zoom) is in progress: the wall is drawn by transform
   * and must not be handed back to the page scroll mid-gesture, even when it
   * happens to pass through a resting pose.
   */
  beginGesture(): void {
    this.gesturing = true;
  }

  endGesture(): void {
    this.gesturing = false;
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
   * sideways.
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
    const anchor = focus ?? this.centre();
    if (this.reflowsAt(scale)) {
      this.stop();
      this.reflow?.(scale, anchor);
      return Promise.resolve();
    }
    return this.animateTo(
      snapCells(zoomAt(this.camera, scale, anchor.x, anchor.y), this.layout, this.viewport),
    );
  }

  /** Cancels any programmatic move where it stands — a pinch catches the content. */
  stop(): void {
    this.running?.stop();
    this.running = null;
  }

  /**
   * Ends any programmatic move at its destination. Used when a finger lands
   * to scroll: native scrolling needs the wall at rest under it, and jumping
   * to where the move was going beats stranding the wall mid-zoom.
   */
  finish(): void {
    const running = this.running;
    if (!running) return;
    this.stop();
    this.set(running.target);
    this.release();
  }

  get isMoving(): boolean {
    return this.running !== null;
  }

  /**
   * `will-change` is a lease, not a gift: the surface is promoted to its own
   * layer only while it is transformed, then released so the browser
   * re-rasterises it sharply at the new scale instead of stretching a stale
   * bitmap. Native scrolling needs no lease — the page scroller is already
   * composited.
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
   * passes a spring. A purely vertical move is a scroll of the page, frame by
   * frame; anything with a zoom in it is a transform until it lands.
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

    if (Math.abs(to.scale / from.scale - 1) > 0.001) this.lease();
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
        target: to,
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
    // Sprung, so it eases out of wherever the pinch left it rather than
    // starting from standstill.
    void this.animateTo(target, springTransition('fast'));
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

  /** Where the wall's top sits on the page: below the top inset (the shelf's padding). */
  private surfaceTop(): number {
    return this.viewport.insetTop;
  }

  /** The camera is at the fitted scale with nothing offset sideways. */
  private restScale(): boolean {
    if (this.viewport.width === 0) return false;
    const fitted = scaleForColumns(this.viewport, this.layout.columns);
    return Math.abs(this.camera.scale / fitted - 1) < 0.001 && Math.abs(this.camera.x) < 0.5;
  }

  /**
   * At rest, and inside the scroll range: a pose the page scroll alone can
   * show. A pinch never counts, even as it passes through one.
   */
  private atRest(): boolean {
    if (this.gesturing || !this.restScale()) return false;
    const range = panBounds(this.layout, this.viewport, this.camera.scale).y;
    return this.camera.y >= range.min - 0.5 && this.camera.y <= range.max + 0.5;
  }

  private apply(): void {
    let { y } = this.camera;
    const { x, scale } = this.camera;
    const scroller = this.scroller;
    let offsetY = y;

    if (scroller) {
      if (this.atRest()) {
        // Resting poses are scroll positions: move the page, not the wall.
        const wanted = this.surfaceTop() - y;
        if (Math.abs(wanted - this.scrollY) > 0.5) {
          scroller.to(Math.max(0, wanted));
          this.scrollY = scroller.y;
          // The browser has the last word on the scroll range (its viewport
          // can differ from ours by a collapsing toolbar); follow it.
          y = this.surfaceTop() - this.scrollY;
          this.camera = { ...this.camera, y };
        }
      }
      // The surface sits on the page at `surfaceTop`; draw it relative to that.
      offsetY = y - (this.surfaceTop() - this.scrollY);
    }

    if (this.surface) {
      // The only style write, on the only element that moves — and skipped
      // when nothing changed, which is every frame of a native scroll.
      const transform = `translate3d(${String(x)}px, ${String(offsetY)}px, 0) scale(${String(scale)})`;
      if (transform !== this.lastTransform) {
        this.surface.style.transform = transform;
        this.lastTransform = transform;
      }
    }
    for (const listener of this.listeners) listener(this.camera);
  }
}
