import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { coverLoader } from '@/lib/coverLoader';

afterEach(() => {
  cleanup();
  // Which covers have loaded is session state; tests must not inherit it.
  coverLoader.reset();
});

// jsdom implements neither ResizeObserver nor IntersectionObserver, and the
// virtualised shelf measures its scroll container with the former.
//
// A stub that merely does nothing is not enough: TanStack Virtual reads the
// element rect from the ResizeObserver callback, so a silent stub leaves it
// believing the viewport is 0x0 and it mounts no rows. This stub invokes the
// callback immediately on observe, which is what lets shelf tests exercise
// virtualisation at all.
class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;
  private readonly observed = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.observed.add(target);
    this.report(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  private report(target: Element): void {
    const rect = target.getBoundingClientRect();
    const entry = {
      target,
      contentRect: rect,
      borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
      contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
      devicePixelContentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
    } as unknown as ResizeObserverEntry;

    this.callback([entry], this);
  }
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

class IntersectionObserverStub {
  observe(): void {
    /* noop */
  }
  unobserve(): void {
    /* noop */
  }
  disconnect(): void {
    /* noop */
  }
  takeRecords(): [] {
    return [];
  }
}

vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);

// jsdom does not implement matchMedia, and every motion-aware component asks it
// whether the user prefers reduced motion. Default to "no preference" so tests
// exercise the animated code path unless they override this.
vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);

// jsdom lays nothing out and does not implement scrolling: `scrollTo` only
// logs "not implemented". The shelf scrolls the page to rest the wall, so
// give it a page that scrolls — instantly, with no bounds, which is enough for
// the camera's bookkeeping to be exercised. (API tests run without a DOM.)
let pageScrollY = 0;
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => pageScrollY,
  });
  window.scrollTo = (x?: number | ScrollToOptions, y?: number) => {
    const top = typeof x === 'object' ? x.top : y;
    if (typeof top === 'number') pageScrollY = Math.max(0, top);
  };
}
afterEach(() => {
  pageScrollY = 0;
});
