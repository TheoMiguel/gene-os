import { lowerBound, minMaxIndices, nearestIndex } from './decimate';

interface SeriesBase {
  readonly name: string;
  /** Any CSS color. Absent means the next theme color. */
  readonly color?: string;
  /** Text for a value in the tooltip. Default: four significant digits. */
  readonly format?: (value: number) => string;
}

/** A line, filled area, scatter or heat strip over a numeric x axis. `x` must ascend and match `y` in length. */
export interface XYSeries extends SeriesBase {
  readonly kind: 'line' | 'area' | 'scatter' | 'heat';
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  /** Added to every x, so a window series can plot at window centers without a second array. */
  readonly xOffset?: number;
  /** Text for the x position of point `index` in the tooltip. Default: the x value. */
  readonly describe?: (index: number) => string;
}

/** One bar per category. `colors` overrides the series color bar by bar. */
export interface BarSeries extends SeriesBase {
  readonly kind: 'bar';
  readonly values: ArrayLike<number>;
  readonly colors?: readonly string[];
  readonly describe?: (index: number) => string;
}

/** Bars split in layers that stack from zero. Layer values are not negative. */
export interface StackedBarSeries extends SeriesBase {
  readonly kind: 'stacked';
  readonly layers: readonly {
    readonly name: string;
    readonly values: ArrayLike<number>;
    readonly color?: string;
  }[];
  readonly describe?: (index: number) => string;
}

export type ChartSeries = XYSeries | BarSeries | StackedBarSeries;

export const isCategorical = (series: ChartSeries): series is BarSeries | StackedBarSeries =>
  series.kind === 'bar' || series.kind === 'stacked';

export function categoryCount(series: BarSeries | StackedBarSeries): number {
  return series.kind === 'bar' ? series.values.length : (series.layers[0]?.values.length ?? 0);
}

export interface ReadoutRow {
  readonly name: string;
  readonly color: string | undefined;
  readonly value: string;
  /** Data coordinate the value sits at, for the marker on the plot. */
  readonly x: number;
  readonly y: number;
}

export interface Readout {
  readonly header: string;
  readonly rows: readonly ReadoutRow[];
}

const defaultFormat = (value: number) => value.toLocaleString(undefined, { maximumSignificantDigits: 4 });

/** The values of every series at x coordinate `x`: the nearest point of each XY series, or the bar under `x`. */
export function readoutAt(
  series: readonly ChartSeries[],
  x: number,
  formatX: (x: number) => string,
  categories: readonly string[] = [],
): Readout {
  const rows: ReadoutRow[] = [];
  let header = formatX(x);
  let headerSet = false;
  const setHeader = (text: string) => {
    if (!headerSet) header = text;
    headerSet = true;
  };

  for (const s of series) {
    const format = s.format ?? defaultFormat;
    if (s.kind === 'bar' || s.kind === 'stacked') {
      const index = Math.min(Math.max(Math.floor(x), 0), Math.max(0, categoryCount(s) - 1));
      setHeader(s.describe?.(index) ?? categories[index] ?? String(index + 1));
      if (s.kind === 'bar') {
        const value = s.values[index] as number;
        rows.push({
          name: s.name,
          color: s.colors?.[index] ?? s.color,
          value: format(value),
          x: index + 0.5,
          y: value,
        });
      } else {
        let total = 0;
        for (const layer of s.layers) {
          const value = layer.values[index] as number;
          total += value;
          rows.push({ name: layer.name, color: layer.color, value: format(value), x: index + 0.5, y: total });
        }
      }
      continue;
    }
    const offset = s.xOffset ?? 0;
    const index = nearestIndex(s.x, x, offset);
    if (index < 0) continue;
    setHeader(s.describe?.(index) ?? formatX((s.x[index] as number) + offset));
    const value = s.y[index] as number;
    rows.push({
      name: s.name,
      color: s.color,
      value: Number.isFinite(value) ? format(value) : '–',
      x: (s.x[index] as number) + offset,
      y: value,
    });
  }
  return { header, rows };
}

/** The x coordinate a keyboard cursor moves to: `delta` points (or categories) from `x`, clamped to `[low, high]`. */
export function stepCursor(
  series: readonly ChartSeries[],
  x: number | null,
  delta: number,
  [low, high]: readonly [number, number],
): number | null {
  const first = series[0];
  if (!first) return null;
  if (isCategorical(first)) {
    const last = categoryCount(first) - 1;
    const from = x === null ? (delta > 0 ? -1 : last + 1) : Math.floor(x);
    return Math.min(Math.max(from + delta, 0), last) + 0.5;
  }
  const offset = first.xOffset ?? 0;
  const lo = lowerBound(first.x, low, offset);
  let hi = lowerBound(first.x, high, offset);
  if (hi >= first.x.length || (first.x[hi] as number) + offset > high) hi--;
  if (hi < lo) return null;
  const from = x === null ? (delta > 0 ? lo - 1 : hi + 1) : nearestIndex(first.x, x, offset);
  const index = Math.min(Math.max(from + delta, lo), hi);
  return (first.x[index] as number) + offset;
}

export interface VisibleMarks {
  readonly series: XYSeries;
  /** Indices of `series` to draw, extremes of every bucket kept. */
  readonly indices: Uint32Array;
}

/** The marks of an XY series inside `[low, high]`, one point of margin on each side, at most `maxMarks`. */
export function visibleMarks(series: XYSeries, low: number, high: number, maxMarks: number): VisibleMarks {
  const offset = series.xOffset ?? 0;
  const from = Math.max(0, lowerBound(series.x, low, offset) - 1);
  const to = Math.min(series.x.length, lowerBound(series.x, high, offset) + 1);
  return { series, indices: minMaxIndices(series.y, from, to, maxMarks) };
}
