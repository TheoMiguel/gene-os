import { loadCoreGoldens, randomDna } from '../../tests/oracle/core-goldens';
import {
  atContent,
  codonUsage,
  countLetters,
  cumulativeGcSkew,
  gcContent,
  gcSkew,
  nucleotideSeries,
  nucleotideWeight,
  proteinWeight,
  purineContent,
  pyrimidineContent,
  slidingWindow,
} from './composition';

const goldens = loadCoreGoldens().composition;

describe('GC content (Bio.SeqUtils.gc_fraction)', () => {
  it('matches Biopython in all three ambiguity modes on random IUPAC DNA', () => {
    for (const c of goldens.gc) {
      expect(gcContent(c.seq, 'remove')).toBeCloseTo(c.remove, 12);
      expect(gcContent(c.seq, 'ignore')).toBeCloseTo(c.ignore, 12);
      expect(gcContent(c.seq, 'weighted')).toBeCloseTo(c.weighted, 12);
    }
  });

  it('matches Biopython on RNA', () => {
    for (const c of goldens.rnaGc) expect(gcContent(c.seq)).toBeCloseTo(c.remove, 12);
  });

  it('gives AT content as the share of A, T and U', () => {
    expect(atContent('AATTGC')).toBeCloseTo(4 / 6, 12);
    expect(atContent('AAUUGC')).toBeCloseTo(4 / 6, 12);
    expect(gcContent('')).toBe(0);
  });
});

describe('skew and purine content', () => {
  it('matches Bio.SeqUtils.GC_skew over the whole sequence', () => {
    for (const c of goldens.skewWhole) expect(gcSkew(c.seq)).toBeCloseTo(c.skew, 12);
  });

  it('is 0 when there is no G or C', () => {
    expect(gcSkew('AATT')).toBe(0);
  });

  it('computes purine and pyrimidine shares', () => {
    expect(purineContent('AAGCTT')).toBeCloseTo(0.5, 12);
    expect(pyrimidineContent('AAGCTT')).toBeCloseTo(0.5, 12);
    expect(purineContent('AAAA')).toBe(1);
  });

  it('counts letters case-insensitively', () => {
    expect(countLetters('aAcgN-')).toEqual({ '-': 1, A: 2, C: 1, G: 1, N: 1 });
  });
});

describe('sliding-window series', () => {
  it('matches Biopython and independent formulas for every chart series, linear and circular', () => {
    expect(goldens.series.length).toBeGreaterThan(30);
    for (const c of goldens.series) {
      const series = nucleotideSeries(c.seq, c.kind, {
        window: c.window,
        step: c.step,
        circular: c.circular,
      });
      expect(series.values).toHaveLength(c.points.length);
      c.points.forEach(([start, value], i) => {
        expect(series.starts[i]).toBe(start);
        expect(series.values[i]).toBeCloseTo(value, 9);
      });
    }
  });

  it('wraps windows over the origin on a circular sequence', () => {
    const series = nucleotideSeries('GGGGAAAA', 'gc', { window: 4, circular: true });
    expect([...series.values]).toEqual([1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75]);
  });

  it('emits no window when a linear sequence is shorter than the window', () => {
    expect(nucleotideSeries('ACG', 'gc', { window: 10 }).values).toHaveLength(0);
  });

  it('builds a generic series from any symbol coding', () => {
    const codes = Uint8Array.from([0, 1, 1, 0, 1]);
    const series = slidingWindow(codes, 2, (counts) => counts[1] as number, { window: 2 });
    expect([...series.values]).toEqual([1, 2, 1, 1]);
  });

  it('matches Biopython cumulative GC skew, including the short last window', () => {
    for (const c of goldens.partialSkew) {
      const skew = nucleotideSeries(c.seq, 'gcSkew', { window: c.window, step: c.window, partial: true });
      expect([...skew.values].map((v) => v)).toHaveLength(c.skew.length);
      c.skew.forEach((v, i) => expect(skew.values[i]).toBeCloseTo(v, 12));
      const cumulative = cumulativeGcSkew(c.seq, c.window);
      c.cumulative.forEach((v, i) => expect(cumulative.values[i]).toBeCloseTo(v, 12));
    }
  });

  it('bounds entropy between 0 and 2 bits', () => {
    expect(nucleotideSeries('AAAAAAAA', 'complexity', { window: 8 }).values[0]).toBe(0);
    expect(nucleotideSeries('ACGTACGT', 'complexity', { window: 8 }).values[0]).toBeCloseTo(2, 12);
  });
});

describe('molecular weight (Bio.SeqUtils.molecular_weight)', () => {
  it('matches Biopython for DNA and RNA, single and double stranded, linear and circular', () => {
    for (const c of goldens.mw) {
      for (const type of ['dna', 'rna'] as const) {
        for (const ds of ['ss', 'ds'] as const) {
          for (const topology of ['lin', 'circ'] as const) {
            const expected = c[`${type}_${ds}_${topology}`] as number;
            const rna = type === 'rna';
            const actual = nucleotideWeight(rna ? c.seq.replaceAll('T', 'U') : c.seq, {
              alphabet: type,
              doubleStranded: ds === 'ds',
              circular: topology === 'circ',
            });
            expect(actual).toBeCloseTo(expected, 6);
          }
        }
      }
    }
  });

  it('matches Biopython base by base', () => {
    for (const [base, weight] of Object.entries(goldens.singleBase)) {
      expect(nucleotideWeight(base)).toBeCloseTo(weight, 9);
    }
    for (const [base, weight] of Object.entries(goldens.singleBaseRna)) {
      expect(nucleotideWeight(base, { alphabet: 'rna' })).toBeCloseTo(weight, 9);
    }
  });

  it('weighs an ambiguity code as the mean of its bases', () => {
    expect(nucleotideWeight('R')).toBeCloseTo((331.2218 + 347.2212) / 2, 9);
    expect(nucleotideWeight('NN')).toBeCloseTo(
      ((331.2218 + 307.1971 + 347.2212 + 322.2085) / 4) * 2 - 18.0153,
      9,
    );
  });

  it('matches Biopython for protein, including the rare U and O residues', () => {
    for (const c of goldens.proteinMw) expect(proteinWeight(c.seq)).toBeCloseTo(c.mw, 6);
  });

  it('is 0 for an empty sequence', () => {
    expect(nucleotideWeight('')).toBe(0);
    expect(proteinWeight('*')).toBe(0);
  });
});

describe('codon usage', () => {
  it('matches a plain codon tally and RSCU from Biopython codon tables', () => {
    for (const c of goldens.codonUsage) {
      const usage = codonUsage(c.seq, { table: c.table, frame: c.frame });
      expect(usage.total).toBe(c.total);
      for (const row of usage.rows) {
        expect(row.count).toBe(c.counts[row.codon]);
        expect(row.rscu).toBeCloseTo(c.rscu[row.codon] as number, 12);
      }
    }
  });

  it('lists the 64 codons in table order with per-thousand frequencies', () => {
    const usage = codonUsage('ATGATGAAA');
    expect(usage.rows).toHaveLength(64);
    expect(usage.rows.find((r) => r.codon === 'ATG')).toMatchObject({ aminoAcid: 'M', count: 2, rscu: 1 });
    expect(usage.rows.find((r) => r.codon === 'ATG')?.perThousand).toBeCloseTo(666.667, 3);
    expect(usage.rows.find((r) => r.codon === 'AAA')?.rscu).toBe(2);
  });
});

describe('performance', () => {
  it('builds a GC series and counts codons on 5 Mb quickly', () => {
    const seq = randomDna(5_000_000, 5);
    const started = performance.now();
    const series = nucleotideSeries(seq, 'gc', { window: 1000, step: 1 });
    const tm = nucleotideSeries(seq, 'tm', { window: 20, step: 5, circular: true });
    const usage = codonUsage(seq);
    const elapsed = performance.now() - started;
    expect(series.values).toHaveLength(5_000_000 - 1000 + 1);
    expect(tm.values).toHaveLength(1_000_000);
    expect(usage.total).toBe(Math.floor(5_000_000 / 3));
    expect(elapsed).toBeLessThan(5000);
  });
});
