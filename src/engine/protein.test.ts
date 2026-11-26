import { loadCoreGoldens } from '../../tests/oracle/core-goldens';
import {
  aromaticity,
  extinctionCoefficient,
  gravy,
  hydropathyProfile,
  instabilityIndex,
  isoelectricPoint,
  netCharge,
  standardResidues,
} from './protein';

const goldens = loadCoreGoldens().protein;

/** Biopython agreement bar from the brief: equal to 2 decimals. */
function expectTwoDecimals(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(0.005);
}

describe('ProteinAnalysis agreement (Bio.SeqUtils.ProtParam)', () => {
  it('matches pI, charge at three pH values, extinction, instability, GRAVY and aromaticity on random proteins', () => {
    expect(goldens.cases.length).toBeGreaterThan(50);
    for (const c of goldens.cases) {
      expectTwoDecimals(isoelectricPoint(c.seq), c.pi);
      expectTwoDecimals(netCharge(c.seq, 7.4), c.charge74);
      expectTwoDecimals(netCharge(c.seq, 5), c.charge5);
      expectTwoDecimals(netCharge(c.seq, 10), c.charge10);
      expect(extinctionCoefficient(c.seq)).toEqual({ reduced: c.reduced, cystine: c.cystine });
      expectTwoDecimals(instabilityIndex(c.seq), c.instability);
      expectTwoDecimals(gravy(c.seq), c.gravy);
      expectTwoDecimals(aromaticity(c.seq), c.aromaticity);
    }
  });

  it('is exact where it replays Biopython bisection: pI agrees to 1e-9', () => {
    for (const c of goldens.cases) expect(isoelectricPoint(c.seq)).toBeCloseTo(c.pi, 9);
  });

  it('matches for every N-terminal and C-terminal residue that has its own pK', () => {
    for (const c of goldens.termini) {
      expectTwoDecimals(isoelectricPoint(c.seq), c.pi);
      expectTwoDecimals(netCharge(c.seq), c.charge74);
    }
  });

  it('matches the instability weight of all 400 dipeptides', () => {
    expect(goldens.dipeptides).toHaveLength(400);
    for (const c of goldens.dipeptides) expect(instabilityIndex(c.seq)).toBeCloseTo(c.instability, 9);
  });

  it('matches the Kyte-Doolittle value of each residue', () => {
    for (const c of goldens.residues) expect(gravy(c.seq)).toBeCloseTo(c.gravy, 9);
  });

  it('matches the hydropathy profile for odd windows (protein_scale with edge 1)', () => {
    for (const c of goldens.profiles) {
      const profile = hydropathyProfile(c.seq, c.window);
      expect(profile.values).toHaveLength(c.values.length);
      c.values.forEach((v, i) => expect(profile.values[i]).toBeCloseTo(v, 9));
    }
  });
});

describe('input handling', () => {
  it('ignores stop codons, gaps and non-standard letters', () => {
    expect(standardResidues('mk*XB-v')).toBe('MKV');
    expect(gravy('MKV*')).toBeCloseTo(gravy('MKV'), 12);
  });

  it('defaults the pH to 7.4', () => {
    expect(netCharge('KKDE')).toBeCloseTo(netCharge('KKDE', 7.4), 12);
  });

  it('gives neutral results for an empty protein', () => {
    expect(netCharge('')).toBe(0);
    expect(Number.isNaN(isoelectricPoint(''))).toBe(true);
    expect(instabilityIndex('')).toBe(0);
  });

  it('reports both extinction forms for a known protein', () => {
    expect(extinctionCoefficient('WYCC')).toEqual({ reduced: 6990, cystine: 7115 });
  });
});
