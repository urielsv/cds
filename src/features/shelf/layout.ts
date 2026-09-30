/**
 * How covers are placed on the wall.
 *
 * Two arrangements share one representation, a square block of unit cells per
 * album:
 *
 * - **Even** — every cover one cell. A plain grid.
 * - **By rating** — the albums you rate highest occupy 2×2 or 3×3 cells, and
 *   the rest fill in around them. Ragged and editorial rather than uniform,
 *   but still gapless and still on the same cell lattice, so the camera,
 *   snapping and windowing are unchanged.
 *
 * Pure: no DOM, no React. `packMosaic` is deterministic, so the same collection
 * in the same order always produces the same wall.
 */

export type WallMode = 'even' | 'rating';

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
 * Cells per side for a rating. Five stars is three cells — nine times the area
 * of an unrated album — which is enough to read as a deliberate feature wall
 * rather than an accident. Two and three stars stay small on purpose: this is
 * the owner's favourites made large, not a uniform gradient.
 */
export function spanForRating(rating: number | null | undefined): number {
  if (rating === 5) return 3;
  if (rating === 4) return 2;
  return 1;
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

/** The spans a collection occupies in the requested arrangement. */
export function spansFor(
  ratings: readonly (number | null | undefined)[],
  mode: WallMode,
): number[] {
  return mode === 'rating' ? ratings.map(spanForRating) : ratings.map(() => 1);
}

/**
 * Places a collection on the wall in the requested arrangement, `columns`
 * covers across. The column count comes from the zoom: the wall always spans
 * the screen width, so zooming re-flows it rather than panning it sideways.
 */
export function wallPlacement(
  ratings: readonly (number | null | undefined)[],
  mode: WallMode,
  columns: number,
): WallPlacement {
  return packMosaic(spansFor(ratings, mode), columns);
}

/**
 * Rows the wall needs at a given column count, memoised per count. Asked for
 * every candidate zoom level when deciding how far the wall may zoom out, so
 * the rating mosaic is packed once per count, not once per question.
 */
export function rowCounter(spans: readonly number[], mode: WallMode): (columns: number) => number {
  const cache = new Map<number, number>();
  return (columns) => {
    let rows = cache.get(columns);
    if (rows === undefined) {
      rows =
        mode === 'even'
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
