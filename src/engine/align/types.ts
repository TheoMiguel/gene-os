/** Types shared by the pairwise and multiple sequence aligners. Coordinates are 0-based, half-open. */

export type AlignMode = 'global' | 'local' | 'overlap';
export type AlignAlphabet = 'dna' | 'protein';
export type MatrixName = 'BLOSUM62' | 'BLOSUM45' | 'BLOSUM80' | 'PAM250';

/**
 * Scoring choices. A gap of length k costs `gapOpen + (k - 1) * gapExtend` points, the convention of
 * `Bio.Align.PairwiseAligner` (its `open_gap_score` is `-gapOpen`, its `extend_gap_score` is `-gapExtend`).
 * Both are penalties, so they are zero or positive.
 */
export interface ScoringOptions {
  /** Defaults to what `detectAlphabet` finds in the sequences. RNA counts as DNA with U for T. */
  readonly alphabet?: AlignAlphabet;
  /** Protein only. Defaults to BLOSUM62. */
  readonly matrix?: MatrixName;
  /** DNA only. Letters that are not A, C, G, T or U score 0 against everything. */
  readonly match?: number;
  readonly mismatch?: number;
  readonly gapOpen?: number;
  readonly gapExtend?: number;
}

export interface PairwiseOptions extends ScoringOptions {
  readonly mode?: AlignMode;
  /** Largest number of DP cells the call may compute. Beyond it the result is `too-large`. */
  readonly maxCells?: number;
}

/** Class of one alignment column. */
export const ColumnClass = { Identical: 0, Similar: 1, Mismatch: 2, Gap: 3 } as const;
export type ColumnClass = (typeof ColumnClass)[keyof typeof ColumnClass];

/** Counts and percentages over the alignment columns. */
export interface AlignmentStats {
  readonly length: number;
  readonly identical: number;
  /** Not identical, but the substitution score is positive. */
  readonly similar: number;
  readonly mismatches: number;
  /** Columns that hold a gap. */
  readonly gapColumns: number;
  /** Runs of gap columns, so a 5-base deletion counts once. */
  readonly gapRuns: number;
  /** Identical columns over alignment length, as EMBOSS reports it. */
  readonly percentIdentity: number;
  /** Identical plus similar columns over alignment length. */
  readonly percentSimilarity: number;
}

export type DifferenceKind = 'substitution' | 'insertion' | 'deletion';

/**
 * One difference between a reference and another sequence. Ranges are half-open on each sequence.
 * A substitution covers one residue on each. An insertion (residues only in the other sequence) is empty on the
 * reference and sits at the reference position where the residues enter. A deletion (residues only in the
 * reference) is empty on the other sequence.
 */
export interface Difference {
  readonly kind: DifferenceKind;
  readonly refStart: number;
  readonly refEnd: number;
  readonly altStart: number;
  readonly altEnd: number;
  readonly ref: string;
  readonly alt: string;
  /** The run touches the first or last alignment column. In overlap mode that is an overhang, not an edit. */
  readonly terminal: boolean;
}

export interface PairwiseAlignment {
  readonly mode: AlignMode;
  readonly alphabet: AlignAlphabet;
  readonly score: number;
  /** Aligned sequences with `-` for gaps. Same length. */
  readonly alignedA: string;
  readonly alignedB: string;
  /** Part of each input that the alignment covers. A local alignment covers less than the whole. */
  readonly startA: number;
  readonly endA: number;
  readonly startB: number;
  readonly endB: number;
  /** One `ColumnClass` per column, so a view colours without recomputing. */
  readonly classes: Uint8Array;
  readonly stats: AlignmentStats;
  /** Differences of B against A, which is the reference. */
  readonly differences: readonly Difference[];
  readonly method: 'quadratic' | 'hirschberg' | 'banded-hirschberg';
}

export interface TooLarge {
  readonly status: 'too-large';
  /** DP cells the cheapest exact method would need. */
  readonly cells: number;
  readonly limit: number;
  readonly mode: AlignMode;
}

export type PairwiseResult = { readonly status: 'ok'; readonly alignment: PairwiseAlignment } | TooLarge;
