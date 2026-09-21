import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateFixtureCollection } from '@/dev/fixtureCollection';

import { Shelf } from './Shelf';

/**
 * jsdom gives every element a zero size, so a virtualiser mounts nothing by
 * default. These tests fake a phone-sized viewport so the grid actually produces
 * cells — otherwise the virtualisation, which is the entire point of the shelf,
 * would never be exercised.
 */
const VIEWPORT_WIDTH = 390; // iPhone-ish
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

describe('Shelf', () => {
  beforeEach(stubViewport);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts tiles for a realistic collection', () => {
    const collection = generateFixtureCollection(150);
    render(<Shelf discs={collection.discs} onOpen={vi.fn()} openDiscId={null} />);

    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('mounts only a fraction of the collection, not all of it', () => {
    const collection = generateFixtureCollection(400);
    render(<Shelf discs={collection.discs} onOpen={vi.fn()} openDiscId={null} />);

    // The whole point of virtualising: frame cost must not scale with collection
    // size. If this ever equals 400, virtualisation has silently broken.
    const mounted = screen.getAllByRole('button').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(120);
  });

  it('mounts a similar number of tiles at 150 and 400 discs', () => {
    const small = render(
      <Shelf discs={generateFixtureCollection(150).discs} onOpen={vi.fn()} openDiscId={null} />,
    );
    const smallCount = small.container.querySelectorAll('.disc-tile').length;
    small.unmount();

    const large = render(
      <Shelf discs={generateFixtureCollection(400).discs} onOpen={vi.fn()} openDiscId={null} />,
    );
    const largeCount = large.container.querySelectorAll('.disc-tile').length;

    // Both are bounded by the viewport, so they should be in the same ballpark.
    expect(Math.abs(largeCount - smallCount)).toBeLessThan(smallCount);
  });

  it('positions cells with a transform rather than layout properties', () => {
    const collection = generateFixtureCollection(150);
    const { container } = render(
      <Shelf discs={collection.discs} onOpen={vi.fn()} openDiscId={null} />,
    );

    const cell = container.querySelector<HTMLElement>('.shelf__cell');
    expect(cell).not.toBeNull();
    // translate3d keeps positioning on the compositor. `top`/`left` here would
    // force layout on every scroll frame.
    expect(cell?.style.transform).toMatch(/translate3d\(/);
  });

  it('renders an empty shelf without crashing', () => {
    const { container } = render(<Shelf discs={[]} onOpen={vi.fn()} openDiscId={null} />);
    expect(container.querySelector('.shelf')).not.toBeNull();
    expect(container.querySelectorAll('.disc-tile')).toHaveLength(0);
  });
});
