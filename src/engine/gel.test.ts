import { LADDERS, type Ladder, migrationPosition, resolvingRange, simulateGel, suggestLadder } from './gel';

function ladder(id: string): Ladder {
  const found = LADDERS.find((l) => l.id === id);
  if (!found) throw new Error(`no ladder ${id}`);
  return found;
}

describe('ladder catalog', () => {
  it('has each vendor ladder with sorted bands whose masses add up to the stated load', () => {
    expect(LADDERS.map((l) => l.id)).toEqual([
      'neb-1kb',
      'neb-1kb-plus',
      'neb-100bp',
      'neb-50bp',
      'neb-lmw',
      'thermo-generuler-1kb',
      'thermo-generuler-1kb-plus',
      'thermo-generuler-100bp-plus',
      'thermo-generuler-50bp',
      'thermo-generuler-ulr',
      'thermo-lambda-hindiii',
    ]);
    for (const l of LADDERS) {
      expect(l.source).toMatch(/^https:\/\/(www\.neb\.com|assets\.thermofisher\.com)\//);
      const sizes = l.bands.map((b) => b.bp);
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
      const total = l.bands.reduce((sum, b) => sum + b.ng, 0);
      expect(Math.abs(total - l.loadNg)).toBeLessThanOrEqual(3);
    }
  });
});

describe('migration model', () => {
  it('maps the resolving range of the gel (Sambrook & Russell) onto 0.1..0.9 of the lane', () => {
    expect(resolvingRange(1.5)).toEqual({ minBp: 200, maxBp: 3000 });
    expect(migrationPosition(3000, 1.5)).toBeCloseTo(0.1, 10);
    expect(migrationPosition(200, 1.5)).toBeCloseTo(0.9, 10);
  });

  it('runs smaller fragments further, and keeps every position inside the lane', () => {
    const sizes = [10, 50, 100, 300, 1000, 3000, 10000, 50000];
    for (const agarose of [0.5, 1, 2, 3]) {
      const positions = sizes.map((bp) => migrationPosition(bp, agarose));
      expect(positions).toEqual([...positions].sort((a, b) => b - a));
      for (const p of positions) expect(p > 0 && p < 1).toBe(true);
    }
  });

  it('resolves small fragments better on a dense gel and large fragments better on a loose one', () => {
    const gap = (a: number, b: number, agarose: number) =>
      Math.abs(migrationPosition(a, agarose) - migrationPosition(b, agarose));
    expect(gap(100, 200, 2)).toBeGreaterThan(gap(100, 200, 0.7));
    expect(gap(8000, 10000, 0.7)).toBeGreaterThan(gap(8000, 10000, 2));
  });
});

describe('simulateGel', () => {
  it('splits the load over equimolar fragments, so band mass grows with fragment length', () => {
    const [lane] = simulateGel([{ label: 'digest', sizes: [3000, 1000], loadNg: 400 }]);
    expect(lane?.bands.map((b) => [b.sizes, b.massNg, b.intensity])).toEqual([
      [[3000], 300, 1],
      [[1000], 100, 1 / 3],
    ]);
  });

  it('merges fragments that co-migrate and adds their masses', () => {
    const [lane] = simulateGel([{ label: 'digest', sizes: [1000, 3000, 1000, 1004] }], 1);
    expect(lane?.bands).toHaveLength(2);
    expect(lane?.bands[1]?.sizes).toEqual([1004, 1000, 1000]);
    expect(lane?.bands[1]?.massNg).toBeCloseTo((500 * 3004) / 6004, 10);
  });

  it('shows NEB 1 kb as its 10 bands (517 and 500 bp run together) and resolves lambda HindIII 2322/2027', () => {
    const [neb, lambda] = simulateGel(
      [
        { label: 'NEB 1 kb', ladder: ladder('neb-1kb') },
        { label: 'lambda', ladder: ladder('thermo-lambda-hindiii') },
      ],
      1,
    );
    expect(neb?.bands).toHaveLength(10);
    expect(neb?.bands.find((b) => b.sizes.includes(3001))?.reference).toBe(true);
    expect(lambda?.bands).toHaveLength(8);
    // Intensities are relative to the heaviest band on the gel: the 23130 bp lambda band (238 ng).
    expect(lambda?.bands[0]?.intensity).toBe(1);
    expect(neb?.bands.find((b) => b.sizes.includes(3001))?.intensity).toBeCloseTo(125 / 238.4, 10);
  });

  it('scales a ladder to the loaded mass', () => {
    const [lane] = simulateGel([{ label: 'half', ladder: ladder('thermo-generuler-1kb'), loadNg: 250 }]);
    expect(lane?.bands[0]?.massNg).toBe(15);
  });
});

describe('suggestLadder', () => {
  it('picks a kilobase ladder for a plasmid digest', () => {
    expect(suggestLadder([4500, 2686, 800]).id).toMatch(/1kb/);
    expect(suggestLadder([3001, 1500, 500]).id).toBe('neb-1kb');
  });

  it('picks a 100 bp or 50 bp ladder for small PCR products', () => {
    expect(['neb-100bp', 'thermo-generuler-100bp-plus', 'neb-50bp', 'thermo-generuler-50bp']).toContain(
      suggestLadder([150, 320, 610]).id,
    );
  });

  it('picks a low-range ladder for very short fragments and a wide one for genomic sizes', () => {
    expect(suggestLadder([15, 30, 60]).id).toBe('thermo-generuler-ulr');
    expect(['thermo-generuler-1kb-plus', 'thermo-lambda-hindiii']).toContain(
      suggestLadder([20000, 9000, 4000]).id,
    );
  });
});
