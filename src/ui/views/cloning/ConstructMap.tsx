import { useRef } from 'preact/hooks';
import type { Construct } from '../../../engine/cloning';
import type { Feature } from '../../../engine/types';
import { ImageExportButtons } from '../../export';
import { t } from '../../i18n';
import { featureColor } from '../../viz';
import { angleOf, arcPath, spreadAngles } from './mapGeometry';

const SIZE = 520;
const CENTER = SIZE / 2;
const RADIUS = 150;
const RING = 14;
const MAX_FEATURE_LABELS = 12;
const LABEL_GAP = 0.13;

const spanOf = (f: Feature) => f.location.segments.reduce((sum, s) => sum + (s.end - s.start), 0);

/**
 * A plain circular map of a construct: the ring, its features as coloured arcs (a feature that crosses the origin
 * is two arcs), the largest feature names outside, and each junction as a tick with its name inside. This is a
 * simple stand-in: the Sequence view's plasmid map is not part of this branch.
 */
export function ConstructMap({ construct, name }: { readonly construct: Construct; readonly name: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { record } = construct;
  const length = record.seq.length;
  const drawn = record.features.filter((f) => f.type !== 'primer_bind');
  const labelled = [...drawn].sort((a, b) => spanOf(b) - spanOf(a)).slice(0, MAX_FEATURE_LABELS);
  const midOf = (f: Feature) => {
    const first = f.location.segments[0];
    const last = f.location.segments[f.location.segments.length - 1];
    if (!first || !last) return 0;
    const wraps = f.location.segments.length > 1 && last.end === length && first.start === 0;
    const start = wraps ? last.start : first.start;
    const end = wraps ? length + first.end : last.end;
    return ((start + end) / 2) % length;
  };
  const featureAngles = spreadAngles(
    labelled.map((f) => angleOf(midOf(f), length)),
    LABEL_GAP,
  );
  const junctionAngles = spreadAngles(
    construct.junctions.map((j) => angleOf(j.position + j.length / 2, length)),
    LABEL_GAP * 1.6,
  );

  return (
    <div class="clone-map">
      <svg
        ref={svgRef}
        class="clone-map-svg"
        role="img"
        aria-label={t('clone.map.label', { name, length: length.toLocaleString() })}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
      >
        <circle cx={CENTER} cy={CENTER} r={RADIUS} class="clone-map-ring" />
        {drawn.flatMap((feature) =>
          feature.location.segments.map((segment, i) => (
            <path
              key={`${feature.id}:${i}`}
              d={arcPath(
                CENTER,
                CENTER,
                RADIUS,
                angleOf(segment.start, length),
                angleOf(segment.end, length),
              )}
              class="clone-map-feature"
              stroke={featureColor(feature)}
              stroke-width={RING}
            >
              <title>{`${feature.name} (${segment.start + 1}-${segment.end})`}</title>
            </path>
          )),
        )}
        {labelled.map((feature, i) => {
          const angle = featureAngles[i] as number;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const inner = RADIUS + RING / 2 + 2;
          const outer = RADIUS + 34;
          return (
            <g key={feature.id} class="clone-map-label">
              <line
                x1={CENTER + inner * cos}
                y1={CENTER + inner * sin}
                x2={CENTER + outer * cos}
                y2={CENTER + outer * sin}
              />
              <text
                x={CENTER + (outer + 4) * cos}
                y={CENTER + (outer + 4) * sin + 4}
                text-anchor={cos >= 0 ? 'start' : 'end'}
              >
                {feature.name}
              </text>
            </g>
          );
        })}
        {construct.junctions.map((junction, i) => {
          const at = angleOf(junction.position + junction.length / 2, length);
          const shown = junctionAngles[i] as number;
          const cos = Math.cos(shown);
          const sin = Math.sin(shown);
          const cosAt = Math.cos(at);
          const sinAt = Math.sin(at);
          return (
            <g key={`${junction.label}:${junction.position}`} class="clone-map-junction">
              <line
                x1={CENTER + (RADIUS - 12) * cosAt}
                y1={CENTER + (RADIUS - 12) * sinAt}
                x2={CENTER + (RADIUS + 12) * cosAt}
                y2={CENTER + (RADIUS + 12) * sinAt}
              />
              <line
                class="clone-map-leader"
                x1={CENTER + (RADIUS - 12) * cosAt}
                y1={CENTER + (RADIUS - 12) * sinAt}
                x2={CENTER + (RADIUS - 34) * cos}
                y2={CENTER + (RADIUS - 34) * sin}
              />
              <text
                x={CENTER + (RADIUS - 38) * cos}
                y={CENTER + (RADIUS - 38) * sin + 4}
                text-anchor={cos >= 0 ? 'end' : 'start'}
              >
                {junction.label}
              </text>
            </g>
          );
        })}
        <text x={CENTER} y={CENTER - 4} text-anchor="middle" class="clone-map-title">
          {name}
        </text>
        <text x={CENTER} y={CENTER + 16} text-anchor="middle" class="clone-map-sub">
          {t('doc.length', { length: length.toLocaleString() })}
        </text>
      </svg>
      <ImageExportButtons name="construct-map" getSvg={() => svgRef.current} />
    </div>
  );
}
