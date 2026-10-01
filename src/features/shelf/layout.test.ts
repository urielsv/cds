import { describe, expect, it } from 'vitest';

import { indexAt, packMosaic, rowCounter, spansFor, wallPlacement } from './layout';

/** Marks every cell a placement covers, so overlaps and holes are visible. */
function grid(spans: number[], columns: number) {
  const { placements, rows } = packMosaic(spans, columns);
  const cells: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  placements.forEach((placement) => {
    for (let r = placement.row; r < placement.row + placement.span; r += 1) {
      const row = cells[r];
      if (!row) continue;
      for (let c = placement.column; c < placement.column + placement.span; c += 1) {
        row[c] = (row[c] ?? 0) + 1;
      }
    }
  });
  return { cells, placements, rows };
}

describe('packMosaic', () => {
  it('lays an even wall out as a plain grid', () => {
    const { placements } = packMosaic(new Array<number>(12).fill(1), 4);
    expect(placements[0]).toEqual({ column: 0, row: 0, span: 1 });
    expect(placements[4]).toEqual({ column: 0, row: 1, span: 1 });
    expect(placements[11]).toEqual({ column: 3, row: 2, span: 1 });
  });

  it('never overlaps two covers', () => {
    const spans = Array.from({ length: 200 }, (_, i) => (i % 7 === 0 ? 3 : i % 3 === 0 ? 2 : 1));
    const { cells } = grid(spans, 9);
    for (const row of cells) {
      for (const count of row) expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('fills the holes a large block leaves, so the wall stays gapless', () => {
    const spans = Array.from({ length: 200 }, (_, i) => (i % 7 === 0 ? 3 : i % 3 === 0 ? 2 : 1));
    const { cells, rows } = grid(spans, 9);
    // Every row but the last few should be completely covered.
    const full = cells.slice(0, rows - 3).filter((row) => row.every((count) => count === 1));
    expect(full.length).toBe(Math.max(0, rows - 3));
  });

  it('keeps blocks inside the wall', () => {
    const { placements } = packMosaic([3, 1, 2, 1, 1, 3], 4);
    for (const placement of placements) {
      expect(placement.column + placement.span).toBeLessThanOrEqual(4);
      expect(placement.column).toBeGreaterThanOrEqual(0);
    }
  });

  it('shrinks a block that cannot fit the wall at all', () => {
    const { placements } = packMosaic([3, 1], 2);
    expect(placements[0]?.span).toBe(2);
  });

  it('roughly respects the order it is given', () => {
    const { placements } = packMosaic(new Array<number>(40).fill(1), 5);
    const rows = placements.map((p) => p.row);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!).toBeGreaterThanOrEqual(rows[i - 1]!);
    }
  });

  it('indexes placements by every row they occupy, for windowing', () => {
    const { byRow } = packMosaic([3, 1, 1, 1], 4);
    expect(byRow[0]).toContain(0);
    expect(byRow[1]).toContain(0);
    expect(byRow[2]).toContain(0);
  });

  it('is deterministic', () => {
    const spans = [1, 3, 1, 2, 1, 1, 2, 1];
    expect(packMosaic(spans, 5)).toEqual(packMosaic(spans, 5));
  });

  it('handles an empty collection', () => {
    expect(packMosaic([], 4)).toMatchObject({ placements: [], rows: 1 });
  });
});

describe('wallPlacement', () => {
  it('lays every cover out as a single cell', () => {
    const wall = wallPlacement(60, 5);
    expect(wall.placements).toHaveLength(60);
    expect(wall.placements.every((p) => p.span === 1)).toBe(true);
    expect(wall.rows).toBe(12);
  });

  it('is exactly as many columns wide as asked, so it spans the screen', () => {
    for (const columns of [2, 4, 5, 8]) {
      expect(wallPlacement(60, columns).columns).toBe(columns);
    }
  });
});

describe('rowCounter', () => {
  it('counts the rows of an even grid', () => {
    const rows = rowCounter(spansFor(10));
    expect(rows(4)).toBe(3);
    expect(rows(5)).toBe(2);
  });

  it('packs a mosaic of mixed sizes to count its rows', () => {
    const spans = [3, 1, 1, 1];
    expect(rowCounter(spans)(4)).toBe(packMosaic(spans, 4).rows);
  });
});

describe('indexAt', () => {
  const wall = packMosaic([3, 1, 1, 1, 1], 4);

  it('finds a block from any of its cells', () => {
    expect(indexAt(wall, 0, 0)).toBe(0);
    expect(indexAt(wall, 2, 2)).toBe(0);
    expect(indexAt(wall, 3, 1)).toBe(2);
  });

  it('returns null for an empty cell', () => {
    expect(indexAt(wall, 3, 3)).toBeNull();
  });
});
