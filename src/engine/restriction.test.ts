import { PUC19, randomDna } from '../../tests/fixtures/restriction/fixtures';
import goldenJson from '../../tests/oracle/restriction.json';
import {
  cutSites,
  digest,
  ENZYME_CATALOG,
  type EnzymeSites,
  endType,
  filterSites,
  SUPPLIERS,
  scanSites,
  summarizeCutCounts,
} from './restriction';
import type { Enzyme, Topology } from './types';

interface RestrictionGolden {
  sequences: Record<string, string>;
  search: Record<string, Record<string, number[]>>;
  catalyse: Record<Topology, Record<string, number[]>>;
  digests: { enzymes: string[]; topology: Topology; lengths: number[] }[];
}
const golden = goldenJson as RestrictionGolden;

const SEQUENCES: Record<string, string> = { pUC19: PUC19, ...golden.sequences };

function enzyme(name: string): Enzyme {
  const found = ENZYME_CATALOG.find((e) => e.name === name);
  if (!found) throw new Error(`no enzyme ${name}`);
  return found;
}

function sitesOf(seq: string, topology: Topology, names: string[]): EnzymeSites[] {
  return [...scanSites(seq, topology, names.map(enzyme)).sites];
}

const sortedLengths = (seq: string, topology: Topology, sites: EnzymeSites[]) =>
  digest(seq, topology, sites)
    .map((f) => f.length)
    .sort((a, b) => a - b);

describe('enzyme catalog', () => {
  it('stores cut offsets from the site start on the top strand (REBASE notation)', () => {
    expect(enzyme('EcoRI')).toMatchObject({ site: 'GAATTC', topCut: 1, bottomCut: 5 });
    expect(enzyme('PstI')).toMatchObject({ site: 'CTGCAG', topCut: 5, bottomCut: 1 });
    expect(enzyme('EcoRV')).toMatchObject({ site: 'GATATC', topCut: 3, bottomCut: 3 });
    expect(enzyme('BsaI')).toMatchObject({ site: 'GGTCTC', topCut: 7, bottomCut: 11 });
    expect(enzyme('BbvCI')).toMatchObject({ site: 'CCTCAGC', topCut: 2, bottomCut: 5 });
    expect(['EcoRI', 'PstI', 'EcoRV', 'BsaI'].map((n) => endType(enzyme(n)))).toEqual([
      'five_prime',
      'three_prime',
      'blunt',
      'five_prime',
    ]);
  });

  it('holds the commercial single-cut enzymes with known suppliers and isoschizomer groups', () => {
    expect(ENZYME_CATALOG.length).toBe(607);
    expect(
      ENZYME_CATALOG.every((e) => e.suppliers.length > 0 && e.suppliers.every((s) => s in SUPPLIERS)),
    ).toBe(true);
    expect(SUPPLIERS.N).toBe('New England Biolabs');
    const group = ENZYME_CATALOG.filter((e) => e.isoschizomerOf === enzyme('SacI').isoschizomerOf);
    expect(group.map((e) => e.name)).toContain('SacI');
    expect(new Set(group.map((e) => `${e.site}/${e.topCut}/${e.bottomCut}`)).size).toBe(1);
  });
});

describe('scanSites agrees with Bio.Restriction search', () => {
  for (const view of Object.keys(golden.search)) {
    it(`finds the same cuts for every catalog enzyme on ${view}`, () => {
      const [seqName = '', topology] = view.split('/') as [string, Topology];
      const seq = SEQUENCES[seqName] ?? '';
      const expected = golden.search[view] ?? {};
      const scan = scanSites(seq, topology, ENZYME_CATALOG);
      const mismatches = scan.sites
        .map((s) => ({ name: s.enzyme.name, got: [...s.topCuts], want: expected[s.enzyme.name] ?? [] }))
        .filter(({ got, want }) => got.join() !== want.join());
      expect(mismatches).toEqual([]);
    });
  }
});

describe('digest agrees with Bio.Restriction catalyse', () => {
  for (const topology of ['linear', 'circular'] as const) {
    it(`gives the same fragment lengths for every catalog enzyme on ${topology} pUC19`, () => {
      const scan = scanSites(PUC19, topology, ENZYME_CATALOG);
      const expected = golden.catalyse[topology];
      const compared = scan.sites.filter((s) => s.enzyme.name in expected);
      const mismatches = compared
        .map((s) => ({
          name: s.enzyme.name,
          got: sortedLengths(PUC19, topology, [s]),
          want: expected[s.enzyme.name] ?? [],
        }))
        .filter(({ got, want }) => got.join() !== want.join());
      expect(mismatches).toEqual([]);
      // The oracle drops the few circular results where Biopython's own fragments do not add up.
      expect(compared.length).toBeGreaterThan(ENZYME_CATALOG.length - 10);
    });
  }

  it.each(golden.digests)('digests pUC19 with $enzymes ($topology) like the union of Biopython cuts', (d) => {
    expect(sortedLengths(PUC19, d.topology, sitesOf(PUC19, d.topology, d.enzymes))).toEqual(d.lengths);
  });
});

describe('cut sites', () => {
  it('finds a site across the origin of a circular molecule, and not on the linear one', () => {
    // GAATTC split over the origin: the site starts at the last base.
    const seq = 'AATTCTTTTTTTTTTTG';
    const [ecoRI] = sitesOf(seq, 'circular', ['EcoRI']);
    expect(ecoRI && cutSites(seq, 'circular', ecoRI)).toEqual([
      {
        enzyme: 'EcoRI',
        topCut: 0,
        bottomCut: 4,
        siteStart: 16,
        siteStrand: 1,
        end: 'five_prime',
        overhang: 'AATT',
      },
    ]);
    expect(sitesOf(seq, 'linear', ['EcoRI'])[0]?.topCuts.length).toBe(0);
  });

  it('reports end type and top-strand overhang for 5′, 3′ and blunt cutters', () => {
    const seq = 'TTTTGAATTCTTTTCTGCAGTTTTGATATCTTTT';
    const [ecoRI, pstI, ecoRV] = sitesOf(seq, 'linear', ['EcoRI', 'PstI', 'EcoRV']).map((s) =>
      cutSites(seq, 'linear', s),
    );
    expect(ecoRI).toMatchObject([{ topCut: 5, bottomCut: 9, end: 'five_prime', overhang: 'AATT' }]);
    expect(pstI).toMatchObject([{ topCut: 19, bottomCut: 15, end: 'three_prime', overhang: 'TGCA' }]);
    expect(ecoRV).toMatchObject([{ topCut: 27, bottomCut: 27, end: 'blunt', overhang: '' }]);
  });

  it('cuts outside the site for Type IIS enzymes on either strand (BsaI GGTCTC(1/5))', () => {
    const seq = 'AAAAAAAAGGTCTCACGTACCCCCCCCCCGTGCAGAGACCTTTTTTTT';
    const [bsaI] = sitesOf(seq, 'linear', ['BsaI']);
    expect(bsaI && cutSites(seq, 'linear', bsaI)).toMatchObject([
      { siteStart: 8, siteStrand: 1, topCut: 15, bottomCut: 19, overhang: 'CGTA' },
      { siteStart: 34, siteStrand: -1, topCut: 29, bottomCut: 33, overhang: 'GTGC' },
    ]);
  });

  it('counts a palindromic site once', () => {
    expect(sitesOf('TTGAATTCTT', 'linear', ['EcoRI'])[0]?.topCuts.length).toBe(1);
  });

  it('counts a degenerate palindromic site once per occurrence', () => {
    const degenerate: Enzyme = { name: 'Degenerate', site: 'CASTG', topCut: 2, bottomCut: 3, suppliers: [] };
    const seq = `${'T'.repeat(10)}CACTG${'T'.repeat(10)}CAGTG${'T'.repeat(10)}`;
    expect([...scanSites(seq, 'linear', [degenerate]).sites][0]?.topCuts.length).toBe(2);
  });

  it('finds a non-palindromic site on both strands', () => {
    const seq = `${'T'.repeat(20)}GGTCTC${'A'.repeat(30)}GAGACC${'T'.repeat(20)}`;
    expect(sitesOf(seq, 'linear', ['BsaI'])[0]?.topCuts.length).toBe(2);
  });
});

describe('summaries and filters', () => {
  const scan = scanSites(PUC19, 'circular', ENZYME_CATALOG);

  it('groups enzymes by cut count', () => {
    const summary = summarizeCutCounts(scan);
    expect(summary.unique).toContain('EcoRI');
    expect(summary.unique).toContain('HindIII');
    expect(summary.non_cutter).toContain('NotI');
    expect(summary.double).toContain('PvuII');
    expect(summary.multiple).toContain('MspI');
    const total = Object.values(summary).reduce((n, names) => n + names.length, 0);
    expect(total).toBe(ENZYME_CATALOG.length);
  });

  it('filters by end type, cut count and supplier together', () => {
    const kept = filterSites(scan.sites, { endTypes: ['blunt'], cutCounts: ['unique'], suppliers: ['N'] });
    expect(kept.length).toBeGreaterThan(0);
    for (const s of kept) {
      expect(endType(s.enzyme)).toBe('blunt');
      expect(s.topCuts.length).toBe(1);
      expect(s.enzyme.suppliers).toContain('N');
    }
    expect(kept.map((s) => s.enzyme.name)).not.toContain('EcoRI');
    expect(filterSites(scan.sites, {})).toHaveLength(scan.sites.length);
  });
});

describe('digest fragments', () => {
  it('gives each fragment of a linear double digest its two ends', () => {
    const fragments = digest(PUC19, 'linear', sitesOf(PUC19, 'linear', ['EcoRI', 'HindIII']));
    expect(fragments.map((f) => f.length)).toEqual([396, 51, 2239]);
    expect(fragments[0]?.leftEnd).toEqual({ kind: 'terminus' });
    expect(fragments[1]).toMatchObject({
      location: { segments: [{ start: 396, end: 447 }], strand: 1 },
      leftEnd: { kind: 'cut', enzyme: 'EcoRI', end: 'five_prime', overhang: 'AATT' },
      rightEnd: { kind: 'cut', enzyme: 'HindIII', end: 'five_prime', overhang: 'AGCT' },
    });
    expect(fragments[2]?.rightEnd).toEqual({ kind: 'terminus' });
  });

  it('splits the fragment across the origin of a circular molecule into two segments', () => {
    const fragments = digest(PUC19, 'circular', sitesOf(PUC19, 'circular', ['EcoRI', 'HindIII']));
    expect(fragments.map((f) => f.length)).toEqual([51, 2635]);
    expect(fragments[1]?.location.segments).toEqual([
      { start: 447, end: 2686 },
      { start: 0, end: 396 },
    ]);
  });

  it('linearises a circle with one cut and keeps an uncut molecule whole', () => {
    const [single] = digest(PUC19, 'circular', sitesOf(PUC19, 'circular', ['EcoRI']));
    expect(single).toMatchObject({
      length: 2686,
      leftEnd: { enzyme: 'EcoRI' },
      rightEnd: { enzyme: 'EcoRI' },
    });
    expect(digest(PUC19, 'linear', sitesOf(PUC19, 'linear', ['NotI']))).toEqual([
      {
        location: { segments: [{ start: 0, end: 2686 }], strand: 1 },
        length: 2686,
        leftEnd: { kind: 'terminus' },
        rightEnd: { kind: 'terminus' },
      },
    ]);
  });
});

describe('performance', { timeout: 60_000 }, () => {
  it('scans a 5 Mb circular sequence with the full catalog in linear time', () => {
    const seq = randomDna(5_000_000, 12345);
    const started = performance.now();
    const scan = scanSites(seq, 'circular', ENZYME_CATALOG);
    const elapsed = performance.now() - started;
    const ecoRI = scan.sites.find((s) => s.enzyme.name === 'EcoRI');
    // A random sequence has one GAATTC per 4^6 bases.
    expect(ecoRI?.topCuts.length).toBeGreaterThan(5_000_000 / 4096 / 2);
    expect(elapsed).toBeLessThan(15_000);
  }, 60_000);
});
