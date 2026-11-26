import { featureItem, type MapItem, siteItem } from './mapItems';
import type { MapFeature, MapFeatures, MapSite } from './mapModel';
import { fitText, LABEL_FONT, LABEL_HEIGHT, niceStep, textWidth } from './mapText';
import { assignLanes, packRows } from './packing';

const MARGIN_X = 18;
const TOP = 10;
const LANE_PITCH = 16;
const BAR_HEIGHT = 12;
const PRIMER_PITCH = 10;
const MAX_ENZYME_ROWS = 7;
const MAX_FEATURE_ROWS = 6;
const MAX_LABELS = 300;
const MIN_BAR_PX = 1.5;
const HEAD_PX = 8;
const LABEL_GAP = 8;

export interface LinearWindow {
  readonly start: number;
  readonly end: number;
}

export interface LinearBar {
  readonly id: string;
  readonly kind: 'feature' | 'primer';
  readonly d: string;
  readonly color: string;
}

export interface LinearLabel {
  readonly key: string;
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle';
  /** `x1 y1 x2 y2` of the leader line, absent for a label inside its bar. */
  readonly leader?: readonly [number, number, number, number];
  readonly kind: 'feature' | 'primer' | 'site';
  readonly inside: boolean;
}

export interface LinearScene {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly baseline: number;
  readonly x: (position: number) => number;
  readonly scale: readonly { readonly x: number; readonly label: string }[];
  readonly bars: readonly LinearBar[];
  readonly ticks: readonly {
    readonly id: string;
    readonly enzyme: string;
    readonly x: number;
    readonly y1: number;
    readonly y2: number;
  }[];
  readonly labels: readonly LinearLabel[];
  readonly items: ReadonlyMap<string, MapItem>;
  readonly hiddenSites: number;
}

export interface LinearInput {
  readonly length: number;
  readonly window: LinearWindow;
  readonly features: MapFeatures;
  readonly primers: MapFeatures;
  readonly sites: readonly MapSite[];
  /** Cuts left out of `sites` because of the tick limit. */
  readonly hiddenSites: number;
  readonly recognition: ReadonlyMap<string, string>;
  readonly picked: ReadonlySet<string>;
  readonly width: number;
  readonly height: number;
}

interface Piece {
  readonly start: number;
  readonly end: number;
}

/** Pieces of a feature on a linear display: a piece across the origin shows at both ends of the molecule. */
function displayPieces(feature: MapFeature, length: number): Piece[] {
  return feature.pieces.flatMap((piece) =>
    piece.end <= length
      ? [piece]
      : [
          { start: piece.start, end: length },
          { start: 0, end: piece.end - length },
        ],
  );
}

const fmt = (n: number) => n.toFixed(1);

/** Lanes for the features in view alone, so zooming into a few features packs them into the lanes next to the scale. */
function laneFeatures(list: readonly MapFeature[], length: number, gapBases: number) {
  const { lanes, count } = assignLanes(
    list.map((feature) => ({ start: feature.start, end: feature.end })),
    length,
    gapBases,
  );
  return { laneOf: new Map(list.map((feature, i) => [feature.id, lanes[i] ?? 0])), count };
}

/** Rectangle with an arrowhead on one end (`strand` 0: plain). */
export function barPath(x0: number, x1: number, y: number, height: number, strand: 1 | -1 | 0): string {
  const head = Math.min(HEAD_PX, x1 - x0);
  const mid = y + height / 2;
  const bottom = y + height;
  if (strand === 1)
    return `M${fmt(x0)} ${fmt(y)}H${fmt(x1 - head)}L${fmt(x1)} ${fmt(mid)}L${fmt(x1 - head)} ${fmt(bottom)}H${fmt(x0)}Z`;
  if (strand === -1)
    return `M${fmt(x1)} ${fmt(y)}H${fmt(x0 + head)}L${fmt(x0)} ${fmt(mid)}L${fmt(x0 + head)} ${fmt(bottom)}H${fmt(x1)}Z`;
  return `M${fmt(x0)} ${fmt(y)}H${fmt(x1)}V${fmt(bottom)}H${fmt(x0)}Z`;
}

/**
 * Everything the linear map draws for the visible `window` of bases: only elements inside it are laid out, so
 * zooming into a dense region spreads its labels out. Enzyme labels stack in rows above the scale, feature labels in
 * rows below the lanes, or sit inside a bar that is wide enough.
 */
export function buildLinearScene(input: LinearInput): LinearScene {
  const { length, width, height, window } = input;
  const left = MARGIN_X;
  const right = Math.max(left + 40, width - MARGIN_X);
  const span = Math.max(1, window.end - window.start);
  const x = (position: number) => left + ((position - window.start) / span) * (right - left);
  const visible = (start: number, end: number) =>
    end >= window.start - span * 0.02 && start <= window.end + span * 0.02;
  const items = new Map<string, MapItem>();

  const sites = input.sites.filter((site) => visible(site.boundary, site.boundary));
  const labelled = sites
    .map((site) => ({
      site,
      priority: input.picked.has(site.enzyme) ? 90 : site.count === 1 ? 60 : 20 - Math.min(10, site.count),
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_LABELS);
  const siteTexts = labelled.map(({ site }) => `${site.enzyme} (${site.cut.toLocaleString()})`);
  const clampCenter = (center: number, half: number) => Math.min(Math.max(center, left + half), right - half);
  const siteCenters = labelled.map(({ site }, i) =>
    clampCenter(x(site.boundary), textWidth(siteTexts[i] as string) / 2),
  );
  const siteRows = packRows(
    labelled.map(({ priority }, i) => {
      const half = textWidth(siteTexts[i] as string) / 2;
      return { start: (siteCenters[i] as number) - half, end: (siteCenters[i] as number) + half, priority };
    }),
    LABEL_GAP,
    MAX_ENZYME_ROWS,
  );
  const enzymeRows = Math.max(0, ...siteRows.map((row) => row + 1));
  const baseline = TOP + (enzymeRows > 0 ? enzymeRows * LABEL_HEIGHT + 6 : 0) + 10;

  const inView = (feature: MapFeature) =>
    displayPieces(feature, length).some((piece) => visible(piece.start, piece.end));
  const gapBases = (span * 10) / (right - left);
  const shownFeatures = input.features.features.filter(inView);
  const shownPrimers = input.primers.features.filter(inView);
  const featureLanes = laneFeatures(shownFeatures, length, gapBases);
  const primerLayout = laneFeatures(shownPrimers, length, gapBases);
  const primerLanes = primerLayout.count;
  const primerTop = baseline + 24;
  const featureTop = primerTop + (primerLanes > 0 ? primerLanes * PRIMER_PITCH + 8 : 0);
  const room = Math.max(0, height - featureTop - 8 - MAX_FEATURE_ROWS * LABEL_HEIGHT * 0.5);
  const pitch =
    featureLanes.count > 0 ? Math.min(LANE_PITCH, Math.max(7, room / featureLanes.count)) : LANE_PITCH;
  const barHeight = Math.min(BAR_HEIGHT, pitch - 3);
  const lanesBottom = featureTop + featureLanes.count * pitch;

  const scale: { x: number; label: string }[] = [];
  const step = niceStep(span, Math.max(3, (right - left) / 110));
  for (let position = Math.ceil(window.start / step) * step; position <= window.end; position += step) {
    scale.push({ x: x(position), label: position.toLocaleString() });
  }

  const bars: LinearBar[] = [];
  const pending: {
    feature: MapFeature;
    kind: 'feature' | 'primer';
    item: MapItem;
    piece: Piece;
    x0: number;
    x1: number;
  }[] = [];
  const laneIn = (feature: MapFeature, kind: 'feature' | 'primer') =>
    (kind === 'feature' ? featureLanes : primerLayout).laneOf.get(feature.id) ?? 0;
  const addBars = (list: readonly MapFeature[], kind: 'feature' | 'primer') => {
    for (const feature of list) {
      const item = featureItem(feature, length, kind);
      const pieces = displayPieces(feature, length).filter((piece) => visible(piece.start, piece.end));
      if (pieces.length === 0) continue;
      items.set(item.id, item);
      const y =
        kind === 'feature'
          ? featureTop + laneIn(feature, kind) * pitch + (pitch - barHeight) / 2
          : primerTop + laneIn(feature, kind) * PRIMER_PITCH;
      const h = kind === 'feature' ? barHeight : PRIMER_PITCH - 4;
      pieces.forEach((piece, index) => {
        const x0 = x(Math.max(piece.start, window.start));
        const x1 = Math.max(x(Math.min(piece.end, window.end)), x0 + MIN_BAR_PX);
        const last = pieces.length - 1;
        const head = feature.strand === 1 ? index === last : index === 0;
        const clippedStart = piece.start < window.start;
        const clippedEnd = piece.end > window.end;
        const strand = head && !(feature.strand === 1 ? clippedEnd : clippedStart) ? feature.strand : 0;
        bars.push({ id: item.id, kind, d: barPath(x0, x1, y, h, strand), color: feature.color });
        pending.push({ feature, kind, item, piece, x0, x1 });
      });
    }
  };
  addBars(shownFeatures, 'feature');
  addBars(shownPrimers, 'primer');

  const labels: LinearLabel[] = [];
  const outside: {
    text: string;
    center: number;
    anchorY: number;
    id: string;
    kind: 'feature' | 'primer';
    priority: number;
  }[] = [];
  const longestPiece = new Map<string, (typeof pending)[number]>();
  for (const entry of pending) {
    const known = longestPiece.get(entry.item.id);
    if (!known || entry.x1 - entry.x0 > known.x1 - known.x0) longestPiece.set(entry.item.id, entry);
  }
  for (const { feature, kind, item, x0, x1 } of longestPiece.values()) {
    const text = feature.name;
    const barY = featureTop + laneIn(feature, kind) * pitch + (pitch - barHeight) / 2;
    if (kind === 'feature' && x1 - x0 >= textWidth(text) + HEAD_PX + 8) {
      labels.push({
        key: item.id,
        id: item.id,
        text,
        x: x0 + 5,
        y: barY + barHeight / 2 + LABEL_FONT * 0.35,
        anchor: 'start',
        kind,
        inside: true,
      });
    } else {
      const anchorY =
        kind === 'feature'
          ? barY + barHeight
          : primerTop + laneIn(feature, kind) * PRIMER_PITCH + PRIMER_PITCH - 4;
      outside.push({
        text,
        center: (x0 + x1) / 2,
        anchorY,
        id: item.id,
        kind,
        priority: kind === 'feature' ? 70 : 40,
      });
    }
  }
  const outsideTexts = outside.map((o) => fitText(o.text, 140));
  const outsideCenters = outside.map((o, i) =>
    clampCenter(o.center, textWidth(outsideTexts[i] as string) / 2),
  );
  const outsideRows = packRows(
    outside.map((o, i) => {
      const half = textWidth(outsideTexts[i] as string) / 2;
      return {
        start: (outsideCenters[i] as number) - half,
        end: (outsideCenters[i] as number) + half,
        priority: o.priority,
      };
    }),
    LABEL_GAP,
    MAX_FEATURE_ROWS,
  );
  const labelsTop = Math.max(lanesBottom, primerLanes > 0 ? primerTop + primerLanes * PRIMER_PITCH : 0) + 6;
  outside.forEach((o, i) => {
    const row = outsideRows[i] as number;
    if (row < 0) return;
    const text = outsideTexts[i] as string;
    const cx = outsideCenters[i] as number;
    const y = labelsTop + row * LABEL_HEIGHT + LABEL_FONT;
    labels.push({
      key: o.id,
      id: o.id,
      text,
      x: cx,
      y,
      anchor: 'middle',
      leader: [o.center, o.anchorY, cx, y - LABEL_FONT],
      kind: o.kind,
      inside: false,
    });
  });

  const ticks = sites.slice(0, 4000).map((site) => {
    const item = siteItem(site, input.recognition.get(site.enzyme) ?? '', length);
    items.set(item.id, item);
    return { id: item.id, enzyme: site.enzyme, x: x(site.boundary), y1: baseline - 9, y2: baseline };
  });
  labelled.forEach(({ site }, i) => {
    const row = siteRows[i] as number;
    if (row < 0) return;
    const text = siteTexts[i] as string;
    const tick = x(site.boundary);
    const cx = siteCenters[i] as number;
    const y = baseline - 14 - row * LABEL_HEIGHT;
    labels.push({
      key: `s:${site.id}`,
      id: `s:${site.id}`,
      text,
      x: cx,
      y,
      anchor: 'middle',
      leader: [tick, baseline - 9, cx, y + 3],
      kind: 'site',
      inside: false,
    });
  });

  return {
    width,
    height,
    left,
    right,
    baseline,
    x,
    scale,
    bars,
    ticks,
    labels,
    items,
    hiddenSites: input.hiddenSites + sites.length - ticks.length,
  };
}
