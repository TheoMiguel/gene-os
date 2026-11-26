import { assignLanes, packRows, spreadLabels } from './packing';

const gaps = (centers: number[]) => {
  const sorted = [...centers].sort((a, b) => a - b);
  return sorted.slice(1).map((value, i) => value - (sorted[i] as number));
};

describe('spreadLabels', () => {
  it('leaves labels that do not crowd each other exactly where they were asked to be', () => {
    expect(spreadLabels([20, 60, 100], 13, 0, 200)).toEqual([20, 60, 100]);
  });

  it('pushes colliding labels apart by the label height, around their shared target', () => {
    const placed = spreadLabels([100, 100, 100], 13, 0, 400);
    expect(gaps(placed)).toEqual([13, 13]);
    expect(placed[1]).toBeCloseTo(100, 9);
  });

  it('keeps labels inside the bounds and never overlapping when they pile up at an edge', () => {
    const placed = spreadLabels([2, 3, 4, 5, 6], 13, 0, 200);
    expect(Math.min(...placed)).toBeGreaterThanOrEqual(6.5 - 1e-9);
    expect(gaps(placed).every((gap) => gap >= 13 - 1e-9)).toBe(true);
  });

  it('keeps the order of the targets and returns each label at its own index', () => {
    const desired = [90, 10, 50, 52, 51];
    const placed = spreadLabels(desired, 13, 0, 300);
    const byTarget = desired.map((_, i) => i).sort((a, b) => (desired[a] as number) - (desired[b] as number));
    const centers = byTarget.map((i) => placed[i] as number);
    expect([...centers].sort((a, b) => a - b)).toEqual(centers);
  });

  it('shrinks the spacing when the labels cannot all fit, so they still do not overlap', () => {
    const placed = spreadLabels(
      Array.from({ length: 20 }, () => 50),
      13,
      0,
      100,
    );
    expect(Math.min(...placed)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...placed)).toBeLessThanOrEqual(100);
    expect(gaps(placed).every((gap) => gap >= 5 - 1e-9)).toBe(true);
  });

  it('is empty for no labels', () => {
    expect(spreadLabels([], 13, 0, 100)).toEqual([]);
  });
});

describe('packRows', () => {
  it('puts items that overlap in different rows and items that clear each other in one', () => {
    const rows = packRows(
      [
        { start: 0, end: 50 },
        { start: 40, end: 90 },
        { start: 100, end: 150 },
      ],
      4,
    );
    expect(rows).toEqual([0, 1, 0]);
  });

  it('gives the first row to the more important item and drops the item that has no row left', () => {
    const rows = packRows(
      [
        { start: 0, end: 50, priority: 1 },
        { start: 10, end: 60, priority: 5 },
        { start: 20, end: 70, priority: 3 },
      ],
      0,
      2,
    );
    expect(rows).toEqual([-1, 0, 1]);
  });
});

describe('assignLanes', () => {
  const overlapsInLane = (
    intervals: { start: number; end: number }[],
    lanes: number[],
    length: number,
    gap: number,
  ) => {
    const spans = (i: number) => {
      const { start, end } = intervals[i] as { start: number; end: number };
      return end > length
        ? [
            [start, length],
            [0, end - length],
          ]
        : [[start, end]];
    };
    for (let a = 0; a < intervals.length; a++)
      for (let b = a + 1; b < intervals.length; b++) {
        if (lanes[a] !== lanes[b]) continue;
        for (const [s1, e1] of spans(a) as number[][])
          for (const [s2, e2] of spans(b) as number[][])
            if ((s1 as number) < (e2 as number) + gap && (s2 as number) < (e1 as number) + gap) return true;
      }
    return false;
  };

  it('uses one lane for features that do not touch and more for features that overlap', () => {
    const result = assignLanes(
      [
        { start: 0, end: 100 },
        { start: 200, end: 300 },
        { start: 50, end: 250 },
      ],
      1000,
      0,
    );
    expect(result.count).toBe(2);
    expect(result.lanes[0]).toBe(result.lanes[1]);
    expect(result.lanes[2]).not.toBe(result.lanes[0]);
  });

  it('never puts two features of a molecule with an origin-spanning feature in one lane where they overlap', () => {
    const length = 1000;
    const intervals = [
      { start: 900, end: 1100 },
      { start: 50, end: 150 },
      { start: 300, end: 500 },
      { start: 920, end: 990 },
      { start: 100, end: 400 },
      { start: 60, end: 80 },
    ];
    const { lanes } = assignLanes(intervals, length, 5);
    expect(overlapsInLane(intervals, lanes, length, 5)).toBe(false);
    expect(lanes[1]).not.toBe(lanes[0]);
    expect(lanes[3]).not.toBe(lanes[0]);
  });

  it('keeps the gap between neighbours in a lane, and survives thousands of features', () => {
    const length = 5_000_000;
    const intervals = Array.from({ length: 5000 }, (_, i) => ({
      start: (i * 997) % (length - 3000),
      end: ((i * 997) % (length - 3000)) + 500 + (i % 7) * 100,
    }));
    const started = performance.now();
    const { lanes } = assignLanes(intervals, length, 50);
    expect(performance.now() - started).toBeLessThan(2000);
    const byLane = new Map<number, { start: number; end: number }[]>();
    intervals.forEach((interval, i) => {
      byLane.set(lanes[i] as number, [...(byLane.get(lanes[i] as number) ?? []), interval]);
    });
    for (const list of byLane.values()) {
      list.sort((a, b) => a.start - b.start);
      list.slice(1).forEach((item, i) => {
        expect(item.start).toBeGreaterThanOrEqual((list[i] as { end: number }).end + 50);
      });
    }
  });
});
