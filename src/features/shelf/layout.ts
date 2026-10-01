/**
 * How covers are placed on the wall.
 *
 * Every album is a square block of unit cells. Today every cover is one cell —
 * a plain, even grid — but the packer still accepts larger blocks, so the
 * camera, snapping and windowing work on the general representation and would
 * not need to change if covers of different sizes ever return.
 *
 * Pure: no DOM, no React. `packMosaic` is deterministic, so the same collection
 * in the same order always produces the same wall.
 */

export interface Placement {
  column: number;
  row: number;
  /** Width and height in cells. */
  span: number;
}

export interface WallPlacement {
  /** Indexed by position in the (sorted) collection. */
  placements: Placement[];
  columns: number;
  rows: number;
  /** Placements starting or continuing on each row, for windowing. */
  byRow: number[][];
}

/**
 * First-fit packing on a cell lattice.
 *
 * Walks the collection in order and drops each album into the first position
 * where its square fits, scanning left to right, top to bottom. Large blocks
 * therefore leave holes that later single covers fall into, which is what keeps
 * the wall gapless without any second pass. Order is still respected in the
 * large: a cover never lands above a row that was already full.
 */
export function packMosaic(spans: readonly number[], columns: number): WallPlacement {
  const width = Math.max(1, columns);
  const placements: Placement[] = [];
  const byRow: number[][] = [];

  /** Occupancy, row-major, grown a row at a time. */
  const occupied: boolean[][] = [];
  const rowAt = (row: number): boolean[] => {
    while (occupied.length <= row) occupied.push(new Array<boolean>(width).fill(false));
    while (byRow.length <= row) byRow.push([]);
    return occupied[row] ?? [];
  };

  /** No cover is ever placed above this row; it only moves forward. */
  let firstOpenRow = 0;

  const fits = (row: number, column: number, span: number): boolean => {
    if (column + span > width) return false;
    for (let r = row; r < row + span; r += 1) {
      const cells = rowAt(r);
      for (let c = column; c < column + span; c += 1) {
        if (cells[c]) return false;
      }
    }
    return true;
  };

  spans.forEach((rawSpan, index) => {
    // A block can never be wider than the wall.
    const span = Math.max(1, Math.min(Math.round(rawSpan), width));

    let placed: Placement | null = null;
    for (let row = firstOpenRow; placed === null; row += 1) {
      for (let column = 0; column + span <= width; column += 1) {
        if (!fits(row, column, span)) continue;
        placed = { row, column, span };
        break;
      }
    }

    for (let r = placed.row; r < placed.row + placed.span; r += 1) {
      const cells = rowAt(r);
      for (let c = placed.column; c < placed.column + placed.span; c += 1) cells[c] = true;
      byRow[r]?.push(index);
    }
    placements[index] = placed;

    // Advance past any rows that are now completely full, so the next search
    // does not rescan them. This is what keeps packing linear in practice.
    while (firstOpenRow < occupied.length && (occupied[firstOpenRow] ?? []).every(Boolean)) {
      firstOpenRow += 1;
    }
  });

  return { placements, columns: width, rows: Math.max(1, occupied.length), byRow };
}

/** The spans a collection of `count` covers occupies: one cell each. */
export function spansFor(count: number): number[] {
  return new Array<number>(count).fill(1);
}

/**
 * Places a collection of `count` covers on the wall, `columns` across. The
 * column count comes from the zoom: the wall always spans the screen width, so
 * zooming re-flows it rather than panning it sideways.
 */
export function wallPlacement(count: number, columns: number): WallPlacement {
  return packMosaic(spansFor(count), columns);
}

/**
 * Rows the wall needs at a given column count, memoised per count. Asked for
 * every candidate zoom level when deciding how far the wall may zoom out, so
 * any mosaic is packed once per count, not once per question.
 */
export function rowCounter(spans: readonly number[]): (columns: number) => number {
  // All single cells is a plain grid, whose height is arithmetic; only a mosaic
  // of mixed sizes needs to be packed to know it.
  const even = spans.every((span) => span === 1);
  const cache = new Map<number, number>();
  return (columns) => {
    let rows = cache.get(columns);
    if (rows === undefined) {
      rows = even
        ? Math.max(1, Math.ceil(spans.length / Math.max(1, columns)))
        : packMosaic(spans, columns).rows;
      cache.set(columns, rows);
    }
    return rows;
  };
}

/** Index of the cover occupying a cell, or null for an empty cell. */
export function indexAt(wall: WallPlacement, column: number, row: number): number | null {
  for (const index of wall.byRow[row] ?? []) {
    const p = wall.placements[index];
    if (p && column >= p.column && column < p.column + p.span) return index;
  }
  return null;
}
