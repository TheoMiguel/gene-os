import { AMINO_ACIDS, encodeResidues } from './alphabet';
import { slidingWindow, type WindowSeries } from './composition';

/** Keeps the 20 standard residues; every protein measure here ignores other letters (stop `*`, X, B, Z, gaps). */
export function standardResidues(seq: string): string {
  let out = '';
  for (const ch of seq.toUpperCase()) if (AMINO_ACIDS.includes(ch)) out += ch;
  return out;
}

function residueCounts(seq: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ch of seq) counts[ch] = (counts[ch] ?? 0) + 1;
  return counts;
}

// pK values of Bjellqvist et al. (Electrophoresis 1993), as shipped in Bio.SeqUtils.IsoelectricPoint (Biopython 1.88).
const POSITIVE_PK = { Nterm: 7.5, K: 10.0, R: 12.0, H: 5.98 } as const;
const NEGATIVE_PK = { Cterm: 3.55, D: 4.05, E: 4.45, C: 9.0, Y: 10.0 } as const;
const C_TERMINAL_PK: Readonly<Record<string, number>> = { D: 4.55, E: 4.75 };
const N_TERMINAL_PK: Readonly<Record<string, number>> = {
  A: 7.59,
  M: 7.0,
  S: 6.93,
  P: 8.36,
  T: 6.82,
  V: 7.44,
  E: 7.7,
};

const DEFAULT_PH = 7.4;

interface ChargeModel {
  readonly positive: readonly (readonly [count: number, pK: number])[];
  readonly negative: readonly (readonly [count: number, pK: number])[];
}

function chargeModel(protein: string): ChargeModel {
  const counts = residueCounts(protein);
  const n = (aa: string) => counts[aa] ?? 0;
  const first = protein[0] as string;
  const last = protein[protein.length - 1] as string;
  return {
    positive: [
      [1, N_TERMINAL_PK[first] ?? POSITIVE_PK.Nterm],
      [n('K'), POSITIVE_PK.K],
      [n('R'), POSITIVE_PK.R],
      [n('H'), POSITIVE_PK.H],
    ],
    negative: [
      [1, C_TERMINAL_PK[last] ?? NEGATIVE_PK.Cterm],
      [n('D'), NEGATIVE_PK.D],
      [n('E'), NEGATIVE_PK.E],
      [n('C'), NEGATIVE_PK.C],
      [n('Y'), NEGATIVE_PK.Y],
    ],
  };
}

function chargeAt(model: ChargeModel, pH: number): number {
  let charge = 0;
  for (const [count, pK] of model.positive) charge += count / (10 ** (pH - pK) + 1);
  for (const [count, pK] of model.negative) charge -= count / (10 ** (pK - pH) + 1);
  return charge;
}

/**
 * Net charge of a protein at a pH (default 7.4), Henderson-Hasselbalch over K, R, H, D, E, C, Y and both termini.
 * Oracle: `ProteinAnalysis.charge_at_pH`. Returns 0 for an empty protein.
 */
export function netCharge(seq: string, pH = DEFAULT_PH): number {
  const protein = standardResidues(seq);
  return protein.length === 0 ? 0 : chargeAt(chargeModel(protein), pH);
}

/**
 * Isoelectric point by the same bisection Biopython uses (start 7.775 inside 4.05..12, stop below 0.0001 wide).
 * Oracle: `ProteinAnalysis.isoelectric_point`. Returns NaN for an empty protein.
 */
export function isoelectricPoint(seq: string): number {
  const protein = standardResidues(seq);
  if (protein.length === 0) return Number.NaN;
  const model = chargeModel(protein);
  let pH = 7.775;
  let low = 4.05;
  let high = 12;
  while (high - low > 0.0001) {
    if (chargeAt(model, pH) > 0) low = pH;
    else high = pH;
    pH = (low + high) / 2;
  }
  return pH;
}

export interface ExtinctionCoefficient {
  /** M^-1 cm^-1 at 280 nm with every Cys reduced. */
  readonly reduced: number;
  /** M^-1 cm^-1 at 280 nm with every Cys pair as a cystine. */
  readonly cystine: number;
}

/**
 * Molar extinction coefficient at 280 nm: 5500 per Trp, 1490 per Tyr, plus 125 per cystine (Pace et al. 1995).
 * Oracle: `ProteinAnalysis.molar_extinction_coefficient`.
 */
export function extinctionCoefficient(seq: string): ExtinctionCoefficient {
  const counts = residueCounts(standardResidues(seq));
  const reduced = (counts.W ?? 0) * 5500 + (counts.Y ?? 0) * 1490;
  return { reduced, cystine: reduced + Math.floor((counts.C ?? 0) / 2) * 125 };
}

/** Dipeptide instability weights DIWV of Guruprasad et al. 1990, `[first][second]` in `AMINO_ACIDS` order. */
const DIWV: readonly (readonly number[])[] = [
  [1, 44.94, -7.49, 1, 1, 1, -7.49, 1, 1, 1, 1, 1, 20.26, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 20.26, 1, 1, 1, 33.6, 1, 1, 20.26, 33.6, 1, 20.26, -6.54, 1, 1, 33.6, -6.54, 24.68, 1],
  [1, 1, 1, 1, -6.54, 1, 1, 1, -7.49, 1, 1, 1, 1, 1, -6.54, 20.26, -14.03, 1, 1, 1],
  [1, 44.94, 20.26, 33.6, 1, 1, -6.54, 20.26, 1, 1, 1, 1, 20.26, 20.26, 1, 20.26, 1, 1, -14.03, 1],
  [1, 1, 13.34, 1, 1, 1, 1, 1, -14.03, 1, 1, 1, 20.26, 1, 1, 1, 1, 1, 1, 33.601],
  [-7.49, 1, 1, -6.54, 1, 13.34, 1, -7.49, -7.49, 1, 1, -7.49, 1, 1, 1, 1, -7.49, 1, 13.34, -7.49],
  [1, 1, 1, 1, -9.37, -9.37, 1, 44.94, 24.68, 1, 1, 24.68, -1.88, 1, 1, 1, -6.54, 1, -1.88, 44.94],
  [1, 1, 1, 44.94, 1, 1, 13.34, 1, -7.49, 20.26, 1, 1, -1.88, 1, 1, 1, 1, -7.49, 1, 1],
  [1, 1, 1, 1, 1, -7.49, 1, -7.49, 1, -7.49, 33.6, 1, -6.54, 24.64, 33.6, 1, 1, -7.49, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, -7.49, 1, 1, 1, 20.26, 33.6, 20.26, 1, 1, 1, 24.68, 1],
  [13.34, 1, 1, 1, 1, 1, 58.28, 1, 1, 1, -1.88, 1, 44.94, -6.54, -6.54, 44.94, -1.88, 1, 1, 24.68],
  [1, -1.88, 1, 1, -14.03, -14.03, 1, 44.94, 24.68, 1, 1, 1, -1.88, -6.54, 1, 1, -7.49, 1, -9.37, 1],
  [
    20.26, -6.54, -6.54, 18.38, 20.26, 1, 1, 1, 1, 1, -6.54, 1, 20.26, 20.26, -6.54, 20.26, 1, 20.26, -1.88,
    1,
  ],
  [1, -6.54, 20.26, 20.26, -6.54, 1, 1, 1, 1, 1, 1, 1, 20.26, 20.26, 1, 44.94, 1, -6.54, 1, -6.54],
  [1, 1, 1, 1, 1, -7.49, 20.26, 1, 1, 1, 1, 13.34, 20.26, 20.26, 58.28, 44.94, 1, 1, 58.28, -6.54],
  [1, 33.6, 1, 20.26, 1, 1, 1, 1, 1, 1, 1, 1, 44.94, 20.26, 20.26, 20.26, 1, 1, 1, 1],
  [1, 1, 1, 20.26, 13.34, -7.49, 1, 1, 1, 1, 1, -14.03, 1, -6.54, 1, 1, 1, 1, -14.03, 1],
  [1, 1, -14.03, 1, 1, -7.49, 1, 1, -1.88, 1, 1, 1, 20.26, 1, 1, 1, -7.49, 1, 1, -6.54],
  [-14.03, 1, 1, 1, 1, -9.37, 24.68, 1, 1, 13.34, 24.68, 13.34, 1, 1, 1, 1, -14.03, -7.49, 1, 1],
  [24.68, 1, 24.68, -6.54, 1, -7.49, 13.34, 1, 1, 1, 44.94, 1, 13.34, 1, -15.91, 1, -7.49, 1, -9.37, 13.34],
];

/**
 * Instability index of Guruprasad et al. 1990; above 40 predicts an unstable protein.
 * Oracle: `ProteinAnalysis.instability_index`. Returns 0 for a protein shorter than two residues.
 */
export function instabilityIndex(seq: string): number {
  const protein = standardResidues(seq);
  let score = 0;
  for (let i = 0; i + 1 < protein.length; i++) {
    const row = DIWV[AMINO_ACIDS.indexOf(protein[i] as string)] as readonly number[];
    score += row[AMINO_ACIDS.indexOf(protein[i + 1] as string)] as number;
  }
  return protein.length === 0 ? 0 : (10 / protein.length) * score;
}

/** Kyte-Doolittle hydropathy per residue in `AMINO_ACIDS` order (Kyte & Doolittle 1982). */
const KYTE_DOOLITTLE = [
  1.8, 2.5, -3.5, -3.5, 2.8, -0.4, -3.2, 4.5, -3.9, 3.8, 1.9, -3.5, -1.6, -3.5, -4.5, -0.8, -0.7, 4.2, -0.9,
  -1.3,
];

/** Grand average of hydropathy: mean Kyte-Doolittle value over the residues. Oracle: `ProteinAnalysis.gravy`. */
export function gravy(seq: string): number {
  const protein = standardResidues(seq);
  let sum = 0;
  for (const ch of protein) sum += KYTE_DOOLITTLE[AMINO_ACIDS.indexOf(ch)] as number;
  return protein.length === 0 ? 0 : sum / protein.length;
}

/** Fraction of Phe, Trp and Tyr (Lobry 1994). Oracle: `ProteinAnalysis.aromaticity`. */
export function aromaticity(seq: string): number {
  const protein = standardResidues(seq);
  const counts = residueCounts(protein);
  return protein.length === 0 ? 0 : ((counts.F ?? 0) + (counts.W ?? 0) + (counts.Y ?? 0)) / protein.length;
}

/**
 * Kyte-Doolittle hydropathy profile: the mean hydropathy of each window of `window` residues (default 9), one
 * value per window start. Oracle: `ProteinAnalysis.protein_scale(kd, window)` for odd windows with `edge=1`.
 */
export function hydropathyProfile(seq: string, window = 9): WindowSeries {
  const metric = (counts: Int32Array, length: number) => {
    let sum = 0;
    for (let i = 0; i < KYTE_DOOLITTLE.length; i++)
      sum += (counts[i] as number) * (KYTE_DOOLITTLE[i] as number);
    return sum / length;
  };
  return slidingWindow(encodeResidues(standardResidues(seq)), AMINO_ACIDS.length + 1, metric, { window });
}
