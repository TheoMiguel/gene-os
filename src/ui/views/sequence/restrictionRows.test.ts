import { PUC19, randomDna } from '../../../../tests/fixtures/restriction/fixtures';
import goldenJson from '../../../../tests/oracle/restriction.json';
import { ENZYME_CATALOG, scanSites } from '../../../engine/restriction';
import {
  buildSiteRows,
  createSiteIndex,
  DEFAULT_FILTER,
  filterEnzymes,
  MAX_ROWS,
  type RestrictionFilter,
} from './restrictionRows';

const golden = goldenJson as { search: Record<string, Record<string, number[]>> };
const scan = scanSites(PUC19, 'circular', ENZYME_CATALOG);
const all: RestrictionFilter = { endTypes: [], cutCounts: [], suppliers: [] };

describe('restriction list rows', () => {
  it('lists one row per cut with the cut position, strand, end type and overhang', () => {
    const { rows } = buildSiteRows(scan, PUC19, { ...all, cutCounts: ['unique'] });
    const ecoRI = rows.find((row) => row.enzyme === 'EcoRI');
    expect(ecoRI).toMatchObject({
      recognition: 'GAATTC',
      count: 1,
      cut: 396,
      siteStart: 395,
      strand: 1,
      end: 'five_prime',
      overhang: 'AATT',
    });
    const pstI = rows.find((row) => row.enzyme === 'PstI');
    expect(pstI).toMatchObject({ end: 'three_prime', overhang: 'TGCA' });
    expect(rows.find((row) => row.enzyme === 'EcoRV')).toBeUndefined();
  });

  it("gives an enzyme that cuts n times n rows, each with the enzyme's cut count", () => {
    const expected = golden.search['pUC19/circular'] ?? {};
    const [name = ''] = Object.entries(expected).find(([, cuts]) => cuts.length === 3) ?? [];
    const { rows } = buildSiteRows(scan, PUC19, { ...all, cutCounts: ['multiple'] });
    const mine = rows.filter((row) => row.enzyme === name);
    expect(mine.map((row) => row.cut)).toEqual(expect.arrayContaining(expected[name] ?? []));
    expect(mine.every((row) => row.count === 3)).toBe(true);
  });

  it('shows the enzymes that do not cut only when asked, as one row each with no position', () => {
    const none = buildSiteRows(scan, PUC19, { ...all, cutCounts: ['non_cutter'] }).rows;
    expect(none.length).toBeGreaterThan(100);
    expect(none.every((row) => row.count === 0 && row.cut === null && row.strand === null)).toBe(true);
    const cutters = buildSiteRows(scan, PUC19, { ...all, cutCounts: ['unique', 'double', 'multiple'] }).rows;
    expect(cutters.some((row) => row.count === 0)).toBe(false);
  });

  it('filters by end type', () => {
    const { rows } = buildSiteRows(scan, PUC19, { ...all, cutCounts: ['unique'], endTypes: ['blunt'] });
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((row) => row.end === 'blunt')).toBe(true);
    expect(rows.some((row) => row.enzyme === 'SmaI')).toBe(true);
    expect(rows.some((row) => row.enzyme === 'EcoRI')).toBe(false);
  });

  it('filters by supplier code, so NEB gets the enzymes NEB sells', () => {
    const filtered = filterEnzymes(scan, { ...all, suppliers: ['N'] });
    expect(filtered.length).toBeGreaterThan(100);
    expect(filtered.every(({ enzyme }) => enzyme.suppliers.includes('N'))).toBe(true);
    expect(filtered.some(({ enzyme }) => enzyme.name === 'EcoRI')).toBe(true);
  });

  it('combines the filters', () => {
    const { rows } = buildSiteRows(scan, PUC19, {
      endTypes: ['five_prime'],
      cutCounts: ['unique'],
      suppliers: ['N'],
    });
    expect(rows.length).toBeGreaterThan(10);
    expect(
      rows.every((row) => row.end === 'five_prime' && row.count === 1 && row.suppliers.includes('N')),
    ).toBe(true);
  });

  it('starts on single cutters', () => {
    expect(DEFAULT_FILTER.cutCounts).toEqual(['unique']);
  });

  it('stops at the row limit, rarest cutters first, and still counts every cut', () => {
    const big = randomDna(300_000, 7);
    const bigScan = scanSites(big, 'linear', ENZYME_CATALOG);
    const built = buildSiteRows(bigScan, big, { ...all, cutCounts: ['multiple'] }, 500);
    expect(built.rows.length).toBeGreaterThanOrEqual(500);
    expect(built.rows.length).toBeLessThan(built.total);
    const counts = built.rows.map((row) => row.count);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    expect(MAX_ROWS).toBeGreaterThan(10_000);
  });
});

describe('site index', () => {
  const { rows } = buildSiteRows(scan, PUC19, { ...all, cutCounts: ['unique'] });
  const index = createSiteIndex(rows, PUC19.length);

  it('finds the rows whose recognition site overlaps a range', () => {
    const hit = index.overlapping(395, 396);
    expect([...hit].map((i) => rows[i]?.enzyme)).toContain('EcoRI');
    expect(index.overlapping(395, 395).size).toBe(0);
    expect([...index.overlapping(401, 402)].map((i) => rows[i]?.enzyme)).not.toContain('EcoRI');
  });

  it('matches a plain scan of every row', () => {
    for (const [start, end] of [
      [0, 50],
      [400, 460],
      [1000, 1100],
      [2600, 2686],
    ] as const) {
      const expected = rows
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => (row.siteStart as number) < end && (row.siteEnd as number) > start)
        .map(({ i }) => i)
        .sort((a, b) => a - b);
      expect([...index.overlapping(start, end)].sort((a, b) => a - b)).toEqual(expected);
    }
  });

  it('counts a site across the origin at both ends of the molecule', () => {
    const length = 100;
    const wrapRows = [
      {
        key: 'x',
        enzyme: 'X',
        recognition: 'GAATTC',
        count: 1,
        cut: 98,
        siteStart: 97,
        siteEnd: 103,
        strand: 1 as const,
        end: 'blunt' as const,
        overhang: '',
        suppliers: '',
      },
    ];
    const wrapIndex = createSiteIndex(wrapRows, length);
    expect(wrapIndex.overlapping(98, 99).size).toBe(1);
    expect(wrapIndex.overlapping(0, 2).size).toBe(1);
    expect(wrapIndex.overlapping(3, 10).size).toBe(0);
  });
});
