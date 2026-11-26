import { randomDna } from '../../../tests/fixtures/restriction/fixtures';
import { linearLocation } from '../../engine/location';
import { ENZYME_CATALOG, scanSites } from '../../engine/restriction';
import type { Feature } from '../../engine/types';
import type { Overlay } from '../../state/view';
import { lowerBound, meanBuckets, minMaxIndices, nearestIndex } from './decimate';
import {
  blockify,
  columnOfOffset,
  gutterDigits,
  offsetOfColumn,
  positionAtPoint,
  rowCount,
  rowOfPosition,
} from './layout';
import { createOverlayIndex } from './overlayIndex';
import { featureOverlays, primerOverlays, restrictionOverlays, searchOverlays } from './overlays';
import { formatNumber, linearScale, niceTicks, paddedDomain, stepDecimals } from './scale';
import { MAX_SCROLL_HEIGHT, scrollTopFor, virtualRange } from './virtual';

describe('decimation keeps the extremes of every bucket', () => {
  const series = (n: number, seed: number) =>
    Float64Array.from(randomDna(n, seed), (c) => 'ACGT'.indexOf(c) + Math.random());

  it('returns a range that already fits whole', () => {
    expect([...minMaxIndices(new Float64Array(10), 3, 8, 100)]).toEqual([3, 4, 5, 6, 7]);
    expect(minMaxIndices(new Float64Array(0), 0, 0, 10)).toHaveLength(0);
  });

  it('keeps the minimum and maximum of each equal slice and at most maxPoints marks', () => {
    const values = series(100_000, 3);
    const marks = minMaxIndices(values, 0, values.length, 200);
    expect(marks.length).toBeLessThanOrEqual(200);
    const bucket = values.length / 100;
    for (let k = 0; k < 100; k++) {
      const slice = values.subarray(k * bucket, (k + 1) * bucket);
      const inSlice = [...marks]
        .filter((i) => i >= k * bucket && i < (k + 1) * bucket)
        .map((i) => values[i] as number);
      expect(Math.min(...inSlice)).toBe(Math.min(...slice));
      expect(Math.max(...inSlice)).toBe(Math.max(...slice));
    }
  });

  it('keeps a single spike and a single dip anywhere', () => {
    const values = new Float64Array(1_000_000).fill(1);
    values[777_777] = 50;
    values[123_456] = -50;
    const kept = [...minMaxIndices(values, 0, values.length, 1000)];
    expect(kept).toContain(777_777);
    expect(kept).toContain(123_456);
  });

  it('lists indices in ascending order and skips NaN', () => {
    const values = Float64Array.from({ length: 5000 }, (_, i) => (i % 7 === 0 ? Number.NaN : Math.sin(i)));
    const marks = [...minMaxIndices(values, 0, values.length, 100)];
    expect(marks).toEqual([...marks].sort((a, b) => a - b));
    expect(marks.every((i) => !Number.isNaN(values[i]))).toBe(true);
  });

  it('decimates only the asked range', () => {
    const values = Float64Array.from({ length: 10_000 }, (_, i) => i);
    const marks = minMaxIndices(values, 2000, 4000, 20);
    expect(Math.min(...marks)).toBeGreaterThanOrEqual(2000);
    expect(Math.max(...marks)).toBeLessThan(4000);
    expect(marks).toContain(2000);
    expect(marks).toContain(3999);
  });

  it('cuts a strip into bucket means', () => {
    const buckets = meanBuckets([1, 3, 5, 7, 9, 11], 0, 6, 3);
    expect([...buckets.mean]).toEqual([2, 6, 10]);
    expect([...buckets.from]).toEqual([0, 2, 4]);
    expect([...buckets.to]).toEqual([2, 4, 6]);
    expect(meanBuckets([1, 2], 0, 2, 100).mean).toHaveLength(2);
  });

  it('finds positions in an ascending array', () => {
    const xs = [10, 20, 30, 40];
    expect(lowerBound(xs, 25)).toBe(2);
    expect(lowerBound(xs, 5)).toBe(0);
    expect(lowerBound(xs, 99)).toBe(4);
    expect(nearestIndex(xs, 24)).toBe(1);
    expect(nearestIndex(xs, 26)).toBe(2);
    expect(nearestIndex(xs, -3)).toBe(0);
    expect(nearestIndex(xs, 100)).toBe(3);
    expect(nearestIndex(xs, 12, 10)).toBe(0);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('scales and ticks', () => {
  it('maps both ways', () => {
    const scale = linearScale([0, 10], [100, 200]);
    expect(scale(5)).toBe(150);
    expect(scale.invert(175)).toBe(7.5);
    expect(linearScale([3, 3], [0, 10])(3)).toBe(0);
  });

  it('picks round ticks inside the range', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(0, 5_000_000, 5)).toEqual([0, 1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000]);
    expect(niceTicks(-1, 1, 4)).toContain(0);
    expect(niceTicks(0.1, 0.35, 5)).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(stepDecimals(0.05)).toBe(2);
    expect(stepDecimals(100)).toBe(0);
  });

  it('pads a domain and widens a single value', () => {
    expect(paddedDomain(0, 10, 0.1)).toEqual([-1, 11]);
    expect(paddedDomain(2, 2)).toEqual([1.5, 2.5]);
    expect(paddedDomain(Number.NaN, 1)).toEqual([0, 1]);
    expect(formatNumber(1.5, 2)).toMatch(/1[.,]50/);
  });
});

describe('virtual range', () => {
  const base = { itemHeight: 20, viewportHeight: 200 };

  it('draws the visible items plus overscan and no more', () => {
    const range = virtualRange({ ...base, count: 1000, scrollTop: 400, overscan: 2 });
    expect(range).toMatchObject({ first: 18, last: 32, offset: 400, scale: 1, scrollHeight: 20_000 });
  });

  it('clamps at both ends and for a list shorter than the viewport', () => {
    expect(virtualRange({ ...base, count: 1000, scrollTop: 0, overscan: 0 })).toMatchObject({
      first: 0,
      last: 10,
    });
    expect(virtualRange({ ...base, count: 1000, scrollTop: 1e9, overscan: 0 })).toMatchObject({
      first: 990,
      last: 1000,
    });
    expect(virtualRange({ ...base, count: 3, scrollTop: 50 })).toMatchObject({
      first: 0,
      last: 3,
      offset: 0,
    });
    expect(virtualRange({ ...base, count: 0, scrollTop: 0 })).toMatchObject({ first: 0, last: 0 });
  });

  it('keeps a huge list reachable with a capped scroll height', () => {
    const count = 3_000_000;
    const top = virtualRange({ ...base, count, scrollTop: 0, overscan: 0 });
    expect(top.scrollHeight).toBe(MAX_SCROLL_HEIGHT);
    expect(top.scale).toBeGreaterThan(1);
    const maxScroll = MAX_SCROLL_HEIGHT - base.viewportHeight;
    const bottom = virtualRange({ ...base, count, scrollTop: maxScroll, overscan: 0 });
    expect(bottom.last).toBe(count);
    expect(bottom.first).toBe(count - 10);
    const middle = virtualRange({ ...base, count, scrollTop: maxScroll / 2, overscan: 0 });
    expect(Math.abs(middle.first - count / 2)).toBeLessThan(10);
  });

  it('computes the scroll that shows an item, in px of the real scroll area', () => {
    const input = { ...base, count: 1000, scrollTop: 400 };
    expect(scrollTopFor(500, 'start', input)).toBe(10_000);
    expect(scrollTopFor(500, 'center', input)).toBe(10_000 - 90);
    expect(scrollTopFor(25, 'nearest', input)).toBe(400);
    expect(scrollTopFor(5, 'nearest', input)).toBe(100);
    expect(scrollTopFor(40, 'nearest', input)).toBe(40 * 20 + 20 - 200);
    expect(scrollTopFor(999, 'start', input)).toBe(1000 * 20 - 200);
    const huge = { ...base, count: 3_000_000, scrollTop: 0 };
    const scroll = scrollTopFor(1_500_000, 'start', huge);
    expect(virtualRange({ ...huge, scrollTop: scroll, overscan: 0 }).first).toBe(1_500_000);
  });
});

describe('row layout', () => {
  const layout = { length: 250, lineLength: 60, blockSize: 0 };

  it('counts rows and finds the row of a position, the end boundary included', () => {
    expect(rowCount(layout)).toBe(5);
    expect(rowCount({ ...layout, length: 240 })).toBe(4);
    expect(rowOfPosition(0, layout)).toBe(0);
    expect(rowOfPosition(59, layout)).toBe(0);
    expect(rowOfPosition(60, layout)).toBe(1);
    expect(rowOfPosition(250, layout)).toBe(4);
    expect(rowOfPosition(240, { ...layout, length: 240 })).toBe(3);
    expect(rowOfPosition(0, { ...layout, length: 0 })).toBe(0);
  });

  it('puts a gap column between blocks and maps columns back to the nearest base boundary', () => {
    expect(columnOfOffset(9, 10)).toBe(9);
    expect(columnOfOffset(10, 10)).toBe(11);
    expect(columnOfOffset(25, 10)).toBe(27);
    expect(columnOfOffset(25, 0)).toBe(25);
    expect(offsetOfColumn(0, 10)).toBe(0);
    expect(offsetOfColumn(10, 10)).toBe(10);
    expect(offsetOfColumn(11, 10)).toBe(10);
    expect(offsetOfColumn(12, 10)).toBe(11);
    expect(offsetOfColumn(27, 10)).toBe(25);
    expect(offsetOfColumn(7.4, 0)).toBe(7);
    expect(offsetOfColumn(7.6, 0)).toBe(8);
    expect(offsetOfColumn(-3, 10)).toBe(0);
  });

  it('inverts columnOfOffset for every base of a row', () => {
    for (const blockSize of [0, 5, 10]) {
      for (let offset = 0; offset < 60; offset++) {
        expect(offsetOfColumn(columnOfOffset(offset, blockSize), blockSize)).toBe(offset);
      }
    }
  });

  it('finds the sequence position under a point, clamped to the sequence', () => {
    expect(positionAtPoint(2, 7, layout)).toBe(127);
    expect(positionAtPoint(2, 500, layout)).toBe(180);
    expect(positionAtPoint(4, 30, layout)).toBe(250);
    expect(positionAtPoint(-1, 3, layout)).toBe(3);
    expect(positionAtPoint(1, 12, { ...layout, blockSize: 10 })).toBe(60 + 11);
  });

  it('splits text into blocks and sizes the gutter', () => {
    expect(blockify('ABCDEFGHIJKLM', 5)).toBe('ABCDE FGHIJ KLM');
    expect(blockify('ABC', 5)).toBe('ABC');
    expect(blockify('ABCDEFGH', 0)).toBe('ABCDEFGH');
    expect(gutterDigits({ length: 5_000_000, lineLength: 60, blockSize: 0 })).toBe(7);
    expect(gutterDigits({ length: 0, lineLength: 60, blockSize: 0 })).toBe(1);
  });
});

describe('overlay index', () => {
  const overlay = (id: string, start: number, end: number): Overlay => ({ id, kind: 'feature', start, end });
  const ids = (list: readonly Overlay[]) => list.map((o) => o.id);

  it('finds every overlay that touches a window, long ones included, in start order', () => {
    const index = createOverlayIndex([
      overlay('long', 0, 1000),
      overlay('a', 10, 20),
      overlay('b', 15, 30),
      overlay('c', 40, 50),
      overlay('far', 500, 510),
    ]);
    expect(ids(index.query(18, 25))).toEqual(['long', 'a', 'b']);
    expect(ids(index.query(20, 40))).toEqual(['long', 'b']);
    expect(ids(index.query(50, 60))).toEqual(['long']);
    expect(ids(index.query(2000, 3000))).toEqual([]);
    expect(ids(createOverlayIndex([]).query(0, 10))).toEqual([]);
  });

  it('answers 300 000 overlays quickly', { timeout: 60_000 }, () => {
    const many = Array.from({ length: 300_000 }, (_, i) =>
      overlay(String(i), (i * 17) % 4_900_000, ((i * 17) % 4_900_000) + 6),
    );
    const index = createOverlayIndex(many);
    const t0 = performance.now();
    for (let row = 0; row < 1000; row++) index.query(row * 4900, row * 4900 + 60);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('overlay builders', () => {
  const feature = (id: string, segments: [number, number][], strand: 1 | -1 = 1): Feature => ({
    id,
    type: 'CDS',
    name: `gene ${id}`,
    origin: 'file',
    location: { strand, segments: segments.map(([start, end]) => ({ start, end })) },
  });

  it('turns each feature segment into an overlay in the color of the feature type', () => {
    const overlays = featureOverlays([
      feature(
        'a',
        [
          [90, 100],
          [0, 5],
        ],
        -1,
      ),
    ]);
    expect(overlays.map((o) => [o.start, o.end, o.strand, o.label])).toEqual([
      [90, 100, -1, 'gene a'],
      [0, 5, -1, 'gene a'],
    ]);
    expect(new Set(overlays.map((o) => o.id)).size).toBe(2);
    expect(overlays[0]?.color).toMatch(/^#/);
    expect(featureOverlays([{ ...feature('b', [[1, 2]]), color: '#123456' }])[0]?.color).toBe('#123456');
  });

  it('turns hits and primer bindings into overlays', () => {
    expect(
      searchOverlays([{ start: 5, length: 3, strand: -1, location: linearLocation(5, 8, -1) }]).map((o) => [
        o.kind,
        o.start,
        o.end,
        o.strand,
      ]),
    ).toEqual([['search', 5, 8, -1]]);
    expect(
      primerOverlays(
        [{ primerId: 'p1', strand: 1, span: { start: 10, end: 30 }, mismatches: 0 }],
        new Map([['p1', 'Fwd']]),
      ),
    ).toMatchObject([{ kind: 'primer', start: 10, end: 30, label: 'Fwd' }]);
  });

  it('paints recognition sites, splitting one that crosses the origin of a circular molecule', () => {
    const ecoRI = ENZYME_CATALOG.filter((e) => e.name === 'EcoRI');
    const seq = `TTGAATTC${'A'.repeat(20)}GAA`.padEnd(40, 'A');
    const wrapped = `${seq.slice(0, -3)}GAA`;
    const circular = scanSites(`TTC${'A'.repeat(20)}GAA`, 'circular', ecoRI);
    const overlays = restrictionOverlays(circular);
    expect(overlays.map((o) => [o.start, o.end]).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))).toEqual([
      [0, 3],
      [23, 26],
    ]);
    const linear = restrictionOverlays(scanSites(seq, 'linear', ecoRI));
    expect(linear.map((o) => [o.start, o.end])).toEqual([[2, 8]]);
    expect(restrictionOverlays(scanSites(wrapped, 'linear', ecoRI), new Set(['BamHI']))).toEqual([]);
  });
});
