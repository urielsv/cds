/**
 * Loads cover art into memory and hands tiles an object URL for it.
 *
 * Why not just `<img src>` and the HTTP cache: measured, the demo's artwork
 * reaches us through two redirects (Cover Art Archive 307 → archive.org 302 →
 * a storage node), and neither redirect carries any cache headers. Browsers do
 * not cache them. So a cover that was prefetched, or already shown and then
 * scrolled away, costs both redirect round trips again (~1.7 s) the next time a
 * tile mounts over it — the image bytes are cached, the way to them is not.
 * That is why covers off to the side still appeared as colour blocks after
 * prefetching "worked". Holding the bytes as a Blob skips the whole chain: a
 * tile that mounts over a loaded cover shows it in the same frame.
 *
 * Also owns priority. Covers wanted by mounted tiles (`want`) always go first;
 * warming the neighbourhood (`prefetch`) only uses the network the screen is
 * not using.
 *
 * Falls back to plain `<img src>` ("direct") where blobs are unavailable: an
 * artwork host without CORS, or an environment without `fetch` and object
 * URLs.
 */

export type CoverState = 'idle' | 'queued' | 'loading' | 'ready' | 'failed' | 'direct';

type Priority = 'high' | 'low';

interface Entry {
  state: CoverState;
  priority: Priority;
  objectUrl: string | null;
  bytes: number;
  /** Mounted tiles currently showing or waiting for this cover. */
  wanted: number;
  /** A tile has actually painted it — not just fetched it. */
  shown: boolean;
}

export interface CoverLoaderDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

/**
 * Requests in flight at once, in total. Both artwork hosts speak HTTP/2, so
 * this is not the old six-sockets-per-host limit but politeness: enough that a
 * first screen of ~36 slow (~2.4 s) demo covers arrives in a few rounds rather
 * than six, few enough not to hammer a community-run archive.
 */
const MAX_IN_FLIGHT = 8;

/**
 * Prefetches in flight while the screen is still loading. Measured on the demo
 * host: more than this and covers on screen stayed blank behind prefetches.
 */
const LOW_WHILE_BUSY = 2;

/**
 * Bytes of artwork held in memory. At ~15 KB per demo cover and ~60 KB per
 * stored 500 px tile that is several hundred covers — a whole collection for
 * this app — while staying well inside what a phone tab can afford.
 */
const MAX_BYTES = 24 * 1024 * 1024;

/** A cover that has not arrived in this long is treated as failed. */
const TIMEOUT_MS = 20_000;

/**
 * Network errors from one host before it is assumed not to allow CORS, and its
 * covers are loaded as plain images instead. More than one, so a single
 * dropped request on cellular does not switch a whole host off.
 */
const CORS_STRIKES = 2;

export class CoverLoader {
  private readonly entries = new Map<string, Entry>();
  private highQueue: string[] = [];
  private lowQueue: string[] = [];
  private inFlight = { high: 0, low: 0 };
  private bytes = 0;
  private readonly strikes = new Map<string, number>();
  private readonly directOrigins = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly urlListeners = new Map<string, Set<() => void>>();

  private readonly deps: CoverLoaderDeps | null;

  constructor(deps: CoverLoaderDeps | null) {
    this.deps = deps;
  }

  /** A string that changes whenever what a tile should render changes. */
  snapshot(url: string): string {
    const entry = this.entries.get(url);
    if (!entry) return this.isDirect(url) ? 'direct|' : 'idle|';
    return `${entry.state}|${entry.objectUrl ?? ''}`;
  }

  state(url: string): CoverState {
    return this.entries.get(url)?.state ?? (this.isDirect(url) ? 'direct' : 'idle');
  }

  /** What an `<img>` should load right now, or null if nothing yet. */
  src(url: string): string | null {
    const entry = this.entries.get(url);
    if (entry?.state === 'ready') return entry.objectUrl ?? url;
    if (entry?.state === 'direct' || (!entry && this.isDirect(url))) return url;
    return null;
  }

  /** Loaded or failed: nothing further will happen for this URL. */
  isSettled(url: string): boolean {
    const state = this.entries.get(url)?.state;
    return state === 'ready' || state === 'failed';
  }

  /** Mounted tiles still waiting for their cover. */
  pendingCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.wanted > 0 && entry.state !== 'ready' && entry.state !== 'failed') count += 1;
    }
    return count;
  }

  /**
   * A mounted tile wants this cover now. Returns the release to call on
   * unmount. While wanted, a loaded cover is never evicted.
   */
  want(url: string): () => void {
    const entry = this.entry(url);
    entry.wanted += 1;
    // Recently wanted covers are the last to be evicted.
    this.entries.delete(url);
    this.entries.set(url, entry);

    if (entry.state === 'idle') {
      if (this.isDirect(url)) {
        entry.state = 'direct';
        this.changed(url);
      } else {
        entry.state = 'queued';
        entry.priority = 'high';
        this.highQueue.push(url);
        this.changed(url);
      }
    } else if (entry.state === 'queued' && entry.priority === 'low') {
      this.lowQueue = this.lowQueue.filter((queued) => queued !== url);
      entry.priority = 'high';
      this.highQueue.push(url);
    }
    this.pump();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.wanted = Math.max(0, entry.wanted - 1);
      // A tile scrolled away before its cover started loading gives up its
      // place: the screen has moved on, and the prefetcher re-queues it if it
      // is still nearby.
      if (entry.wanted === 0 && entry.state === 'queued' && entry.priority === 'high') {
        this.highQueue = this.highQueue.filter((queued) => queued !== url);
        entry.state = 'idle';
        this.changed(url);
      }
      this.evict();
      this.notify();
    };
  }

  /**
   * Replaces the background queue with `urls`, nearest first. Anything queued
   * from an earlier position that is no longer wanted is dropped: the covers
   * around the viewport now matter more than those around where it was.
   */
  prefetch(urls: readonly string[]): void {
    for (const url of this.lowQueue) {
      const entry = this.entries.get(url);
      if (entry?.state === 'queued' && entry.priority === 'low') entry.state = 'idle';
    }
    this.lowQueue = [];
    for (const url of urls) {
      if (this.isDirect(url)) continue;
      const entry = this.entry(url);
      if (entry.state !== 'idle') continue;
      entry.state = 'queued';
      entry.priority = 'low';
      this.lowQueue.push(url);
    }
    this.pump();
  }

  /**
   * Reported by a tile once its `<img>` has loaded — the cover is on screen,
   * not merely in memory. For a direct (no blob) cover this is also the only
   * way the loader learns it arrived.
   */
  markLoaded(url: string): void {
    const entry = this.entry(url);
    if (entry.state === 'ready' && entry.shown) return;
    entry.state = 'ready';
    entry.shown = true;
    this.changed(url);
  }

  /** Painted by a tile, or failed for good: what the intro waits on. */
  isOnScreen(url: string): boolean {
    const entry = this.entries.get(url);
    return entry !== undefined && (entry.shown || entry.state === 'failed');
  }

  /** Reported by an `<img>` that could not load or decode its cover. */
  markFailed(url: string): void {
    const entry = this.entry(url);
    if (entry.state === 'failed') return;
    if (entry.objectUrl !== null) {
      this.deps?.revokeObjectURL(entry.objectUrl);
      this.bytes -= entry.bytes;
      entry.objectUrl = null;
      entry.bytes = 0;
    }
    entry.state = 'failed';
    this.changed(url);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Only notified about one URL, so a change wakes one tile, not the wall. */
  subscribeUrl(url: string, listener: () => void): () => void {
    let set = this.urlListeners.get(url);
    if (!set) {
      set = new Set();
      this.urlListeners.set(url, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.urlListeners.delete(url);
    };
  }

  /** For tests: forget everything. */
  reset(): void {
    for (const entry of this.entries.values()) {
      if (entry.objectUrl !== null) this.deps?.revokeObjectURL(entry.objectUrl);
    }
    this.entries.clear();
    this.highQueue = [];
    this.lowQueue = [];
    this.inFlight = { high: 0, low: 0 };
    this.bytes = 0;
    this.strikes.clear();
    this.directOrigins.clear();
  }

  private entry(url: string): Entry {
    let entry = this.entries.get(url);
    if (!entry) {
      entry = {
        state: 'idle',
        priority: 'low',
        objectUrl: null,
        bytes: 0,
        wanted: 0,
        shown: false,
      };
      this.entries.set(url, entry);
    }
    return entry;
  }

  private isDirect(url: string): boolean {
    return this.deps === null || this.directOrigins.has(originOf(url));
  }

  private pump(): void {
    const total = () => this.inFlight.high + this.inFlight.low;
    while (total() < MAX_IN_FLIGHT) {
      const url = this.highQueue.shift();
      if (url === undefined) break;
      this.start(url, 'high');
    }
    // Background work only once nothing wanted on screen is waiting to start.
    const lowLimit =
      this.highQueue.length > 0 ? 0 : this.inFlight.high > 0 ? LOW_WHILE_BUSY : MAX_IN_FLIGHT;
    while (this.inFlight.low < lowLimit && total() < MAX_IN_FLIGHT) {
      const url = this.lowQueue.shift();
      if (url === undefined) break;
      this.start(url, 'low');
    }
  }

  private start(url: string, priority: Priority): void {
    const deps = this.deps;
    const entry = this.entries.get(url);
    if (!deps || entry?.state !== 'queued') return;
    entry.state = 'loading';
    this.inFlight[priority] += 1;
    this.changed(url);

    const finish = () => {
      this.inFlight[priority] -= 1;
      this.pump();
    };

    deps
      .fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        priority,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      .then(async (response) => {
        // A 404 is the host's real answer; retrying as an <img> would not help.
        if (!response.ok) throw new HttpError(response.status);
        return response.blob();
      })
      .then((blob) => {
        entry.objectUrl = deps.createObjectURL(blob);
        entry.bytes = blob.size;
        entry.state = 'ready';
        this.bytes += blob.size;
        this.strikes.delete(originOf(url));
        this.changed(url);
        this.evict();
      })
      .catch((error: unknown) => {
        if (error instanceof HttpError || isTimeout(error)) {
          entry.state = 'failed';
        } else {
          // A TypeError: offline, or the host does not allow CORS — which fetch
          // cannot tell apart. Let the tile try a plain <img>, and after
          // repeated strikes stop trying blobs for that host at all.
          const origin = originOf(url);
          const strikes = (this.strikes.get(origin) ?? 0) + 1;
          this.strikes.set(origin, strikes);
          if (strikes >= CORS_STRIKES) this.directOrigins.add(origin);
          entry.state = 'direct';
        }
        this.changed(url);
      })
      .finally(finish);
  }

  /** Drops the least recently wanted covers no tile is using, over budget. */
  private evict(): void {
    if (this.bytes <= MAX_BYTES) return;
    for (const [url, entry] of this.entries) {
      if (this.bytes <= MAX_BYTES) break;
      if (entry.state !== 'ready' || entry.objectUrl === null || entry.wanted > 0) continue;
      this.deps?.revokeObjectURL(entry.objectUrl);
      this.bytes -= entry.bytes;
      this.entries.delete(url);
      this.changed(url);
    }
  }

  private changed(url: string): void {
    for (const listener of this.urlListeners.get(url) ?? []) listener();
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${String(status)}`);
    this.status = status;
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

function originOf(url: string): string {
  try {
    // No `location` outside a page (tests, a worker); absolute URLs still parse.
    const base = typeof location === 'undefined' ? undefined : location.href;
    return new URL(url, base).origin;
  } catch {
    return '';
  }
}

function browserDeps(): CoverLoaderDeps | null {
  if (
    typeof fetch !== 'function' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof AbortSignal.timeout !== 'function'
  ) {
    return null;
  }
  return {
    fetch: (url, init) => fetch(url, init),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => {
      URL.revokeObjectURL(url);
    },
  };
}

/** The one loader the wall shares. */
export const coverLoader = new CoverLoader(browserDeps());
