import { useMemo, useRef, useState } from 'preact/hooks';
import { ImageExportButtons } from '../export/ImageExportButtons';
import { t } from '../i18n';
import {
  type BarSeries,
  type ChartSeries,
  categoryCount,
  isCategorical,
  type ReadoutRow,
  readoutAt,
  type StackedBarSeries,
  stepCursor,
  visibleMarks,
  type XYSeries,
} from './chartData';
import { SERIES_COLORS } from './colors';
import { meanBuckets } from './decimate';
import { formatNumber, linearScale, niceTicks, paddedDomain, stepDecimals } from './scale';
import { useContainerWidth } from './useContainerSize';
import './viz.css';

export interface ChartProps {
  /** Accessible name, visible heading and default file name. */
  readonly title: string;
  /** Series to draw. Do not mix bars with XY series. */
  readonly series: readonly ChartSeries[];
  /** Category names for `bar` and `stacked` series. */
  readonly categories?: readonly string[];
  readonly xLabel?: string;
  readonly yLabel?: string;
  /** Default: the extent of the data, or `[0, categories]`. */
  readonly xDomain?: readonly [number, number];
  /** Default: the extent of the visible data, padded. */
  readonly yDomain?: readonly [number, number];
  /** Text for an x value on the axis. Default: the number with digit grouping. */
  readonly formatX?: (x: number) => string;
  /** Text for a y value on the axis. Default: the number with just enough decimals. */
  readonly formatY?: (y: number) => string;
  /** Height in px. The width follows the container. Default 260. */
  readonly height?: number;
  /** Drag on the plot to zoom the x axis. A double click or the reset button zooms out. */
  readonly brush?: boolean;
  /** Called with the zoomed x interval, or `null` when zoom resets. */
  readonly onBrush?: (domain: readonly [number, number] | null) => void;
  /** File name (no extension) for the save buttons; `false` hides them. Default: the title. */
  readonly exportName?: string | false;
}

const MARGIN = { top: 12, right: 16, left: 58, bottom: 34 } as const;
const CHAR_WIDTH = 6.6;
const LABEL_LINE = 14;
const HEAT_BAND = 16;
let nextChartId = 1;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const colorOf = (series: ChartSeries, index: number) =>
  series.color ?? (SERIES_COLORS[index % SERIES_COLORS.length] as string);
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');

function pathOf(points: readonly (readonly [number, number])[]): string {
  let d = '';
  let pen = false;
  for (const [x, y] of points) {
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/**
 * An SVG chart: axes and ticks that follow the theme, line, area, scatter, heat-strip, bar and stacked-bar series,
 * a crosshair with a tooltip, optional brush-to-zoom, keyboard reading (left and right arrow keys, Home, End) with
 * the value announced to screen readers, and decimation that keeps the minimum and maximum of every bucket, so a
 * series of millions of points draws a few thousand marks and no extreme disappears.
 */
export function Chart(props: ChartProps) {
  const { title, series, categories = [], height = 260 } = props;
  const { ref: box, width } = useContainerWidth();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const id = useRef(nextChartId++).current;
  const [cursor, setCursor] = useState<number | null>(null);
  const [zoom, setZoom] = useState<readonly [number, number] | null>(null);
  const [brush, setBrush] = useState<readonly [number, number] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const brushStart = useRef<number | null>(null);

  const categorical = series.some(isCategorical);
  const xy = series.filter((s): s is XYSeries => !isCategorical(s));
  const bars = series.filter(isCategorical);
  const onlyHeat = xy.length > 0 && xy.every((s) => s.kind === 'heat');
  const categoryTotal = categorical ? Math.max(...bars.map(categoryCount)) : 0;

  const maxLabel = categorical ? Math.max(0, ...categories.map((c) => c.length)) : 0;
  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const bandW = categorical ? plotW / Math.max(1, categoryTotal) : 0;
  const rotated = categorical && maxLabel * CHAR_WIDTH > bandW * 0.9 && categoryTotal > 6;
  const bottom = MARGIN.bottom + (rotated ? maxLabel * CHAR_WIDTH : 0) + (props.xLabel ? LABEL_LINE : 0);
  const plotH = Math.max(40, height - MARGIN.top - bottom);

  const dataDomain = useMemo((): readonly [number, number] => {
    if (categorical) return [0, Math.max(1, categoryTotal)];
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const s of xy) {
      if (s.x.length === 0) continue;
      const offset = s.xOffset ?? 0;
      low = Math.min(low, (s.x[0] as number) + offset);
      high = Math.max(high, (s.x[s.x.length - 1] as number) + offset);
    }
    return Number.isFinite(low) ? [low, high] : [0, 1];
  }, [series, categorical, categoryTotal]);

  const xDomain = !categorical && zoom ? zoom : (props.xDomain ?? dataDomain);
  const maxMarks = clamp(Math.round(plotW * 2), 200, 4000);

  const marks = useMemo(
    () => xy.filter((s) => s.kind !== 'heat').map((s) => visibleMarks(s, xDomain[0], xDomain[1], maxMarks)),
    [series, xDomain[0], xDomain[1], maxMarks],
  );

  const yDomain = useMemo((): readonly [number, number] => {
    if (props.yDomain) return props.yDomain;
    let low = categorical ? 0 : Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const { series: s, indices } of marks) {
      for (const i of indices) {
        const v = s.y[i] as number;
        if (!Number.isFinite(v)) continue;
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
      if (s.kind === 'area') low = Math.min(low, 0);
    }
    for (const s of bars) {
      for (let i = 0; i < categoryCount(s); i++) {
        const total =
          s.kind === 'bar'
            ? (s.values[i] as number)
            : s.layers.reduce((sum, layer) => sum + (layer.values[i] as number), 0);
        high = Math.max(high, total);
        low = Math.min(low, total, 0);
      }
    }
    return Number.isFinite(low) && Number.isFinite(high)
      ? categorical
        ? [low, high * 1.05 || 1]
        : paddedDomain(low, high)
      : [0, 1];
  }, [props.yDomain, marks, series, categorical]);

  const x = linearScale(xDomain, [0, plotW]);
  const y = linearScale(yDomain, [plotH, 0]);
  const yTicks = onlyHeat ? [] : niceTicks(yDomain[0], yDomain[1], Math.max(2, Math.round(plotH / 46)));
  const yDecimals = yTicks.length > 1 ? stepDecimals((yTicks[1] as number) - (yTicks[0] as number)) : 0;
  const formatY = props.formatY ?? ((v: number) => formatNumber(v, yDecimals));
  const formatX = props.formatX ?? ((v: number) => formatNumber(v, 0));
  const xTicks = categorical ? [] : niceTicks(xDomain[0], xDomain[1], Math.max(2, Math.round(plotW / 90)));
  const labelEvery = categorical
    ? Math.max(1, Math.ceil((rotated ? LABEL_LINE : maxLabel * CHAR_WIDTH + 8) / bandW))
    : 1;

  const readout = cursor === null ? null : readoutAt(series, cursor, formatX, categories);
  const describe = (r: NonNullable<typeof readout>) =>
    `${r.header}: ${r.rows.map((row) => `${row.name} ${row.value}`).join(', ')}`;

  const pointerX = (event: PointerEvent): number | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const px = (event.clientX - rect.left) * (width / (rect.width || width)) - MARGIN.left;
    return clamp(px, 0, plotW);
  };
  const inPlot = (event: PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const py = (event.clientY - rect.top) * (height / (rect.height || height)) - MARGIN.top;
    return py >= 0 && py <= plotH;
  };

  const applyZoom = (next: readonly [number, number] | null) => {
    setZoom(next);
    props.onBrush?.(next);
  };

  const onPointerDown = (event: PointerEvent) => {
    const px = pointerX(event);
    if (!props.brush || categorical || event.button !== 0 || px === null || !inPlot(event)) return;
    brushStart.current = px;
    setBrush([px, px]);
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    const px = pointerX(event);
    if (px === null) return;
    if (brushStart.current !== null) setBrush([brushStart.current, px]);
    setCursor(inPlot(event) || brushStart.current !== null ? x.invert(px) : null);
  };

  const onPointerUp = (event: PointerEvent) => {
    const start = brushStart.current;
    brushStart.current = null;
    setBrush(null);
    const px = pointerX(event);
    if (start === null || px === null || Math.abs(px - start) < 5) return;
    applyZoom([x.invert(Math.min(start, px)), x.invert(Math.max(start, px))]);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    let next: number | null = cursor;
    if (event.key in steps)
      next = stepCursor(series, cursor, (steps[event.key] as number) * (event.shiftKey ? 10 : 1), xDomain);
    else if (event.key === 'Home') next = stepCursor(series, null, 1, xDomain);
    else if (event.key === 'End') next = stepCursor(series, null, -1, xDomain);
    else if (event.key === 'Escape' && zoom) {
      applyZoom(null);
      return;
    } else return;
    event.preventDefault();
    if (next === null) return;
    setCursor(next);
    setAnnouncement(describe(readoutAt(series, next, formatX, categories)));
  };

  const clipId = `chart-clip-${id}`;
  const hintId = `chart-hint-${id}`;
  const left = readout && cursor !== null ? MARGIN.left + x(cursor) : 0;
  const tooltipOnLeft = left > width / 2;
  const exportName = props.exportName === undefined ? slug(title) || 'chart' : props.exportName;

  return (
    <div
      class="chart"
      ref={box}
      role="application"
      aria-roledescription="chart"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is a keyboard-operable widget with arrow-key reading
      tabIndex={0}
      aria-label={title}
      aria-describedby={hintId}
      onKeyDown={onKeyDown}
      onBlur={() => setCursor(null)}
    >
      <div class="chart-head">
        <span class="chart-title">{title}</span>
        <span class="chart-tools">
          {zoom && (
            <button type="button" class="export-button" onClick={() => applyZoom(null)}>
              {t('chart.resetZoom')}
            </button>
          )}
          {exportName !== false && <ImageExportButtons name={exportName} getSvg={() => svgRef.current} />}
        </span>
      </div>
      <span id={hintId} class="visually-hidden">
        {t('chart.hint')}
      </span>
      <span class="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
      <div class="chart-plot">
        <svg
          ref={svgRef}
          class="chart-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => brushStart.current === null && setCursor(null)}
          onDblClick={() => zoom && applyZoom(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={plotW} height={plotH} />
            </clipPath>
          </defs>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {yTicks.map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick).toFixed(1)})`}>
                <line class="chart-grid" x1={0} x2={plotW} />
                <text class="chart-tick" x={-8} dy="0.32em" text-anchor="end">
                  {formatY(tick)}
                </text>
              </g>
            ))}
            <line class="chart-axis" x1={0} x2={plotW} y1={plotH} y2={plotH} />
            {!onlyHeat && <line class="chart-axis" x1={0} x2={0} y1={0} y2={plotH} />}
            {xTicks.map((tick) => (
              <g key={tick} transform={`translate(${x(tick).toFixed(1)},${plotH})`}>
                <line class="chart-axis" y2={5} />
                <text class="chart-tick" y={18} text-anchor={x(tick) > plotW - 24 ? 'end' : 'middle'}>
                  {formatX(tick)}
                </text>
              </g>
            ))}
            {categorical &&
              Array.from({ length: categoryTotal }, (_, i) => i)
                .filter((i) => i % labelEvery === 0)
                .map((i) => (
                  <text
                    key={i}
                    class="chart-tick"
                    transform={`translate(${(x(i + 0.5)).toFixed(1)},${plotH + 14})${rotated ? ' rotate(-90)' : ''}`}
                    text-anchor={rotated ? 'end' : 'middle'}
                    dy={rotated ? '0.32em' : undefined}
                    dx={rotated ? -4 : undefined}
                  >
                    {categories[i]}
                  </text>
                ))}
            {props.xLabel && (
              <text class="chart-label" x={plotW / 2} y={plotH + bottom - 8} text-anchor="middle">
                {props.xLabel}
              </text>
            )}
            {props.yLabel && (
              <text
                class="chart-label"
                transform={`translate(${-MARGIN.left + 14},${plotH / 2}) rotate(-90)`}
                text-anchor="middle"
              >
                {props.yLabel}
              </text>
            )}

            <g clip-path={`url(#${clipId})`}>
              {bars.map((s, index) => (
                <BarMarks key={s.name} series={s} index={index} count={bars.length} x={x} y={y} />
              ))}
              {xy.map((s, index) =>
                s.kind === 'heat' ? (
                  <HeatMarks
                    key={s.name}
                    series={s}
                    x={x}
                    plotW={plotW}
                    height={onlyHeat ? plotH : HEAT_BAND}
                    top={onlyHeat ? 0 : plotH - HEAT_BAND}
                  />
                ) : (
                  <XYMarks
                    key={s.name}
                    series={s}
                    indices={marks.find((m) => m.series === s)?.indices ?? new Uint32Array(0)}
                    color={colorOf(s, index)}
                    x={x}
                    y={y}
                    baseline={y(clamp(0, yDomain[0], yDomain[1]))}
                  />
                ),
              )}
            </g>

            <g data-export="skip" pointer-events="none">
              {brush && (
                <rect
                  class="chart-brush"
                  x={Math.min(...brush)}
                  y={0}
                  width={Math.abs(brush[1] - brush[0])}
                  height={plotH}
                />
              )}
              {readout && cursor !== null && (
                <>
                  <line class="chart-crosshair" x1={x(cursor)} x2={x(cursor)} y1={0} y2={plotH} />
                  {readout.rows.map((row, i) => (
                    <Marker
                      key={`${row.name}-${i}`}
                      row={row}
                      x={x}
                      y={y}
                      fallback={SERIES_COLORS[i % SERIES_COLORS.length] as string}
                    />
                  ))}
                </>
              )}
            </g>
          </g>
        </svg>
        {readout && (
          <div
            class="chart-tooltip"
            data-export="skip"
            style={{
              top: `${MARGIN.top}px`,
              ...(tooltipOnLeft ? { right: `${width - left + 12}px` } : { left: `${left + 12}px` }),
            }}
          >
            <div class="chart-tooltip-head">{readout.header}</div>
            {readout.rows.map((row, i) => (
              <div key={`${row.name}-${i}`} class="chart-tooltip-row">
                <span
                  class="chart-swatch"
                  style={{ background: row.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }}
                />
                <span>{row.name}</span>
                <b>{row.value}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface Scales {
  readonly x: ReturnType<typeof linearScale>;
  readonly y: ReturnType<typeof linearScale>;
}

function Marker({ row, x, y, fallback }: { row: ReadoutRow; fallback: string } & Scales) {
  if (!Number.isFinite(row.y)) return null;
  return (
    <circle class="chart-dot" cx={x(row.x)} cy={y(row.y)} r={3.5} style={{ stroke: row.color ?? fallback }} />
  );
}

function XYMarks({
  series,
  indices,
  color,
  x,
  y,
  baseline,
}: { series: XYSeries; indices: Uint32Array; color: string; baseline: number } & Scales) {
  const offset = series.xOffset ?? 0;
  const points = Array.from(
    indices,
    (i) => [x((series.x[i] as number) + offset), y(series.y[i] as number)] as const,
  );
  if (series.kind === 'scatter') {
    return (
      <g class="chart-scatter" style={{ fill: color }}>
        {points.map(([px, py], i) => Number.isFinite(py) && <circle key={i} cx={px} cy={py} r={2.2} />)}
      </g>
    );
  }
  const line = pathOf(points);
  if (series.kind === 'line' || points.length === 0)
    return <path class="chart-line" d={line} style={{ stroke: color }} />;
  const first = points[0] as readonly [number, number];
  const last = points[points.length - 1] as readonly [number, number];
  return (
    <g>
      <path
        class="chart-area"
        d={`${line}L${last[0].toFixed(1)} ${baseline.toFixed(1)}L${first[0].toFixed(1)} ${baseline.toFixed(1)}Z`}
        style={{ fill: color }}
      />
      <path class="chart-line" d={line} style={{ stroke: color }} />
    </g>
  );
}

function HeatMarks({
  series,
  x,
  plotW,
  height,
  top,
}: { series: XYSeries; plotW: number; height: number; top: number } & Pick<Scales, 'x'>) {
  const offset = series.xOffset ?? 0;
  const strips = useMemo(() => {
    const from = 0;
    const to = series.y.length;
    const cells = meanBuckets(series.y, from, to, Math.min(2000, Math.round(plotW)));
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const v of cells.mean) {
      if (!Number.isFinite(v)) continue;
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
    return { cells, low, high };
  }, [series, plotW]);
  const { cells, low, high } = strips;
  const span = high - low || 1;
  return (
    <g class="chart-heat" style={{ fill: series.color ?? 'var(--accent)' }}>
      {Array.from(cells.mean, (value, k) => {
        if (!Number.isFinite(value)) return null;
        const start = (series.x[cells.from[k] as number] as number) + offset;
        const next = cells.to[k] as number;
        const end =
          next < series.x.length
            ? (series.x[next] as number) + offset
            : (series.x[series.x.length - 1] as number) + offset;
        const left = x(start);
        return (
          <rect
            key={k}
            x={left}
            y={top}
            width={Math.max(1, x(end) - left + 0.5)}
            height={height}
            fill-opacity={0.08 + (0.92 * (value - low)) / span}
          />
        );
      })}
    </g>
  );
}

function BarMarks({
  series,
  index,
  count,
  x,
  y,
}: { series: BarSeries | StackedBarSeries; index: number; count: number } & Scales) {
  const band = Math.abs(x(1) - x(0));
  const width = (band * 0.8) / count;
  const left = (i: number) => x(i) + band * 0.1 + width * index;
  const zero = y(0);
  const rect = (i: number, from: number, to: number, color: string, key: string) => (
    <rect
      key={key}
      class="chart-bar"
      x={left(i)}
      y={Math.min(y(from), y(to))}
      width={Math.max(1, width)}
      height={Math.max(0, Math.abs(y(to) - y(from)))}
      style={{ fill: color }}
    />
  );
  if (series.kind === 'bar') {
    return (
      <g>
        {Array.from(series.values, (v, i) =>
          Number.isFinite(v) ? rect(i, 0, v, series.colors?.[i] ?? colorOf(series, index), `${i}`) : null,
        )}
      </g>
    );
  }
  const n = categoryCount(series);
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        let base = 0;
        return series.layers.map((layer, li) => {
          const from = base;
          base += layer.values[i] as number;
          return rect(
            i,
            from,
            base,
            layer.color ?? (SERIES_COLORS[li % SERIES_COLORS.length] as string),
            `${i}-${li}`,
          );
        });
      })}
      <line class="chart-axis" x1={0} x2={x(n)} y1={zero} y2={zero} />
    </g>
  );
}
