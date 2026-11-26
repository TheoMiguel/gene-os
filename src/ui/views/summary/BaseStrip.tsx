import { useRef } from 'preact/hooks';
import type { Alphabet } from '../../../engine/types';
import type { Language } from '../../../state/settings';
import { ImageExportButtons } from '../../export/ImageExportButtons';
import { t } from '../../i18n';
import { useContainerWidth } from '../../viz/useContainerSize';
import { type CompositionRow, formatInt, formatPercent, OTHER_LETTER, stripSegments } from './model';

const STRIP_HEIGHT = 18;
const LEGEND_TOP = STRIP_HEIGHT + 20;
const LEGEND_ROW = 18;
const LEGEND_ITEM = 200;

const BASE_CLASS: Readonly<Record<string, string>> = {
  A: 'base-a',
  C: 'base-c',
  G: 'base-g',
  T: 'base-t',
  U: 'base-t',
};

/**
 * The original's base-composition strip: one horizontal bar split by base, with a legend of counts and shares.
 * It is an SVG, so it saves as SVG and PNG with the legend in the file.
 */
export function BaseStrip({
  rows,
  alphabet,
  language,
}: {
  readonly rows: readonly CompositionRow[];
  readonly alphabet: Alphabet;
  readonly language: Language;
}) {
  const { ref, width } = useContainerWidth();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const segments = stripSegments(rows);
  const label = (row: CompositionRow) =>
    row.letter === OTHER_LETTER ? t('summary.strip.other') : row.letter;
  const parts = rows.map((row) => `${label(row)} ${formatPercent(row.fraction, language)}`).join(', ');
  const perRow = Math.max(1, Math.floor(width / LEGEND_ITEM));
  const height = LEGEND_TOP + Math.ceil(rows.length / perRow) * LEGEND_ROW - 6;

  return (
    <div class="base-strip-box" ref={ref}>
      <svg
        ref={svgRef}
        class="base-strip"
        width={width}
        height={height}
        role="img"
        aria-label={t('summary.strip.label', { parts })}
      >
        <title>{t('summary.strip.title')}</title>
        <rect class="base-strip-track" x={0} y={0} width={width} height={STRIP_HEIGHT} />
        {segments.map((segment) =>
          segment.fraction > 0 ? (
            <rect
              key={segment.letter}
              class={BASE_CLASS[segment.letter] ?? 'base-other'}
              x={segment.offset * width}
              y={0}
              width={Math.max(0.5, segment.fraction * width)}
              height={STRIP_HEIGHT}
            />
          ) : null,
        )}
        {rows.map((row, index) => (
          <g
            key={row.letter}
            transform={`translate(${(index % perRow) * LEGEND_ITEM} ${LEGEND_TOP + Math.floor(index / perRow) * LEGEND_ROW})`}
          >
            <rect class={BASE_CLASS[row.letter] ?? 'base-other'} x={0} y={-9} width={10} height={10} />
            <text class="base-strip-text" x={16} y={0}>
              {`${label(row)}: ${formatInt(row.count, language)} (${formatPercent(row.fraction, language)})`}
            </text>
          </g>
        ))}
      </svg>
      <ImageExportButtons
        name={alphabet === 'protein' ? 'residue-composition' : 'base-composition'}
        getSvg={() => svgRef.current}
      />
    </div>
  );
}
