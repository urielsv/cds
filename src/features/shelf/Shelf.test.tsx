import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateFixtureCollection } from '@/dev/fixtureCollection';

import { Shelf, type ShelfHandle } from './Shelf';

/**
 * jsdom lays nothing out, so every element is 0×0 and the wall would mount
 * nothing. These tests fake a phone-sized viewport so the camera and
 * virtualisation — the entire point of the shelf — are actually exercised.
 */
const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 780;

function stubViewport() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    top: 0,
    left: 0,
    right: VIEWPORT_WIDTH,
    bottom: VIEWPORT_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function renderShelf(count: number, props: Partial<Parameters<typeof Shelf>[0]> = {}) {
  const discs = generateFixtureCollection(count).discs;
  return {
    discs,
    ...render(
      <Shelf
        discs={discs}
        matches={null}
        openDiscId={null}
        arrivedDiscId={null}
        onOpen={vi.fn()}
        {...props}
      />,
    ),
  };
}

const tiles = (container: HTMLElement) => container.querySelectorAll('.disc-tile');

describe('Shelf', () => {
  beforeEach(stubViewport);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts covers for a realistic collection', () => {
    const { container } = renderShelf(150);
    expect(tiles(container).length).toBeGreaterThan(0);
  });

  it('mounts only the covers near the screen, not the whole collection', () => {
    const { container } = renderShelf(400);
    // If this ever equals 400, virtualisation has silently broken.
    expect(tiles(container).length).toBeGreaterThan(0);
    expect(tiles(container).length).toBeLessThan(120);
  });

  it('mounts a similar number of covers at 150 and 400 discs', () => {
    const small = renderShelf(150);
    const smallCount = tiles(small.container).length;
    small.unmount();
    const large = renderShelf(400);
    expect(Math.abs(tiles(large.container).length - smallCount)).toBeLessThan(smallCount);
  });

  it('shows a single disc whole', () => {
    const { container } = renderShelf(1);
    expect(tiles(container)).toHaveLength(1);
  });

  it('moves the whole wall with one transform on one surface', () => {
    const { container } = renderShelf(150);
    const surface = container.querySelector<HTMLElement>('.shelf__surface');
    expect(surface?.style.transform).toMatch(/translate3d\(.+\) scale\(.+\)/);
    // No layer is promoted while nothing is moving.
    expect(surface?.style.willChange).toBe('');
  });

  it('greys out non-matching covers instead of removing them', () => {
    const { container, discs } = renderShelf(150, { matches: new Set() });
    const mounted = tiles(container);
    expect(mounted.length).toBeGreaterThan(0);
    expect([...mounted].every((tile) => tile.classList.contains('disc-tile--dimmed'))).toBe(true);
    expect(discs.length).toBe(150);
  });

  it('leaves matching covers at full strength', () => {
    const discs = generateFixtureCollection(150).discs;
    const first = discs[0]!;
    const { container } = render(
      <Shelf
        discs={discs}
        matches={new Set([first.id])}
        openDiscId={null}
        arrivedDiscId={null}
        onOpen={vi.fn()}
      />,
    );
    const tile = container.querySelector(`[data-index="0"]`);
    expect(tile).not.toHaveClass('disc-tile--dimmed');
  });

  it('announces how many albums match', () => {
    renderShelf(150, { matches: new Set(['x']) });
    expect(screen.getByRole('application')).toHaveAccessibleName(/150 albums, 1 matching/);
  });

  it('keeps exactly one cover in the tab order', () => {
    const { container } = renderShelf(150);
    expect(container.querySelectorAll('.disc-tile[tabindex="0"]')).toHaveLength(1);
  });

  it('moves focus between covers with the arrow keys', () => {
    const { container } = renderShelf(150);
    const first = container.querySelector<HTMLElement>('[data-index="0"]')!;
    act(() => {
      first.focus();
    });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toHaveAttribute('data-index', '1');
  });

  it('hides the cover of the open disc so it appears to have left the wall', () => {
    const discs = generateFixtureCollection(150).discs;
    const { container } = render(
      <Shelf
        discs={discs}
        matches={null}
        openDiscId={discs[0]!.id}
        arrivedDiscId={null}
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-index="0"]')).toHaveClass('disc-tile--lifted');
  });

  it('reports where a cover is on screen, for the open transition', () => {
    const discs = generateFixtureCollection(150).discs;
    const ref = createRef<ShelfHandle>();
    render(
      <Shelf
        ref={ref}
        discs={discs}
        matches={null}
        openDiscId={null}
        arrivedDiscId={null}
        onOpen={vi.fn()}
      />,
    );
    const rect = ref.current?.rectFor(discs[0]!.id);
    expect(rect?.width).toBeGreaterThan(0);
    expect(rect?.width).toBe(rect?.height);
    expect(ref.current?.rectFor('missing')).toBeNull();
  });

  it('keeps every cover mounted once', () => {
    const { container } = renderShelf(150);
    const ids = [...container.querySelectorAll<HTMLElement>('.disc-tile')].map(
      (tile) => tile.dataset.index,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renders an empty collection without crashing', () => {
    const { container } = render(
      <Shelf discs={[]} matches={null} openDiscId={null} arrivedDiscId={null} onOpen={vi.fn()} />,
    );
    expect(container.querySelector('.shelf')).not.toBeNull();
    expect(tiles(container)).toHaveLength(0);
  });

  it('spans the screen width exactly, so there is nothing to pan sideways', () => {
    const { container } = renderShelf(150);
    const surface = container.querySelector<HTMLElement>('.shelf__surface')!;
    const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) scale\(([\d.]+)\)/.exec(
      surface.style.transform,
    );
    expect(match).not.toBeNull();
    const [, x, , scale] = match!;
    expect(Number(x)).toBe(0);
    expect(Number.parseFloat(surface.style.width) * Number(scale)).toBeCloseTo(VIEWPORT_WIDTH, 1);
  });

  it('re-flows to more covers across when zooming out, still exactly screen-wide', () => {
    const ref = createRef<ShelfHandle>();
    const { container } = renderShelf(150, { ref });
    const surface = container.querySelector<HTMLElement>('.shelf__surface')!;
    const before = Number.parseFloat(surface.style.width);
    act(() => {
      ref.current?.zoomStep(-1);
    });
    const after = Number.parseFloat(surface.style.width);
    expect(after).toBeGreaterThan(before);
    // Every column count the wall re-flows to is whole covers.
    expect((after / 160) % 1).toBe(0);
  });

  it('re-flows back to fewer, larger covers when zooming in', () => {
    const ref = createRef<ShelfHandle>();
    const { container } = renderShelf(150, { ref });
    const surface = container.querySelector<HTMLElement>('.shelf__surface')!;
    const before = Number.parseFloat(surface.style.width);
    act(() => {
      ref.current?.zoomStep(1);
    });
    expect(Number.parseFloat(surface.style.width)).toBeLessThan(before);
  });
  it('re-flows to fewer, larger covers when pinched open, holding the page still', () => {
    const { container } = renderShelf(150);
    const shelf = container.querySelector<HTMLElement>('.shelf')!;
    const surface = container.querySelector<HTMLElement>('.shelf__surface')!;
    const before = Number.parseFloat(surface.style.width);
    const at = (spread: number) => [
      { clientX: 195 - spread / 2, clientY: 400 },
      { clientX: 195 + spread / 2, clientY: 400 },
    ];
    fireEvent.touchStart(shelf, { touches: at(100) });
    const move = fireEvent.touchMove(shelf, { touches: at(220) });
    // Cancelled, so the browser neither scrolls nor zooms the page meanwhile.
    expect(move).toBe(false);
    act(() => {
      fireEvent.touchEnd(shelf, { touches: [] });
    });
    expect(Number.parseFloat(surface.style.width)).toBeLessThan(before);
  });

  it('leaves one-finger movement to the browser', () => {
    const { container } = renderShelf(150);
    const shelf = container.querySelector<HTMLElement>('.shelf')!;
    fireEvent.touchStart(shelf, { touches: [{ clientX: 100, clientY: 400 }] });
    const move = fireEvent.touchMove(shelf, { touches: [{ clientX: 100, clientY: 200 }] });
    expect(move).toBe(true);
  });

  it('makes the page as tall as the wall, so it scrolls natively', () => {
    const { container } = renderShelf(150);
    const shelf = container.querySelector<HTMLElement>('.shelf')!;
    expect(Number.parseFloat(shelf.style.height)).toBeGreaterThan(VIEWPORT_HEIGHT);
  });
});
