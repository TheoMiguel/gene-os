const TAU = Math.PI * 2;

/** Angle in radians of base position `position` on a circle of `length` bases: 0 at the top, clockwise. */
export function angleOf(position: number, length: number): number {
  return (position / length) * TAU - Math.PI / 2;
}

/** SVG path of an arc on a circle, drawn clockwise from `from` to `to`. A full turn becomes two half arcs. */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (a: number) => `${+(cx + r * Math.cos(a)).toFixed(2)} ${+(cy + r * Math.sin(a)).toFixed(2)}`;
  if (to - from >= TAU - 1e-6) {
    const mid = from + Math.PI;
    return `M${point(from)}A${r} ${r} 0 1 1 ${point(mid)}A${r} ${r} 0 1 1 ${point(from)}`;
  }
  return `M${point(from)}A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${point(to)}`;
}

/**
 * Pushes angles apart so neighbours on the circle are at least `minGap` radians away, so labels do not overlap.
 * It cuts the circle at its widest gap and moves every angle as little as possible (pool adjacent violators on
 * the angles minus their ideal spacing). Returns the new angles in the order given. When the labels cannot all
 * fit, they spread evenly.
 */
export function spreadAngles(angles: readonly number[], minGap: number): number[] {
  const n = angles.length;
  const norm = (a: number) => ((a % TAU) + TAU) % TAU;
  const order = angles.map((_, i) => i).sort((i, j) => norm(angles[i] as number) - norm(angles[j] as number));
  const sorted = order.map((i) => norm(angles[i] as number));
  if (n * minGap >= TAU) {
    const even = new Array<number>(n);
    order.forEach((original, k) => {
      even[original] = (sorted[0] as number) + (k * TAU) / n;
    });
    return even;
  }
  let widest = 0;
  let start = 0;
  for (let k = 0; k < n; k++) {
    const gap = ((sorted[(k + 1) % n] as number) - (sorted[k] as number) + TAU) % TAU || TAU;
    if (gap > widest) {
      widest = gap;
      start = (k + 1) % n;
    }
  }
  const line: number[] = [];
  for (let i = 0; i < n; i++) {
    const value = sorted[(start + i) % n] as number;
    const previous = line[i - 1];
    line.push(previous !== undefined && value < previous ? value + TAU : value);
  }
  const blocks: { sum: number; count: number }[] = [];
  line.forEach((value, i) => {
    blocks.push({ sum: value - i * minGap, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1] as { sum: number; count: number };
      const before = blocks[blocks.length - 2] as { sum: number; count: number };
      if (before.sum / before.count <= last.sum / last.count) break;
      blocks.splice(blocks.length - 2, 2, { sum: before.sum + last.sum, count: before.count + last.count });
    }
  });
  const out = new Array<number>(n);
  let i = 0;
  for (const block of blocks) {
    for (let c = 0; c < block.count; c++, i++) {
      out[order[(start + i) % n] as number] = block.sum / block.count + i * minGap;
    }
  }
  return out;
}
