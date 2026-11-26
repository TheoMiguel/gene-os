// biome-ignore-all lint/a11y/useSemanticElements: the map is one focusable widget that draws SVG, which no native element can host
// biome-ignore-all lint/a11y/useKeyWithClickEvents: keyboard operation lives on the focusable frame: left and right arrow keys step through the ORFs
import { useMemo, useRef, useState } from 'preact/hooks';
import type { Feature } from '../../../engine/types';
import { ImageExportButtons } from '../../export/ImageExportButtons';
import { t } from '../../i18n';
import { featureColor, formatNumber, linearScale, niceTicks } from '../../viz';
import { useContainerWidth } from '../../viz/useContainerSize';
import { frameLabel, type OrfRow } from './orfRows';

const FRAME_ORDER = [1, 2, 3, -1, -2, -3] as const;
const LANE_HEIGHT = 14;
const LANE_GAP = 3;
const AXIS_BAND = 30;
const MARGIN = { top: 6, right: 12, bottom: 6, left: 34 } as const;
const MIN_WIDTH = 2;

const laneTop = (frame: (typeof FRAME_ORDER)[number]): number => {
  const index = FRAME_ORDER.indexOf(frame);
  const below = index >= 3 ? AXIS_BAND : 0;
  return MARGIN.top + index * (LANE_HEIGHT + LANE_GAP) + below;
};
const axisTop = MARGIN.top + 3 * (LANE_HEIGHT + LANE_GAP);
const HEIGHT = MARGIN.top + 6 * (LANE_HEIGHT + LANE_GAP) + AXIS_BAND + MARGIN.bottom;

interface OrfMapProps {
  readonly rows: readonly OrfRow[];
  readonly seqLength: number;
  /** Annotated features, drawn as a thin strip on the axis in their usual colors. */
  readonly features: readonly Feature[];
  readonly selected: OrfRow | null;
  readonly onSelect: (row: OrfRow) => void;
  /** File name (no extension) for the image buttons. */
  readonly exportName: string;
}

/**
 * The sequence as a horizontal axis with the six reading frames around it: the three forward frames above, the
 * three reverse frames below. Each ORF is a bar in its frame; a click, or the left and right arrow keys,
 * selects. Features of the record sit on the axis, colored as everywhere else in the app.
 */
export function OrfMap({ rows, seqLength, features, selected, onSelect, exportName }: OrfMapProps) {
  const { ref, width } = useContainerWidth();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<OrfRow | null>(null);
  const plotWidth = Math.max(40, width - MARGIN.left - MARGIN.right);
  const x = linearScale([0, Math.max(1, seqLength)], [MARGIN.left, MARGIN.left + plotWidth]);

  const bars = useMemo(
    () =>
      rows.flatMap((row, index) =>
        row.orf.location.segments.map((segment) => (
          <rect
            key={`${row.id}:${segment.start}`}
            class="pv-orf"
            data-index={index}
            x={x(segment.start)}
            y={laneTop(row.frame)}
            width={Math.max(MIN_WIDTH, x(segment.end) - x(segment.start))}
            height={LANE_HEIGHT}
          />
        )),
      ),
    [rows, width, seqLength],
  );

  const featureBars = useMemo(
    () =>
      features.flatMap((feature) =>
        feature.location.segments.map((segment) => (
          <rect
            key={`${feature.id}:${segment.start}`}
            class="pv-feature"
            x={x(segment.start)}
            y={axisTop + 4}
            width={Math.max(MIN_WIDTH, x(segment.end) - x(segment.start))}
            height={6}
            style={{ fill: featureColor(feature) }}
          />
        )),
      ),
    [features, width, seqLength],
  );

  const ticks = niceTicks(0, seqLength, Math.max(2, Math.round(plotWidth / 110)));
  const rowAt = (target: EventTarget | null): OrfRow | null => {
    const index = (target as SVGElement | null)?.dataset?.index;
    return index === undefined ? null : (rows[Number(index)] ?? null);
  };

  const step = (delta: number) => {
    if (rows.length === 0) return;
    const current = selected ? rows.indexOf(selected) : delta > 0 ? -1 : rows.length;
    const next = Math.min(Math.max(current + delta, 0), rows.length - 1);
    const row = rows[next];
    if (row) onSelect(row);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
    else return;
    event.preventDefault();
  };

  const shown = hover ?? selected;
  return (
    <div class="pv-map">
      <div class="pv-map-head">
        <span class="field-label">{t('proteins.map.title')}</span>
        <ImageExportButtons name={exportName} getSvg={() => svgRef.current} />
      </div>
      <div
        ref={ref}
        class="pv-map-frame"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the frame takes focus so the arrow keys can step through ORFs
        tabIndex={0}
        role="group"
        aria-label={t('proteins.map.label', { count: rows.length })}
        aria-describedby="pv-map-hint"
        onKeyDown={onKeyDown}
      >
        <svg
          ref={svgRef}
          class="pv-map-svg"
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={t('proteins.map.title')}
          onClick={(event) => {
            const row = rowAt(event.target);
            if (row) onSelect(row);
          }}
          onPointerOver={(event) => setHover(rowAt(event.target))}
          onPointerLeave={() => setHover(null)}
        >
          {FRAME_ORDER.map((frame) => (
            <g key={frame}>
              <text
                class="pv-lane-label"
                x={MARGIN.left - 6}
                y={laneTop(frame) + LANE_HEIGHT - 3}
                text-anchor="end"
              >
                {frameLabel(frame)}
              </text>
              <line
                class="pv-lane-line"
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={laneTop(frame) + LANE_HEIGHT / 2}
                y2={laneTop(frame) + LANE_HEIGHT / 2}
              />
            </g>
          ))}
          <line
            class="pv-axis"
            x1={MARGIN.left}
            x2={MARGIN.left + plotWidth}
            y1={axisTop + 7}
            y2={axisTop + 7}
          />
          {featureBars}
          {ticks.map((tick) => (
            <g key={tick}>
              <line class="pv-tick" x1={x(tick)} x2={x(tick)} y1={axisTop + 12} y2={axisTop + 16} />
              <text class="pv-tick-label" x={x(tick)} y={axisTop + 27} text-anchor="middle">
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          {bars}
          {selected?.orf.location.segments.map((segment) => (
            <rect
              key={`sel:${segment.start}`}
              class="pv-orf-selected"
              x={x(segment.start) - 1}
              y={laneTop(selected.frame) - 1}
              width={Math.max(MIN_WIDTH, x(segment.end) - x(segment.start)) + 2}
              height={LANE_HEIGHT + 2}
            />
          ))}
        </svg>
      </div>
      <p class="pv-map-readout" id="pv-map-hint" aria-live="polite">
        {shown
          ? t('proteins.map.readout', {
              id: shown.id,
              frame: frameLabel(shown.frame),
              start: shown.start.toLocaleString(),
              end: shown.end.toLocaleString(),
              aa: shown.lengthAa.toLocaleString(),
            })
          : t('proteins.map.hint')}
      </p>
    </div>
  );
}
