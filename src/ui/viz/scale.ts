/** Maps a data interval to a pixel interval, and back. */
export interface LinearScale {
  (value: number): number;
  invert(pixel: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.invert = (pixel) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  return Object.assign(scale, { domain, range });
}

/** The 1, 2 or 5 times a power of ten nearest above `raw`. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

/** Decimals needed to write multiples of `step` exactly. */
export function stepDecimals(step: number): number {
  return Math.min(10, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}

/** About `target` evenly spaced round values inside `[low, high]`. */
export function niceTicks(low: number, high: number, target = 6): number[] {
  if (!(high > low) || !Number.isFinite(low) || !Number.isFinite(high))
    return Number.isFinite(low) ? [low] : [];
  const step = niceStep((high - low) / Math.max(1, target));
  const decimals = stepDecimals(step);
  const ticks: number[] = [];
  const first = Math.ceil(low / step - 1e-9);
  const last = Math.floor(high / step + 1e-9);
  for (let i = first; i <= last; i++) ticks.push(Number((i * step).toFixed(decimals)));
  return ticks;
}

/** `[low, high]` widened by `pad` of its span, or a unit-wide interval around a single value. */
export function paddedDomain(low: number, high: number, pad = 0.05): [number, number] {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [0, 1];
  if (low === high) return [low - 0.5, high + 0.5];
  const margin = (high - low) * pad;
  return [low - margin, high + margin];
}

/** A number with a fixed count of decimals and the reader's digit grouping. */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
