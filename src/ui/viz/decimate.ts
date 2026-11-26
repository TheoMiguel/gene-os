/** First index whose `values[i] + offset` is at least `target`, in an ascending array. `length` when none is. */
export function lowerBound(values: ArrayLike<number>, target: number, offset = 0): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((values[mid] as number) + offset < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Index whose `values[i] + offset` is closest to `target`, in an ascending array. -1 for an empty array. */
export function nearestIndex(values: ArrayLike<number>, target: number, offset = 0): number {
  if (values.length === 0) return -1;
  const after = lowerBound(values, target, offset);
  if (after === 0) return 0;
  if (after === values.length) return values.length - 1;
  const before = after - 1;
  return target - ((values[before] as number) + offset) <= (values[after] as number) + offset - target
    ? before
    : after;
}

/**
 * Indices to draw for `values[from, to)` with at most `maxPoints` marks. The range is cut into equal buckets and
 * each bucket keeps the index of its minimum and of its maximum (one index when they coincide), in ascending order,
 * so a spike or a dip never disappears. A range that already fits comes back whole. Non-finite values are skipped.
 */
export function minMaxIndices(
  values: ArrayLike<number>,
  from: number,
  to: number,
  maxPoints: number,
): Uint32Array {
  const count = Math.max(0, to - from);
  if (count <= maxPoints) return Uint32Array.from({ length: count }, (_, i) => from + i);

  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const kept = new Uint32Array(buckets * 2);
  let used = 0;
  for (let k = 0; k < buckets; k++) {
    const start = from + Math.floor((k * count) / buckets);
    const end = from + Math.floor(((k + 1) * count) / buckets);
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    let lowAt = -1;
    let highAt = -1;
    for (let i = start; i < end; i++) {
      const v = values[i] as number;
      if (v < low) {
        low = v;
        lowAt = i;
      }
      if (v > high) {
        high = v;
        highAt = i;
      }
    }
    if (lowAt < 0) continue;
    if (lowAt === highAt) kept[used++] = lowAt;
    else {
      kept[used++] = Math.min(lowAt, highAt);
      kept[used++] = Math.max(lowAt, highAt);
    }
  }
  return kept.subarray(0, used);
}

export interface MeanBuckets {
  /** First index of each bucket. */
  readonly from: Uint32Array;
  /** One past the last index of each bucket. */
  readonly to: Uint32Array;
  readonly mean: Float64Array;
}

/** `values[from, to)` cut into at most `maxBuckets` equal buckets, each with its mean. For heat strips. */
export function meanBuckets(
  values: ArrayLike<number>,
  from: number,
  to: number,
  maxBuckets: number,
): MeanBuckets {
  const count = Math.max(0, to - from);
  const buckets = Math.min(count, Math.max(1, maxBuckets));
  const starts = new Uint32Array(buckets);
  const ends = new Uint32Array(buckets);
  const mean = new Float64Array(buckets);
  for (let k = 0; k < buckets; k++) {
    const start = from + Math.floor((k * count) / buckets);
    const end = from + Math.floor(((k + 1) * count) / buckets);
    let sum = 0;
    let n = 0;
    for (let i = start; i < end; i++) {
      const v = values[i] as number;
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    starts[k] = start;
    ends[k] = end;
    mean[k] = n === 0 ? Number.NaN : sum / n;
  }
  return { from: starts, to: ends, mean };
}
