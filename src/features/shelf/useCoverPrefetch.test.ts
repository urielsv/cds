import { describe, expect, it } from 'vitest';

import { packMosaic } from './layout';
import { prefetchOrder } from './useCoverPrefetch';

// A 10 × 10 even wall: index = row * 10 + column.
const wall = packMosaic(new Array<number>(100).fill(1), 10);
const at = (column: number, row: number) => row * 10 + column;
const window3x3 = { firstColumn: 3, lastColumn: 5, firstRow: 3, lastRow: 5 };

describe('prefetchOrder', () => {
  it('skips covers inside the mounted window', () => {
    const order = prefetchOrder(wall, window3x3, { columns: 2, rows: 2 });
    expect(order).not.toContain(at(4, 4));
    expect(order).not.toContain(at(3, 5));
  });

  it('includes the covers to the sides of the screen, not only above and below', () => {
    const order = prefetchOrder(wall, window3x3, { columns: 2, rows: 2 });
    expect(order).toContain(at(6, 4));
    expect(order).toContain(at(2, 4));
    expect(order).toContain(at(7, 4));
  });

  it('orders nearest first', () => {
    const order = prefetchOrder(wall, window3x3, { columns: 3, rows: 3 });
    expect(order.indexOf(at(6, 4))).toBeLessThan(order.indexOf(at(7, 4)));
    expect(order.indexOf(at(4, 6))).toBeLessThan(order.indexOf(at(4, 8)));
    // The ring immediately around the window comes before anything further.
    const firstRing = order.slice(0, 16);
    expect(firstRing).toContain(at(2, 2));
    expect(firstRing).toContain(at(6, 6));
  });

  it('stays within the ring', () => {
    const order = prefetchOrder(wall, window3x3, { columns: 1, rows: 1 });
    expect(order).toHaveLength(16);
    expect(order).not.toContain(at(8, 4));
  });

  it('finds a large block from any row it covers', () => {
    const mosaic = packMosaic([3, ...new Array<number>(40).fill(1)], 6);
    const order = prefetchOrder(
      mosaic,
      { firstColumn: 3, lastColumn: 5, firstRow: 2, lastRow: 4 },
      { columns: 1, rows: 1 },
    );
    // The 3×3 block at (0,0)-(2,2) is one column left of the window.
    expect(order).toContain(0);
  });

  it('returns nothing for an empty window', () => {
    const empty = { firstColumn: 0, lastColumn: -1, firstRow: 0, lastRow: -1 };
    expect(prefetchOrder(wall, empty, { columns: 3, rows: 3 })).toEqual([]);
  });
});
