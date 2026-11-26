// biome-ignore-all lint/a11y/useSemanticElements: a band is a shape inside an SVG picture, which a <button> cannot be
import type { Ref } from 'preact';
import { useId, useMemo, useState } from 'preact/hooks';
import { type GelBand, type Ladder, simulateGel } from '../../../engine/gel';
import { t } from '../../i18n';
import { bandBrightness, bandThickness, formatBp, jitter } from './gelModel';
import './gel.css';

/** One sample lane of the gel: fragment sizes in bp, the species equimolar. */
export interface GelLaneInput {
  readonly id: string;
  readonly label: string;
  readonly sizes: readonly number[];
}

/** The band the rest of the view has selected: a lane and one fragment size in it. */
export interface GelSelection {
  readonly lane: string;
  readonly size: number;
}

export interface GelFigureProps {
  readonly lanes: readonly GelLaneInput[];
  readonly ladder: Ladder;
  readonly agarose: number;
  readonly selected: GelSelection | null;
  /** Called when a band of a sample lane is clicked, with the fragment sizes that run in it. */
  readonly onSelect?: (lane: string, sizes: readonly number[]) => void;
  readonly svgRef?: Ref<SVGSVGElement>;
}

const LEFT = 78;
const PITCH = 92;
const RIGHT = 44;
const HEIGHT = 410;
const SLAB_TOP = 50;
const WELL_TOP = 58;
const WELL_HEIGHT = 9;
const MIGRATION_START = 72;
const MIGRATION_LENGTH = 304;
const BAND_WIDTH = 50;
const LABEL_GAP = 11;
/** How far, in px, the outer lanes run behind the middle ones: real gels "smile". */
const SMILE = 5;

interface Hover {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

const centerOf = (index: number) => LEFT + PITCH * (index + 0.5);
const yOf = (position: number) => MIGRATION_START + position * MIGRATION_LENGTH;

function laneName(label: string): string {
  return label.length > 13 ? `${label.slice(0, 12)}…` : label;
}

function bandText(band: GelBand): string {
  const sizes = [...band.sizes].sort((a, b) => b - a);
  return sizes.length > 1
    ? t('gel.bandMerged', { sizes: sizes.map((bp) => Math.round(bp).toLocaleString('en-US')).join(' + ') })
    : formatBp(sizes[0] ?? 0);
}

/**
 * The virtual agarose gel as one SVG picture styled like a gel photograph: a dark slab with wells, one lane for
 * the ladder and one for each sample, bands that glow in proportion to their DNA mass, grain and a vignette.
 * Band positions come from the engine's migration model; fragments that run together are drawn as one band.
 */
export function GelFigure({ lanes, ladder, agarose, selected, onSelect, svgRef }: GelFigureProps) {
  const uid = useId();
  const [hover, setHover] = useState<Hover | null>(null);
  const simulated = useMemo(
    () =>
      simulateGel(
        [{ label: ladder.name, ladder }, ...lanes.map((lane) => ({ label: lane.label, sizes: lane.sizes }))],
        agarose,
      ),
    [lanes, ladder, agarose],
  );
  const count = simulated.length;
  const width = LEFT + PITCH * count + RIGHT;
  const smileAt = (index: number) => {
    const middle = (count - 1) / 2;
    const offset = middle === 0 ? 0 : (index - middle) / middle;
    return SMILE * offset * offset;
  };
  const id = (name: string) => `${uid}-${name}`;
  const ref = (name: string) => `url(#${id(name)})`;

  const lanesSvg = simulated.map((lane, laneIndex) => {
    const isLadder = laneIndex === 0;
    const input = isLadder ? undefined : lanes[laneIndex - 1];
    const cx = centerOf(laneIndex);
    const smile = smileAt(laneIndex);
    let lastLabelY = Number.NEGATIVE_INFINITY;
    const bands = lane.bands.map((band, bandIndex) => {
      const thickness = bandThickness(band.intensity);
      const brightness = bandBrightness(band.intensity);
      const bandWidth = BAND_WIDTH * (0.93 + 0.1 * jitter(laneIndex, bandIndex));
      const tilt = (jitter(bandIndex, laneIndex + 7) - 0.5) * 1.6;
      const cy = yOf(band.position) + smile;
      const sizes = [...band.sizes].sort((a, b) => b - a);
      const label =
        sizes.length > 1
          ? `${Math.round(sizes[0] ?? 0).toLocaleString('en-US')}+`
          : Math.round(sizes[0] ?? 0).toLocaleString('en-US');
      const showLabel = cy - lastLabelY >= LABEL_GAP;
      if (showLabel) lastLabelY = cy;
      const isSelected =
        input !== undefined && selected?.lane === input.id && band.sizes.some((bp) => bp === selected.size);
      const text = isLadder
        ? t('gel.ladderBand', { size: formatBp(band.sizes[0] ?? 0), mass: band.massNg.toFixed(0) })
        : bandText(band);
      const hit = (
        <rect
          class="gel-hit"
          x={cx - BAND_WIDTH / 2 - 4}
          y={cy - Math.max(thickness, 14) / 2 - 2}
          width={BAND_WIDTH + 8}
          height={Math.max(thickness, 14) + 4}
          fill="transparent"
        />
      );
      return (
        <g key={`${laneIndex}-${band.position}`}>
          <g transform={`rotate(${tilt} ${cx} ${cy})`} class="gel-band-art">
            <rect
              x={cx - bandWidth / 2 - 4}
              y={cy - thickness / 2 - 5}
              width={bandWidth + 8}
              height={thickness + 10}
              rx={(thickness + 10) / 2}
              fill="#ff9a45"
              opacity={0.42 * brightness}
              filter={ref('blur-wide')}
            />
            <rect
              x={cx - bandWidth / 2}
              y={cy - thickness / 2}
              width={bandWidth}
              height={thickness}
              rx={Math.min(2.5, thickness / 2)}
              fill={ref('band')}
              opacity={brightness}
              filter={ref('blur-soft')}
            />
            <rect
              x={cx - bandWidth / 2 + 5}
              y={cy - thickness * 0.2}
              width={bandWidth - 10}
              height={thickness * 0.4}
              fill="#fff6e4"
              opacity={0.78 * brightness}
              filter={ref('blur-core')}
            />
          </g>
          {isSelected && (
            <rect
              class="gel-selected"
              data-export="skip"
              x={cx - BAND_WIDTH / 2 - 5}
              y={cy - thickness / 2 - 5}
              width={BAND_WIDTH + 10}
              height={thickness + 10}
              rx="3"
              fill="none"
            />
          )}
          {isLadder ? (
            <g
              onPointerEnter={() => setHover({ x: cx, y: cy - thickness / 2 - 6, text })}
              onPointerLeave={() => setHover(null)}
            >
              {hit}
            </g>
          ) : (
            <g
              class="gel-band"
              role="button"
              tabIndex={0}
              aria-label={`${lane.label}: ${text}`}
              aria-pressed={isSelected}
              onPointerEnter={() => setHover({ x: cx, y: cy - thickness / 2 - 6, text })}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover({ x: cx, y: cy - thickness / 2 - 6, text })}
              onBlur={() => setHover(null)}
              onClick={() => input && onSelect?.(input.id, band.sizes)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                if (input) onSelect?.(input.id, band.sizes);
              }}
            >
              {hit}
            </g>
          )}
          {showLabel &&
            (isLadder ? (
              <text class="gel-size" x={LEFT - 6} y={cy + 3.2} text-anchor="end">
                {label}
              </text>
            ) : (
              <text class="gel-size" x={cx + BAND_WIDTH / 2 + 6} y={cy + 3.2}>
                {label}
              </text>
            ))}
        </g>
      );
    });
    return (
      <g key={laneIndex}>
        <text class="gel-lane-label" x={cx} y={SLAB_TOP - 8} text-anchor="middle">
          {isLadder ? t('gel.laneLadder') : laneName(lane.label)}
          <title>{isLadder ? ladder.name : lane.label}</title>
        </text>
        <rect
          x={cx - PITCH / 2 + 8}
          y={MIGRATION_START - 6}
          width={PITCH - 16}
          height={MIGRATION_LENGTH + 14}
          fill="#ff9a45"
          opacity="0.035"
          filter={ref('blur-wide')}
        />
        <rect class="gel-well" x={cx - 29} y={WELL_TOP} width="58" height={WELL_HEIGHT} rx="1.5" />
        <rect class="gel-well-rim" x={cx - 29} y={WELL_TOP - 1.5} width="58" height="1.5" />
        {bands}
      </g>
    );
  });

  const caption = `${ladder.vendor} ${ladder.name}`;
  const tipWidth = hover ? hover.text.length * 6.4 + 14 : 0;
  const tipX = hover ? Math.min(Math.max(hover.x - tipWidth / 2, 4), width - tipWidth - 4) : 0;
  const tipY = hover ? (hover.y < SLAB_TOP + 24 ? hover.y + 30 : hover.y - 22) : 0;

  return (
    <svg
      {...(svgRef ? { ref: svgRef } : {})}
      class="gel-svg"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      style={{ maxWidth: `${width * 1.7}px` }}
      role="img"
      aria-label={t('gel.alt', { lanes: count, ladder: ladder.name, percent: agarose.toFixed(1) })}
    >
      <defs>
        <radialGradient id={id('photo')} cx="50%" cy="46%" r="75%">
          <stop offset="0" stop-color="#0d1a22" />
          <stop offset="0.7" stop-color="#050b10" />
          <stop offset="1" stop-color="#010305" />
        </radialGradient>
        <linearGradient id={id('slab')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#14262f" />
          <stop offset="0.35" stop-color="#0f1f27" />
          <stop offset="1" stop-color="#0a161d" />
        </linearGradient>
        <linearGradient id={id('band')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffb674" stop-opacity="0.55" />
          <stop offset="0.5" stop-color="#ffd9ac" />
          <stop offset="1" stop-color="#ffb674" stop-opacity="0.55" />
        </linearGradient>
        <filter id={id('blur-wide')} x="-30%" y="-200%" width="160%" height="500%">
          <feGaussianBlur stdDeviation="4.2" />
        </filter>
        <filter id={id('blur-soft')} x="-10%" y="-100%" width="120%" height="300%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
        <filter id={id('blur-core')} x="-10%" y="-150%" width="120%" height="400%">
          <feGaussianBlur stdDeviation="0.55" />
        </filter>
        <filter id={id('grain')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0.75  0 0 0 0 0.85  0 0 0 0 0.9  0 0 0 0.9 -0.34"
          />
        </filter>
        <radialGradient id={id('vignette')} cx="50%" cy="50%" r="72%">
          <stop offset="0.55" stop-color="#000" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity="0.65" />
        </radialGradient>
      </defs>
      <rect width={width} height={HEIGHT} fill={ref('photo')} />
      <rect
        x="10"
        y={SLAB_TOP}
        width={width - 20}
        height={HEIGHT - SLAB_TOP - 12}
        rx="5"
        fill={ref('slab')}
        stroke="#22363f"
        stroke-width="1"
      />
      <text class="gel-caption" x="16" y="16">
        {caption}
      </text>
      <text class="gel-caption" x="16" y="30">
        {t('gel.agaroseCaption', { percent: agarose.toFixed(1) })}
      </text>
      {lanesSvg}
      <rect
        x="10"
        y={SLAB_TOP}
        width={width - 20}
        height={HEIGHT - SLAB_TOP - 12}
        rx="5"
        filter={ref('grain')}
        opacity="0.16"
        pointer-events="none"
      />
      <rect width={width} height={HEIGHT} fill={ref('vignette')} pointer-events="none" />
      {hover && (
        <g data-export="skip" pointer-events="none">
          <rect class="gel-tip" x={tipX} y={tipY} width={tipWidth} height="19" rx="2" />
          <text class="gel-tip-text" x={tipX + tipWidth / 2} y={tipY + 13} text-anchor="middle">
            {hover.text}
          </text>
        </g>
      )}
    </svg>
  );
}
