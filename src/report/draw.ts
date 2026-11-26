import { LOGO } from '../ui/logo';
import { formatNumber, linearScale, niceTicks, paddedDomain } from '../ui/viz/scale';
import { type PdfPage, type Rgb, rgb } from './pdf';

/** Print colours: dark ink on white, with one blue and one orange that stay apart in grey and for colour-blind readers. */
export const PALETTE = {
  ink: rgb('#1b2733'),
  muted: rgb('#5b6b7a'),
  rule: rgb('#c9d2da'),
  zebra: rgb('#f2f5f7'),
  accent: rgb('#0e8a76'),
  a: rgb('#1f6fb2'),
  b: rgb('#d9822b'),
  mismatch: rgb('#f6c4be'),
  similar: rgb('#fbe5b0'),
  gap: rgb('#d9dfe4'),
  white: rgb('#ffffff'),
} as const;

const arcPoints = (cx: number, cy: number, radius: number, from: number, to: number, steps = 48) =>
  Array.from({ length: steps + 1 }, (_, i): [number, number] => {
    const angle = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });

const quadratic = (p0: [number, number], p1: [number, number], p2: [number, number], steps = 16) =>
  Array.from({ length: steps + 1 }, (_, i): [number, number] => {
    const t = i / steps;
    const u = 1 - t;
    return [
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ];
  });

/**
 * The GENE_OS mark in vector form: the "G" ring and crossbar around a double helix. The numbers follow `LOGO` in
 * `ui/logo.ts`, whose ring and strand paths use arcs and smooth curves that a PDF path cannot take verbatim.
 */
export function drawMark(page: PdfPage, x: number, y: number, size: number, ring: Rgb, helix: Rgb): void {
  const k = size / 64;
  const at = (points: readonly (readonly [number, number])[]): [number, number][] =>
    points.map(([px, py]) => [x + px * k, y + py * k]);
  page.polyline(at([...arcPoints(32, 32, 24, -45, -360), [39, 32]]), {
    color: ring,
    width: LOGO.ringWidth * k,
  });
  const strand = (side: number) => [
    ...quadratic([25, 17], [25 + 14 * side, 24.5], [25, 32]),
    ...quadratic([25, 32], [25 - 14 * side, 39.5], [25, 47]),
  ];
  for (const side of [1, -1])
    page.polyline(at(strand(side)), { color: helix, width: LOGO.strandWidth * k, cap: 'round' });
  for (const { y: py, half } of LOGO.pairs)
    page.line(x + (LOGO.axisX - half) * k, y + py * k, x + (LOGO.axisX + half) * k, y + py * k, {
      color: helix,
      width: LOGO.pairWidth * k,
    });
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LineSeries {
  readonly name: string;
  readonly color: Rgb;
  readonly x: readonly number[];
  readonly y: readonly number[];
}

export interface LineChartSpec {
  readonly title: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly series: readonly LineSeries[];
  readonly xDomain: readonly [number, number];
  /** Text for a y tick. */
  readonly formatY: (value: number) => string;
  readonly locale?: string;
}

const AXIS = { left: 44, right: 10, top: 32, bottom: 34 } as const;

/** A line chart with ticks, grid, axis labels and a legend, drawn as vector paths inside `box`. */
export function drawLineChart(page: PdfPage, box: Box, spec: LineChartSpec): void {
  const plot = {
    x: box.x + AXIS.left,
    y: box.y + AXIS.top,
    width: box.width - AXIS.left - AXIS.right,
    height: box.height - AXIS.top - AXIS.bottom,
  };
  const values = spec.series.flatMap((s) => s.y.filter(Number.isFinite));
  const [low, high] = paddedDomain(
    Math.min(...values, Number.POSITIVE_INFINITY),
    Math.max(...values, Number.NEGATIVE_INFINITY),
  );
  const yTicks = niceTicks(low, high, 5);
  const yScale = linearScale([low, high], [plot.y + plot.height, plot.y]);
  const xScale = linearScale(spec.xDomain, [plot.x, plot.x + plot.width]);

  page.text(box.x, box.y + 10, spec.title, { font: 'bold', size: 9.5, color: PALETTE.ink });
  let legendX = box.x + box.width;
  for (const series of [...spec.series].reverse()) {
    legendX -=
      8 + page.text(legendX, box.y + 10, series.name, { size: 8, color: PALETTE.muted, align: 'end' });
    page.line(legendX - 14, box.y + 7.5, legendX - 4, box.y + 7.5, { color: series.color, width: 2 });
    legendX -= 24;
  }

  for (const tick of yTicks) {
    const y = yScale(tick);
    page.line(plot.x, y, plot.x + plot.width, y, { color: PALETTE.rule, width: 0.4, dash: [2, 2] });
    page.text(plot.x - 4, y + 2.8, spec.formatY(tick), { size: 7.5, color: PALETTE.muted, align: 'end' });
  }
  for (const tick of niceTicks(spec.xDomain[0], spec.xDomain[1], 6)) {
    const x = xScale(tick);
    page.line(x, plot.y + plot.height, x, plot.y + plot.height + 3, { color: PALETTE.muted, width: 0.6 });
    page.text(x, plot.y + plot.height + 12, formatNumber(tick), {
      size: 7.5,
      color: PALETTE.muted,
      align: 'middle',
    });
  }
  page.line(plot.x, plot.y, plot.x, plot.y + plot.height, { color: PALETTE.muted, width: 0.8 });
  page.line(plot.x, plot.y + plot.height, plot.x + plot.width, plot.y + plot.height, {
    color: PALETTE.muted,
    width: 0.8,
  });
  page.text(plot.x + plot.width / 2, box.y + box.height - 4, spec.xLabel, {
    size: 8,
    color: PALETTE.muted,
    align: 'middle',
  });
  page.text(box.x, plot.y - 6, spec.yLabel, { size: 8, color: PALETTE.muted });

  for (const series of spec.series)
    page.polyline(
      series.x.map((x, i): [number, number] => [xScale(x), yScale(series.y[i] as number)]),
      { color: series.color, width: 1.3 },
    );
}

export interface BarGroup {
  readonly label: string;
  readonly values: readonly number[];
}

export interface BarChartSpec {
  readonly title: string;
  readonly yLabel: string;
  readonly groups: readonly BarGroup[];
  readonly series: readonly { readonly name: string; readonly color: Rgb }[];
  readonly formatY: (value: number) => string;
}

/** A grouped bar chart: one bar per series inside each group, from zero up. */
export function drawBarChart(page: PdfPage, box: Box, spec: BarChartSpec): void {
  const plot = {
    x: box.x + AXIS.left,
    y: box.y + AXIS.top,
    width: box.width - AXIS.left - AXIS.right,
    height: box.height - AXIS.top - AXIS.bottom,
  };
  const top = Math.max(...spec.groups.flatMap((g) => g.values), 0);
  const ceiling = top > 0 ? top * 1.05 : 1;
  const ticks = niceTicks(0, ceiling, 5);
  const yScale = linearScale([0, ceiling], [plot.y + plot.height, plot.y]);

  page.text(box.x, box.y + 10, spec.title, { font: 'bold', size: 9.5, color: PALETTE.ink });
  let legendX = box.x + box.width;
  for (const series of [...spec.series].reverse()) {
    legendX -=
      page.text(legendX, box.y + 10, series.name, { size: 8, color: PALETTE.muted, align: 'end' }) + 4;
    page.rect(legendX - 9, box.y + 3.5, 8, 8, { fill: series.color });
    legendX -= 20;
  }
  for (const tick of ticks) {
    const y = yScale(tick);
    page.line(plot.x, y, plot.x + plot.width, y, { color: PALETTE.rule, width: 0.4, dash: [2, 2] });
    page.text(plot.x - 4, y + 2.8, spec.formatY(tick), { size: 7.5, color: PALETTE.muted, align: 'end' });
  }
  page.line(plot.x, plot.y + plot.height, plot.x + plot.width, plot.y + plot.height, {
    color: PALETTE.muted,
    width: 0.8,
  });
  page.text(box.x, plot.y - 6, spec.yLabel, { size: 8, color: PALETTE.muted });

  const band = plot.width / Math.max(1, spec.groups.length);
  const barWidth = Math.min(26, (band * 0.7) / Math.max(1, spec.series.length));
  spec.groups.forEach((group, g) => {
    const start = plot.x + band * g + (band - barWidth * spec.series.length) / 2;
    group.values.forEach((value, s) => {
      const y = yScale(value);
      page.rect(start + barWidth * s, y, barWidth - 1, plot.y + plot.height - y, {
        fill: spec.series[s]?.color ?? PALETTE.muted,
      });
    });
    page.text(plot.x + band * (g + 0.5), plot.y + plot.height + 12, group.label, {
      size: 8,
      color: PALETTE.muted,
      align: 'middle',
    });
  });
}
