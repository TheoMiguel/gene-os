import { featureItem, type MapItem, siteItem } from './mapItems';
import type { MapFeature, MapFeatures, MapSite } from './mapModel';
import { fitText, formatBp, LABEL_HEIGHT, niceStep, textWidth } from './mapText';
import { spreadLabels } from './packing';

const TAU = Math.PI * 2;
const MAX_LABEL_WIDTH = 132;
const ELBOW_GAP = 8;
const COLUMN_GAP = 14;
const TOP_MARGIN = 26;
/** Below this width an enzyme label drops its position, which the tooltip and the list still give. */
const COMPACT_LABEL_WIDTH = 480;
const HEAD_PX = 9;
const MIN_ARC_PX = 1.5;

/** Angle of base boundary `position` on a circle of `length` bases: 0 at the top, clockwise, in SVG radians. */
export function angleOf(position: number, length: number): number {
  return (position / length) * TAU - Math.PI / 2;
}

const point = (cx: number, cy: number, radius: number, angle: number): [number, number] => [
  cx + radius * Math.cos(angle),
  cy + radius * Math.sin(angle),
];

const fmt = (n: number) => n.toFixed(1);
const at = (p: readonly [number, number]) => `${fmt(p[0])} ${fmt(p[1])}`;

/**
 * Path of an annular sector from `from` to `to` (radians, clockwise) between two radii. The end the strand points to
 * becomes an arrowhead `head` radians long. `strand` 0 draws a plain sector.
 */
export function sectorPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  from: number,
  to: number,
  strand: 1 | -1 | 0,
  head: number,
): string {
  const end = Math.min(to, from + TAU - 0.002);
  const sweep = end - from;
  const tip = Math.min(head, sweep);
  const middle = (inner + outer) / 2;
  const arcFlag = (angle: number) => (angle > Math.PI ? 1 : 0);
  if (strand === -1) {
    const start = from + tip;
    return [
      `M${at(point(cx, cy, outer, start))}`,
      `A${fmt(outer)} ${fmt(outer)} 0 ${arcFlag(end - start)} 1 ${at(point(cx, cy, outer, end))}`,
      `L${at(point(cx, cy, inner, end))}`,
      `A${fmt(inner)} ${fmt(inner)} 0 ${arcFlag(end - start)} 0 ${at(point(cx, cy, inner, start))}`,
      `L${at(point(cx, cy, middle, from))}Z`,
    ].join('');
  }
  const stop = strand === 1 ? end - tip : end;
  return [
    `M${at(point(cx, cy, outer, from))}`,
    `A${fmt(outer)} ${fmt(outer)} 0 ${arcFlag(stop - from)} 1 ${at(point(cx, cy, outer, stop))}`,
    strand === 1
      ? `L${at(point(cx, cy, middle, end))}L${at(point(cx, cy, inner, stop))}`
      : `L${at(point(cx, cy, inner, stop))}`,
    `A${fmt(inner)} ${fmt(inner)} 0 ${arcFlag(stop - from)} 0 ${at(point(cx, cy, inner, from))}Z`,
  ].join('');
}

/** Path of a plain circular arc line, for the selection band and window marks. */
export function arcLine(cx: number, cy: number, radius: number, from: number, to: number): string {
  const end = Math.min(to, from + TAU - 0.002);
  return `M${at(point(cx, cy, radius, from))}A${fmt(radius)} ${fmt(radius)} 0 ${end - from > Math.PI ? 1 : 0} 1 ${at(point(cx, cy, radius, end))}`;
}

export interface SceneArc {
  readonly id: string;
  readonly kind: 'feature' | 'primer';
  readonly d: string;
  readonly color: string;
}

export interface SceneTick {
  readonly id: string;
  readonly enzyme: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Angle of the site, for the highlight that is drawn over it. */
  readonly angle: number;
}

export interface SceneLabel {
  readonly key: string;
  /** Element the label names, for hover and click. */
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'end';
  readonly leader: string;
  readonly kind: 'feature' | 'primer' | 'site';
  readonly color?: string;
}

export interface ScaleTick {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly label: string | null;
  readonly lx: number;
  readonly ly: number;
}

export interface CircularScene {
  readonly width: number;
  readonly height: number;
  readonly cx: number;
  readonly cy: number;
  /** Radius of the backbone. */
  readonly radius: number;
  /** Radius of the scale ring. */
  readonly scaleRadius: number;
  /** Largest radius the center text may use. */
  readonly innerRadius: number;
  readonly arcs: readonly SceneArc[];
  readonly ticks: readonly SceneTick[];
  readonly scale: readonly ScaleTick[];
  readonly labels: readonly SceneLabel[];
  readonly items: ReadonlyMap<string, MapItem>;
  /** Sites that are not drawn because of the tick limit. */
  readonly hiddenSites: number;
  /** Radii of the bands for one feature lane and one primer lane, to redraw an element as a highlight. */
  readonly bands: {
    readonly feature: (lane: number) => readonly [number, number];
    readonly primer: (lane: number) => readonly [number, number];
  };
}

export interface CircularInput {
  readonly length: number;
  readonly features: MapFeatures;
  readonly primers: MapFeatures;
  readonly sites: readonly MapSite[];
  /** Cuts left out of `sites` because of the tick limit, for a note under the map. */
  readonly hiddenSites: number;
  /** Recognition sequence per enzyme, for the tooltip. */
  readonly recognition: ReadonlyMap<string, string>;
  /** Enzymes the user picked: always labelled. */
  readonly picked: ReadonlySet<string>;
  readonly width: number;
  readonly height: number;
}

interface Candidate {
  readonly key: string;
  readonly id: string;
  readonly text: string;
  readonly angle: number;
  /** Lane of a feature or primer, which decides where its leader line starts. */
  readonly lane: number;
  readonly priority: number;
  readonly kind: 'feature' | 'primer' | 'site';
  readonly color?: string;
}

function spanOf(feature: MapFeature): number {
  return feature.pieces.reduce((sum, piece) => sum + piece.end - piece.start, 0);
}

function labelAngle(feature: MapFeature, length: number): number {
  const longest = feature.pieces.reduce((best, piece) =>
    piece.end - piece.start > best.end - best.start ? piece : best,
  );
  return angleOf((longest.start + longest.end) / 2, length);
}

/**
 * Everything the circular map draws, in px for a `width` by `height` area: feature and primer arcs in lanes, the scale
 * ring, restriction ticks and the labels. Labels sit in two columns that follow the outline of the circle, never
 * overlap, and join their element by a leader line. When a column is full, labels of the lowest priority are left out;
 * their elements keep their tooltips.
 */
export function buildCircularScene(input: CircularInput): CircularScene {
  const { length, width, height } = input;
  const cx = width / 2;
  const cy = height / 2;
  const items = new Map<string, MapItem>();
  const compact = width < COMPACT_LABEL_WIDTH;

  const tickSites = input.sites;
  const candidates: Candidate[] = [];
  for (const feature of input.features.features) {
    const item = featureItem(feature, length, 'feature');
    items.set(item.id, item);
    candidates.push({
      key: item.id,
      id: item.id,
      text: feature.name,
      angle: labelAngle(feature, length),
      lane: feature.lane,
      priority: 60 + Math.min(9, Math.log10(Math.max(10, spanOf(feature)))),
      kind: 'feature',
      color: feature.color,
    });
  }
  for (const feature of input.primers.features) {
    const item = featureItem(feature, length, 'primer');
    items.set(item.id, item);
    candidates.push({
      key: item.id,
      id: item.id,
      text: feature.name,
      angle: labelAngle(feature, length),
      lane: feature.lane,
      priority: 40,
      kind: 'primer',
      color: feature.color,
    });
  }
  for (const site of tickSites) {
    const item = siteItem(site, input.recognition.get(site.enzyme) ?? '', length);
    items.set(item.id, item);
    const priority = input.picked.has(site.enzyme)
      ? 90
      : site.count === 1
        ? 60
        : 20 - Math.min(10, site.count);
    candidates.push({
      key: item.id,
      id: item.id,
      text: compact ? site.enzyme : `${site.enzyme} (${site.cut.toLocaleString()})`,
      angle: angleOf(site.boundary, length),
      lane: 0,
      priority,
      kind: 'site',
    });
  }

  const labelWidth = Math.min(
    MAX_LABEL_WIDTH,
    candidates.reduce((max, c) => Math.max(max, textWidth(c.text)), 0),
  );
  const outerLimit = Math.max(
    70,
    Math.min(width / 2 - labelWidth - COLUMN_GAP - 8, height / 2 - TOP_MARGIN - 12),
  );

  const hasTicks = tickSites.length > 0;
  const tickStub = hasTicks ? 7 : 0;
  const laneCount = input.features.laneCount;
  const bandBudget = Math.max(20, outerLimit * 0.3);
  const pitch = laneCount > 0 ? Math.min(14, bandBudget / laneCount) : 0;
  const lanesBand = laneCount * pitch;
  const radius = Math.max(40, outerLimit - tickStub - lanesBand - (laneCount > 0 ? 6 : 2));
  const outer = radius + (laneCount > 0 ? 3 : 0) + lanesBand + (hasTicks ? 2 + tickStub : 0);
  const feature = (lane: number): readonly [number, number] => [
    radius + 3 + lane * pitch,
    radius + 3 + (lane + 1) * pitch - 2.5,
  ];
  const primerPitch = 7;
  const primer = (lane: number): readonly [number, number] => [
    radius - 6 - (lane + 1) * primerPitch + 1.5,
    radius - 6 - lane * primerPitch,
  ];

  const arcs: SceneArc[] = [];
  const draw = (
    list: readonly MapFeature[],
    kind: 'feature' | 'primer',
    band: (lane: number) => readonly [number, number],
  ) => {
    for (const f of list) {
      const [inner, outerRadius] = band(f.lane);
      const middle = (inner + outerRadius) / 2;
      const last = f.pieces.length - 1;
      f.pieces.forEach((piece, index) => {
        const headHere = f.strand === 1 ? index === last : index === 0;
        const from = angleOf(piece.start, length);
        const to = Math.max(angleOf(piece.end, length), from + MIN_ARC_PX / middle);
        arcs.push({
          id: `${kind === 'feature' ? 'f' : 'p'}:${f.id}`,
          kind,
          d: sectorPath(cx, cy, inner, outerRadius, from, to, headHere ? f.strand : 0, HEAD_PX / middle),
          color: f.color,
        });
      });
    }
  };
  draw(input.features.features, 'feature', feature);
  draw(input.primers.features, 'primer', primer);

  const ticks: SceneTick[] = tickSites.map((site) => {
    const angle = angleOf(site.boundary, length);
    const [x1, y1] = point(cx, cy, outer - tickStub, angle);
    const [x2, y2] = point(cx, cy, outer, angle);
    return { id: `s:${site.id}`, enzyme: site.enzyme, x1, y1, x2, y2, angle };
  });

  const primerLanes = input.primers.laneCount;
  const scaleRadius = radius - 12 - primerLanes * primerPitch;
  const scale: ScaleTick[] = [];
  const step = niceStep(length, 10);
  const showScaleLabels = scaleRadius > 46;
  for (let position = 0; position < length; position += step) {
    const angle = angleOf(position, length);
    const [x1, y1] = point(cx, cy, scaleRadius, angle);
    const [x2, y2] = point(cx, cy, scaleRadius - 5, angle);
    const [lx, ly] = point(cx, cy, scaleRadius - 15, angle);
    scale.push({
      x1,
      y1,
      x2,
      y2,
      label: showScaleLabels && position > 0 ? formatBp(position) : null,
      lx,
      ly,
    });
  }

  // Labels: two columns that follow a circle a little wider than the map.
  const elbowRadius = outer + ELBOW_GAP;
  const columnRadius = outer + COLUMN_GAP;
  const capacity = Math.max(1, Math.floor((height - 16) / LABEL_HEIGHT));
  const sides: Candidate[][] = [[], []];
  for (const c of candidates) sides[Math.cos(c.angle) >= 0 ? 0 : 1]?.push(c);
  const labels: SceneLabel[] = [];
  sides.forEach((side, sideIndex) => {
    const right = sideIndex === 0;
    const kept = side
      .map((c, order) => ({ c, order }))
      .sort((a, b) => b.c.priority - a.c.priority || a.order - b.order)
      .slice(0, capacity)
      .map(({ c }) => c);
    const elbows = kept.map((c) => point(cx, cy, elbowRadius, c.angle));
    const ys = spreadLabels(
      elbows.map((e) => e[1]),
      LABEL_HEIGHT,
      8,
      height - 8,
    );
    kept.forEach((c, i) => {
      const y = ys[i] as number;
      const dy = Math.min(Math.abs(y - cy), columnRadius);
      const edge = Math.max(10, Math.sqrt(columnRadius * columnRadius - dy * dy));
      const x = right ? cx + edge : cx - edge;
      const text = fitText(c.text, MAX_LABEL_WIDTH);
      const elbow = elbows[i] as [number, number];
      const anchorRadius =
        c.kind === 'site' ? outer : c.kind === 'feature' ? feature(c.lane)[1] + 1 : primer(c.lane)[0];
      const start = point(cx, cy, anchorRadius, c.angle);
      labels.push({
        key: c.key,
        id: c.id,
        text,
        x: right ? x + 4 : x - 4,
        y,
        anchor: right ? 'start' : 'end',
        leader: `${at(start)} ${at(elbow)} ${at([x, y])}`,
        kind: c.kind,
        ...(c.color ? { color: c.color } : {}),
      });
    });
  });

  return {
    width,
    height,
    cx,
    cy,
    radius,
    scaleRadius,
    innerRadius: Math.max(0, scaleRadius - (showScaleLabels ? 30 : 12)),
    arcs,
    ticks,
    scale,
    labels,
    items,
    hiddenSites: input.hiddenSites,
    bands: { feature, primer },
  };
}
