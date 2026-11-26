import { PUC19 } from '../../tests/fixtures/restriction/fixtures';
import goldenJson from '../../tests/oracle/primers.json';
import {
  analyzePair,
  analyzePrimer,
  DEFAULT_DESIGN,
  DIMER_DG_LIMIT,
  designPrimers,
  dimer,
  endStability,
  gcPercent,
  HAIRPIN_DG_LIMIT,
  hairpin,
  PRIMER3_CONDITIONS,
  tmBiopythonNN,
  tmGC,
  tmNearestNeighbor,
  tmWallace,
} from './primers';
import type { PrimerConditions } from './types';

interface PrimerGolden {
  customConditions: { mv_conc: number; dv_conc: number; dntp_conc: number; dna_conc: number };
  tm: {
    seq: string;
    primer3: number;
    primer3Custom: number;
    biopythonNN: number;
    biopythonNNMg: number;
    wallace: number;
    gc: number;
  }[];
  endStability: { seq: string; primer3: number }[];
  structures: {
    hairpin: { seq: string; dg: number }[];
    homodimer: { seq: string; dg: number }[];
    heterodimer: { a: string; b: string; dg: number }[];
  };
  design: {
    target: { start: number; length: number };
    settings: Record<string, number | number[][]>;
    pairs: {
      left: string;
      right: string;
      leftTm: number;
      rightTm: number;
      productSize: number;
      penalty: number;
    }[];
  };
}
const golden = goldenJson as PrimerGolden;

const maxError = (pairs: [number, number][]) => Math.max(...pairs.map(([got, want]) => Math.abs(got - want)));

describe('melting temperature', () => {
  it('matches primer3 calc_tm with default conditions within 0.5 °C (including >60 nt and symmetric oligos)', () => {
    expect(maxError(golden.tm.map((t) => [tmNearestNeighbor(t.seq), t.primer3]))).toBeLessThan(0.01);
  });

  it('matches primer3 calc_tm with non-default salt and oligo concentrations', () => {
    const c = golden.customConditions;
    const conditions: PrimerConditions = {
      naMm: c.mv_conc,
      mgMm: c.dv_conc,
      dntpMm: c.dntp_conc,
      oligoNm: c.dna_conc,
    };
    expect(
      maxError(golden.tm.map((t) => [tmNearestNeighbor(t.seq, conditions), t.primer3Custom])),
    ).toBeLessThan(0.01);
  });

  it('matches Biopython Tm_NN (defaults, and with Mg2+/dNTPs), Tm_Wallace and Tm_GC', () => {
    const short = golden.tm.filter((t) => t.seq.length <= 60);
    expect(maxError(short.map((t) => [tmBiopythonNN(t.seq), t.biopythonNN]))).toBeLessThan(0.01);
    expect(
      maxError(
        short.map((t) => [tmBiopythonNN(t.seq, { naMm: 50, mgMm: 1.5, dntpMm: 0.6 }), t.biopythonNNMg]),
      ),
    ).toBeLessThan(0.01);
    expect(maxError(golden.tm.map((t) => [tmWallace(t.seq), t.wallace]))).toBe(0);
    expect(maxError(golden.tm.map((t) => [tmGC(t.seq), t.gc]))).toBeLessThan(1e-9);
  });

  it('computes GC percent', () => {
    expect(gcPercent('GCGCAT')).toBeCloseTo(66.667, 3);
    expect(gcPercent('')).toBe(0);
  });
});

describe("3' end stability", () => {
  it('matches primer3 PRIMER_LEFT_0_END_STABILITY (deltaG of the last 5 bases)', () => {
    expect(golden.endStability.length).toBeGreaterThan(30);
    expect(maxError(golden.endStability.map((e) => [endStability(e.seq), e.primer3]))).toBeLessThan(0.006);
  });
});

/**
 * Problem verdicts (deltaG at or below the threshold) compared with primer3 thal. `far` lists disagreements
 * where primer3's own deltaG lies more than `margin` kcal/mol from the threshold; `missed` keeps only those
 * where primer3 flags a problem and this model does not.
 */
function verdicts(cases: readonly { got: number; want: number }[], threshold: number, margin: number) {
  const disagree = cases.filter((c) => c.got <= threshold !== c.want <= threshold);
  const far = disagree.filter((c) => Math.abs(c.want - threshold) > margin);
  return { rate: 1 - disagree.length / cases.length, far, missed: far.filter((c) => c.want <= threshold) };
}

describe('secondary structures agree with primer3 thal', () => {
  const hairpins = golden.structures.hairpin.map((h) => ({ seq: h.seq, got: hairpin(h.seq).dg, want: h.dg }));
  const homodimers = golden.structures.homodimer.map((h) => ({
    seq: h.seq,
    got: dimer(h.seq, h.seq).dg,
    want: h.dg,
  }));
  const heterodimers = golden.structures.heterodimer.map((h) => ({
    seq: `${h.a}/${h.b}`,
    got: dimer(h.a, h.b).dg,
    want: h.dg,
  }));

  it.each([
    ['calc_homodimer', homodimers],
    ['calc_heterodimer', heterodimers],
  ] as const)(
    '%s: same verdict at -6 kcal/mol for 95 percent of cases, none wrong 1.5 kcal/mol away',
    (_, cases) => {
      const { rate, far } = verdicts(cases, DIMER_DG_LIMIT, 1.5);
      expect(far).toEqual([]);
      expect(rate).toBeGreaterThanOrEqual(0.95);
    },
  );

  it('calc_hairpin: same verdict at -3 kcal/mol for 95 percent of cases, no primer3 problem missed', () => {
    // thal keeps the highest-Tm fold, which can be weaker than the lowest-deltaG fold kept here, so the only
    // allowed far disagreements are folds this model finds more stable than primer3 does.
    const { rate, far, missed } = verdicts(hairpins, HAIRPIN_DG_LIMIT, 1.5);
    expect(missed).toEqual([]);
    expect(far.every((c) => c.got < c.want)).toBe(true);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  it.each([
    ['calc_hairpin', hairpins, 0.85],
    ['calc_homodimer', homodimers, 0.9],
    ['calc_heterodimer', heterodimers, 0.9],
  ] as const)(
    '%s: deltaG within 1 kcal/mol of primer3 for the stated share of stable structures (< -2)',
    (_, cases, share) => {
      const stable = cases.filter((c) => c.want < -2);
      const close = stable.filter((c) => Math.abs(c.got - c.want) <= 1);
      expect(stable.length).toBeGreaterThan(20);
      expect(close.length / stable.length).toBeGreaterThanOrEqual(share);
    },
  );

  it('reports the offending alignment', () => {
    const result = dimer('AAAAGAATTCAAAA', 'TTTTGAATTCTTTT');
    expect(result.dg).toBeLessThan(-8);
    expect(result.pairs).toContainEqual([4, 9]);
    expect(result.alignment[1]).toContain('||||||');
    const fold = hairpin('GGGGCCCAAAAGGGCCCC');
    expect(fold.dotBracket).toMatch(/^\(+\.+\)+$/);
  });
});

describe('analyzePrimer', () => {
  it('reports Tm, GC, end stability, structure verdicts and binding sites on the template', () => {
    const m13Forward = 'GTAAAACGACGGCCAGT';
    const analysis = analyzePrimer(m13Forward, { template: { seq: PUC19, topology: 'circular' } });
    expect(analysis.length).toBe(17);
    expect(analysis.tm).toBeCloseTo(tmNearestNeighbor(m13Forward), 10);
    expect(analysis.tmBasic.wallace).toBe(52);
    expect(analysis.hairpin.problem).toBe(false);
    expect(analysis.bindingSites?.filter((s) => s.mismatches === 0)).toHaveLength(1);
  });

  it('flags a self-complementary primer as a self-dimer problem', () => {
    expect(analyzePrimer('GCGCGAATTCGCGC').selfDimer.problem).toBe(true);
    expect(analyzePair('GCGCGAATTCGCGC', 'ATATATATATATAT').crossDimer.problem).toBe(false);
  });
});

describe('designPrimers', () => {
  const target = {
    start: golden.design.target.start,
    end: golden.design.target.start + golden.design.target.length,
  };
  const constraints = { ...DEFAULT_DESIGN, productSize: { min: 350, max: 600 } };
  const pairs = designPrimers(PUC19, target, constraints);

  it('returns several pairs that meet every constraint and cover the target', () => {
    expect(pairs.length).toBe(constraints.count);
    for (const pair of pairs) {
      for (const primer of [pair.forward, pair.reverse]) {
        const length = primer.seq.length;
        expect(length).toBeGreaterThanOrEqual(constraints.length.min);
        expect(length).toBeLessThanOrEqual(constraints.length.max);
        expect(primer.tm).toBeGreaterThanOrEqual(constraints.tm.min);
        expect(primer.tm).toBeLessThanOrEqual(constraints.tm.max);
        expect(primer.gcPercent).toBeGreaterThanOrEqual(constraints.gc.min);
        expect(primer.gcPercent).toBeLessThanOrEqual(constraints.gc.max);
        expect(hairpin(primer.seq).dg).toBeGreaterThanOrEqual(constraints.minStructureDg);
        expect(dimer(primer.seq, primer.seq).dg).toBeGreaterThanOrEqual(constraints.minStructureDg);
      }
      expect(pair.forward.seq).toBe(PUC19.slice(pair.forward.span.start, pair.forward.span.end));
      expect(pair.forward.span.end).toBeLessThanOrEqual(target.start);
      expect(pair.reverse.span.start).toBeGreaterThanOrEqual(target.end);
      expect(pair.productSize).toBe(pair.reverse.span.end - pair.forward.span.start);
      expect(pair.productSize).toBeGreaterThanOrEqual(350);
      expect(pair.productSize).toBeLessThanOrEqual(600);
      expect(pair.deltaTm).toBeLessThanOrEqual(constraints.maxDeltaTm);
      expect(dimer(pair.forward.seq, pair.reverse.seq).dg).toBeGreaterThanOrEqual(constraints.minStructureDg);
    }
  });

  it('ranks pairs by non-decreasing penalty', () => {
    const penalties = pairs.map((p) => p.penalty);
    expect(penalties).toEqual([...penalties].sort((a, b) => a - b));
  });

  it("is as good as primer3 design_primers' top pair on the primer3 Tm/length penalty", () => {
    // primer3 default penalty: |Tm - 60| + |length - 20| per primer (PRIMER_WT_TM_*, PRIMER_WT_SIZE_* = 1).
    const core = (seq: string) => Math.abs(tmNearestNeighbor(seq) - 60) + Math.abs(seq.length - 20);
    const top = pairs[0];
    const reference = golden.design.pairs[0];
    expect(top && reference).toBeTruthy();
    if (!top || !reference) return;
    expect(core(reference.left) + core(reference.right)).toBeCloseTo(reference.penalty, 2);
    expect(core(top.forward.seq) + core(top.reverse.seq)).toBeLessThanOrEqual(reference.penalty + 0.5);
  });
});

describe('primer3 default conditions', () => {
  it('are 50 mM Na+, 1.5 mM Mg2+, 0.6 mM dNTP, 50 nM oligo', () => {
    expect(PRIMER3_CONDITIONS).toEqual({ naMm: 50, mgMm: 1.5, dntpMm: 0.6, oligoNm: 50 });
  });
});
