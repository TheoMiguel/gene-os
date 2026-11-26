/**
 * Label spreading for maps: one-dimensional collision resolution, and greedy row packing.
 * Pure functions, so the placement rules are tested without a browser.
 */

/**
 * Centers for labels of height `size` that never overlap, stay inside `[min, max]` and keep their input order
 * by desired position. The result is the least-squares closest layout to `desired`: a label nobody crowds stays
 * exactly where it was asked. When the labels cannot all fit, the spacing shrinks so they still do not overlap.
 * `result[i]` belongs to `desired[i]`.
 */
export function spreadLabels(desired: readonly number[], size: number, min: number, max: number): number[] {
  const count = desired.length;
  if (count === 0) return [];
  const step = count > 1 ? Math.min(size, (max - min) / count) : size;
  const low = min + step / 2;
  const high = max - step / 2;
  const order = desired
    .map((_, index) => index)
    .sort((a, b) => (desired[a] as number) - (desired[b] as number));

  // With y[k] = u[k] + k * step, "no overlap" becomes "u never decreases": isotonic regression by pooling blocks.
  const blocks: { sum: number; count: number }[] = [];
  order.forEach((index, rank) => {
    blocks.push({ sum: (desired[index] as number) - rank * step, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1] as { sum: number; count: number };
      const before = blocks[blocks.length - 2] as { sum: number; count: number };
      if (before.sum / before.count <= last.sum / last.count) break;
      blocks.splice(blocks.length - 2, 2, { sum: before.sum + last.sum, count: before.count + last.count });
    }
  });

  const result = new Array<number>(count);
  const room = high - low - (count - 1) * step;
  let rank = 0;
  for (const block of blocks) {
    const level = Math.min(Math.max(block.sum / block.count, low), low + Math.max(0, room));
    for (let i = 0; i < block.count; i++, rank++) result[order[rank] as number] = level + rank * step;
  }
  return result;
}

export interface Extent {
  readonly start: number;
  readonly end: number;
  /** Higher goes first, so it gets the row nearest the anchor and is the last to be dropped. Default 0. */
  readonly priority?: number;
}

/**
 * Greedy first-fit rows for horizontal labels, most important first: an item goes in the first row where it clears
 * every item already there by `gap`. Items that need a row at or beyond `maxRows` get -1.
 * `result[i]` belongs to `items[i]`.
 */
export function packRows(
  items: readonly Extent[],
  gap: number,
  maxRows = Number.POSITIVE_INFINITY,
): number[] {
  const order = items
    .map((_, index) => index)
    .sort(
      (a, b) =>
        ((items[b] as Extent).priority ?? 0) - ((items[a] as Extent).priority ?? 0) ||
        (items[a] as Extent).start - (items[b] as Extent).start,
    );
  const rows: Extent[][] = [];
  const result = new Array<number>(items.length).fill(-1);
  for (const index of order) {
    const item = items[index] as Extent;
    const fits = (row: readonly Extent[]) =>
      row.every((other) => item.start >= other.end + gap || item.end + gap <= other.start);
    let row = rows.findIndex(fits);
    if (row < 0 && rows.length < maxRows) {
      row = rows.length;
      rows.push([]);
    }
    if (row < 0) continue;
    (rows[row] as Extent[]).push(item);
    result[index] = row;
  }
  return result;
}

export interface LaneInterval {
  /** 0-based start on the molecule. */
  readonly start: number;
  /** Exclusive end. Above `length` means the interval crosses the origin and ends at `end - length`. */
  readonly end: number;
}

/**
 * Lanes (0, 1, 2...) for intervals on a molecule of `length` bases so that two intervals in one lane are at
 * least `gap` bases apart. An interval across the origin is one interval and blocks both ends of its lane.
 * `result.lanes[i]` belongs to `intervals[i]`.
 */
export function assignLanes(
  intervals: readonly LaneInterval[],
  length: number,
  gap: number,
): { lanes: number[]; count: number } {
  const lanes = new Array<number>(intervals.length).fill(0);
  const state: { lastEnd: number; wrapStart: number; wrapEnd: number }[] = [];
  const wrapped: number[] = [];
  const plain: number[] = [];
  intervals.forEach((interval, index) => {
    (interval.end > length ? wrapped : plain).push(index);
  });

  // Every interval across the origin contains position 0, so each needs a lane of its own.
  for (const index of wrapped) {
    const interval = intervals[index] as LaneInterval;
    lanes[index] = state.length;
    state.push({
      lastEnd: Number.NEGATIVE_INFINITY,
      wrapStart: interval.start,
      wrapEnd: interval.end - length,
    });
  }

  plain.sort((a, b) => (intervals[a] as LaneInterval).start - (intervals[b] as LaneInterval).start);
  for (const index of plain) {
    const { start, end } = intervals[index] as LaneInterval;
    let lane = state.findIndex(
      (candidate) =>
        start >= candidate.lastEnd + gap &&
        (candidate.wrapEnd === 0 || start >= candidate.wrapEnd + gap) &&
        end + gap <= candidate.wrapStart,
    );
    if (lane < 0) {
      lane = state.length;
      state.push({ lastEnd: Number.NEGATIVE_INFINITY, wrapStart: Number.POSITIVE_INFINITY, wrapEnd: 0 });
    }
    (state[lane] as { lastEnd: number }).lastEnd = end;
    lanes[index] = lane;
  }
  return { lanes, count: state.length };
}
