import { PUC19 } from '../../../../tests/fixtures/restriction/fixtures';
import { circularLocation, linearLocation } from '../../../engine/location';
import { ENZYME_CATALOG, scanSites } from '../../../engine/restriction';
import type { Feature } from '../../../engine/types';
import { angleOf, buildCircularScene, sectorPath } from './circularMap';
import { barPath, buildLinearScene } from './linearMap';
import { layoutFeatures, selectMapSites } from './mapModel';
import { LABEL_HEIGHT, textWidth } from './mapText';

const feature = (id: string, start: number, end: number, strand: 1 | -1 = 1, name = id): Feature => ({
  id,
  type: 'CDS',
  name,
  origin: 'file',
  location: linearLocation(start, end, strand),
});

const scan = scanSites(PUC19, 'circular', ENZYME_CATALOG);
const L = PUC19.length;
const pucFeatures: Feature[] = [
  feature('mcs', 395, 452, 1, 'MCS'),
  feature('lacZ', 146, 469, -1, 'lacZα'),
  feature('ori', 866, 1455, -1, 'ori'),
  feature('amp', 1625, 2486, -1, 'AmpR'),
  {
    id: 'wrap',
    type: 'promoter',
    name: 'wrapProm',
    origin: 'file',
    location: circularLocation(2600, 186, L, 1),
  },
];
const none = new Set<string>();
const empty = layoutFeatures([], L, true);
const recognition = new Map(scan.sites.map(({ enzyme }) => [enzyme.name, enzyme.site]));

const circular = (features = pucFeatures, picked = none, width = 700, height = 600) => {
  const chosen = selectMapSites(scan, 'unique', picked);
  return buildCircularScene({
    length: L,
    features: layoutFeatures(features, L, true),
    primers: empty,
    sites: chosen.sites,
    hiddenSites: chosen.hidden,
    recognition,
    picked,
    width,
    height,
  });
};

/** Pairs of label boxes on one side of a map that overlap. */
function overlappingLabels(labels: readonly { x: number; y: number; text: string; anchor: string }[]) {
  const boxes = labels.map((label) => {
    const w = textWidth(label.text);
    const x0 = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - w : label.x - w / 2;
    return {
      x0,
      x1: x0 + w,
      y0: label.y - LABEL_HEIGHT / 2 + 0.5,
      y1: label.y + LABEL_HEIGHT / 2 - 0.5,
      text: label.text,
    };
  });
  const clashes: string[] = [];
  for (let a = 0; a < boxes.length; a++)
    for (let b = a + 1; b < boxes.length; b++) {
      const p = boxes[a] as (typeof boxes)[number];
      const q = boxes[b] as (typeof boxes)[number];
      if (p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1) clashes.push(`${p.text} / ${q.text}`);
    }
  return clashes;
}

describe('circular map', () => {
  it('draws one arc with an arrowhead for a feature across the origin, and one tick per cut', () => {
    const scene = circular();
    expect(scene.arcs.filter((arc) => arc.id === 'f:wrap')).toHaveLength(1);
    const chosen = selectMapSites(scan, 'unique', none);
    expect(scene.ticks).toHaveLength(chosen.sites.length);
    expect(scene.items.get('f:wrap')?.span).toBe('2,601–2,686, 1–100');
    expect(scene.items.get('s:EcoRI:395')?.title).toBe('EcoRI (396)');
    expect(scene.items.get('s:EcoRI:395')?.detail).toBe('GAATTC');
  });

  it('places labels so that none overlap, however many cuts there are', () => {
    for (const [width, height] of [
      [700, 600],
      [520, 420],
      [380, 700],
    ] as const) {
      const scene = circular(pucFeatures, none, width, height);
      expect(scene.labels.length).toBeGreaterThan(20);
      const right = scene.labels.filter((label) => label.anchor === 'start');
      const left = scene.labels.filter((label) => label.anchor === 'end');
      expect(overlappingLabels(right)).toEqual([]);
      expect(overlappingLabels(left)).toEqual([]);
      for (const label of scene.labels) {
        expect(label.y).toBeGreaterThan(0);
        expect(label.y).toBeLessThan(height);
      }
    }
  });

  it('keeps every label of a picked enzyme and every label inside the picture', () => {
    const scene = circular(pucFeatures, new Set(['EcoRI', 'HindIII']), 520, 300);
    const texts = scene.labels.map((label) => label.text);
    expect(texts).toContain('EcoRI (396)');
    expect(texts).toContain('HindIII (447)');
    for (const label of scene.labels) {
      const w = textWidth(label.text);
      const x0 = label.anchor === 'start' ? label.x : label.x - w;
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(x0 + w).toBeLessThanOrEqual(520);
    }
  });

  it('drops the position from enzyme labels on a narrow screen, where the tooltip still has it', () => {
    const scene = circular(pucFeatures, none, 380, 600);
    expect(scene.labels.map((label) => label.text)).toContain('EcoRI');
  });

  it('survives thousands of features: lanes do not overlap, labels fit, and it builds quickly', () => {
    const length = 5_000_000;
    const many = Array.from({ length: 4000 }, (_, i) =>
      feature(
        `g${i}`,
        (i * 1237) % (length - 4000),
        ((i * 1237) % (length - 4000)) + 300 + (i % 11) * 200,
        i % 2 ? 1 : -1,
        `gene${i}`,
      ),
    );
    const started = performance.now();
    const scene = buildCircularScene({
      length,
      features: layoutFeatures(many, length, true),
      primers: empty,
      sites: [],
      hiddenSites: 0,
      recognition: new Map(),
      picked: none,
      width: 700,
      height: 600,
    });
    expect(performance.now() - started).toBeLessThan(3000);
    expect(scene.arcs).toHaveLength(4000);
    expect(overlappingLabels(scene.labels.filter((label) => label.anchor === 'start'))).toEqual([]);
    expect(overlappingLabels(scene.labels.filter((label) => label.anchor === 'end'))).toEqual([]);
  });

  it('puts base 0 at the top and runs clockwise', () => {
    expect(angleOf(0, 1000)).toBeCloseTo(-Math.PI / 2, 9);
    expect(angleOf(250, 1000)).toBeCloseTo(0, 9);
    expect(angleOf(500, 1000)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('draws an arrowhead at the end the strand points to', () => {
    const forward = sectorPath(0, 0, 10, 20, 0, 1, 1, 0.1);
    const reverse = sectorPath(0, 0, 10, 20, 0, 1, -1, 0.1);
    const plain = sectorPath(0, 0, 10, 20, 0, 1, 0, 0.1);
    expect(forward).toContain(`L${(15 * Math.cos(1)).toFixed(1)} ${(15 * Math.sin(1)).toFixed(1)}`);
    expect(reverse).toContain('L15.0 0.0Z');
    expect(forward).not.toBe(plain);
    expect(reverse).not.toBe(forward);
    expect(plain.endsWith('Z')).toBe(true);
  });
});

describe('linear map', () => {
  const chosen = selectMapSites(scan, 'unique', none);
  const linear = (
    window: { start: number; end: number },
    features = pucFeatures,
    width = 700,
    height = 500,
  ) =>
    buildLinearScene({
      length: L,
      window,
      features: layoutFeatures(features, L, true),
      primers: empty,
      sites: chosen.sites,
      hiddenSites: chosen.hidden,
      recognition,
      picked: none,
      width,
      height,
    });

  it('lays out only what is in the window, and gives the rest of the room to what is', () => {
    const whole = linear({ start: 0, end: L });
    const zoomed = linear({ start: 380, end: 470 });
    expect(whole.ticks.length).toBeGreaterThan(zoomed.ticks.length);
    expect(zoomed.items.has('f:ori')).toBe(false);
    expect(zoomed.items.has('f:mcs')).toBe(true);
    expect(zoomed.ticks.every((tick) => tick.x >= zoomed.left - 20 && tick.x <= zoomed.right + 20)).toBe(
      true,
    );
  });

  it('keeps labels inside the plot and from overlapping, also at the edges of the molecule', () => {
    for (const window of [
      { start: 0, end: L },
      { start: 0, end: 600 },
      { start: L - 700, end: L },
    ]) {
      const scene = linear(window);
      const labelled = scene.labels.filter((label) => !label.inside);
      expect(overlappingLabels(labelled.filter((label) => label.kind === 'site'))).toEqual([]);
      expect(overlappingLabels(labelled.filter((label) => label.kind !== 'site'))).toEqual([]);
      for (const label of labelled) {
        const w = textWidth(label.text);
        expect(label.x - w / 2).toBeGreaterThanOrEqual(scene.left - 0.01);
        expect(label.x + w / 2).toBeLessThanOrEqual(scene.right + 0.01);
      }
    }
  });

  it('writes a name inside a bar that is wide enough, and below the bar when it is not', () => {
    const wide = linear({ start: 800, end: 1500 });
    expect(wide.labels.find((label) => label.id === 'f:ori')?.inside).toBe(true);
    const narrow = linear({ start: 0, end: L });
    expect(narrow.labels.find((label) => label.id === 'f:mcs')?.inside).toBe(false);
  });

  it('draws the two ends of a feature across the origin when the circular molecule is shown linear', () => {
    const scene = linear({ start: 0, end: L });
    expect(scene.bars.filter((bar) => bar.id === 'f:wrap')).toHaveLength(2);
  });

  it('draws arrowheads on the strand end', () => {
    expect(barPath(0, 40, 0, 10, 1)).not.toBe(barPath(0, 40, 0, 10, -1));
    expect(barPath(0, 40, 0, 10, 0)).toContain('V');
  });
});
