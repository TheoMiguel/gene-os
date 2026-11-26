const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('missing value');
  return value;
};

import golden from '../../../../tests/oracle/codon.json';
import { codonUsageFromCounts } from '../../../engine/composition';
import { CODON_ORDER } from '../../../engine/translate';
import { REFERENCE_SOURCE, REFERENCE_TABLES } from './references';
import {
  codonAdaptationIndex,
  compareWithReference,
  referenceRows,
  relativeAdaptiveness,
  withFamilyShare,
} from './usage';

const fromCounts = (counts: Record<string, number>) =>
  codonUsageFromCounts(CODON_ORDER.map((codon) => counts[codon] ?? 0)).rows;

describe('reference tables (Codon Usage Database, Kazusa)', () => {
  it('has the six expression hosts, each with 64 codons that add up to the published total', () => {
    const hosts = REFERENCE_TABLES.map((table) => table.host);
    for (const host of ['E. coli K-12', 'S. cerevisiae', 'Human', 'CHO', 'P. pastoris'])
      expect(hosts, host).toContain(host);
    expect(hosts.some((host) => host.startsWith('Insect'))).toBe(true);
    for (const table of REFERENCE_TABLES) {
      expect(Object.keys(table.counts).sort(), table.id).toEqual([...CODON_ORDER].sort());
      expect(
        Object.values(table.counts).reduce((sum, n) => sum + n, 0),
        table.id,
      ).toBe(table.codons);
      expect(table.url, table.id).toMatch(/^https:\/\/www\.kazusa\.or\.jp\/codon\//);
    }
    expect(REFERENCE_SOURCE.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reproduces the per-thousand values the database page prints', () => {
    const rows = (id: string) => referenceRows(must(REFERENCE_TABLES.find((table) => table.id === id)));
    const perThousand = (id: string, codon: string) =>
      must(rows(id).find((row) => row.codon === codon)).perThousand;
    // Values read from showcodon.cgi?species=9606 and ?species=316407.
    expect(perThousand('human', 'TTT')).toBeCloseTo(17.6, 1);
    expect(perThousand('human', 'GAT')).toBeCloseTo(21.8, 1);
    expect(perThousand('ecoli-k12', 'GAT')).toBeCloseTo(32.2, 1);
    expect(perThousand('ecoli-k12', 'ATT')).toBeCloseTo(30.4, 1);
  });
});

describe('codon adaptation index against Bio.SeqUtils.CodonAdaptationIndex (Biopython 1.88)', () => {
  it.each(golden.cases.map((c, i) => [i, c] as const))('case %i: adaptiveness and index', (_i, c) => {
    const reference = fromCounts(c.counts);
    const w = relativeAdaptiveness(reference);
    for (const [codon, expected] of Object.entries(c.w))
      expect(w.get(codon), codon).toBeCloseTo(expected, 12);

    const tally = Object.fromEntries(CODON_ORDER.map((codon) => [codon, 0]));
    for (let i = 0; i < c.sequence.length; i += 3)
      tally[c.sequence.slice(i, i + 3)] = must(tally[c.sequence.slice(i, i + 3)]) + 1;
    expect(codonAdaptationIndex(fromCounts(tally), w)).toBeCloseTo(c.cai, 12);
  });

  it('leaves out Met, Trp and stop codons and reports null when nothing is left', () => {
    const w = relativeAdaptiveness(fromCounts({ ATG: 5, TGG: 5, TAA: 3 }));
    expect(codonAdaptationIndex(fromCounts({ ATG: 4, TGG: 2, TAA: 1 }), w)).toBeNull();
  });
});

describe('family share and comparison', () => {
  it('gives each codon its share inside its amino-acid family', () => {
    const rows = withFamilyShare(fromCounts({ GAA: 3, GAG: 1, ATG: 7 }));
    const share = (codon: string) => must(rows.find((row) => row.codon === codon)).share;
    expect(share('GAA')).toBe(0.75);
    expect(share('GAG')).toBe(0.25);
    expect(share('ATG')).toBe(1);
    expect(share('AAA')).toBe(0);
  });

  it('compares a codon tally with a table: difference is own minus reference, per thousand', () => {
    const table = must(REFERENCE_TABLES.find((candidate) => candidate.id === 'ecoli-k12'));
    const reference = referenceRows(table);
    const observed = withFamilyShare(fromCounts({ CTG: 10 }));
    const compared = compareWithReference(observed, table);
    const ctg = must(compared.find((row) => row.codon === 'CTG'));
    const refCtg = must(reference.find((row) => row.codon === 'CTG'));
    expect(ctg.perThousand).toBe(1000);
    expect(ctg.referencePerThousand).toBeCloseTo(refCtg.perThousand, 12);
    expect(ctg.difference).toBeCloseTo(1000 - refCtg.perThousand, 9);
    expect(ctg.adaptiveness).toBe(1);
  });
});
