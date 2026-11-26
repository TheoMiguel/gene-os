import matrixData from '../../data/matrices.json';
import { detectAlphabet } from '../alphabet';
import type { AlignAlphabet, MatrixName, ScoringOptions } from './types';

interface MatrixFile {
  readonly matrices: Record<
    MatrixName,
    { readonly letters: string; readonly values: readonly (readonly number[])[] }
  >;
}

/** Biopython's own tables for the protein matrices (scripts/oracle/build_matrices.py). */
const MATRICES = (matrixData as MatrixFile).matrices;

export const MATRIX_NAMES = Object.keys(MATRICES) as readonly MatrixName[];

/** A substitution table over a small alphabet, plus the gap penalties. Letters outside it map to the last code. */
export interface Scorer {
  readonly alphabet: AlignAlphabet;
  readonly letters: string;
  /** Number of codes. `table` is `size * size`, row-major. */
  readonly size: number;
  /** Char code to residue code. */
  readonly codeOf: Uint8Array;
  /** Code of every letter the table does not list (N for DNA, X for protein). */
  readonly unknownCode: number;
  readonly table: Float64Array;
  /** Gap penalties as non-positive scores. */
  readonly openScore: number;
  readonly extendScore: number;
  /** Largest entry of `table`. */
  readonly maxScore: number;
  readonly label: string;
}

const DEFAULTS = {
  dna: { match: 2, mismatch: -3, gapOpen: 5, gapExtend: 2 },
  protein: { gapOpen: 10, gapExtend: 0.5 },
} as const;

function buildCodeOf(
  letters: string,
  unknown: number,
  aliases: Readonly<Record<string, string>> = {},
): Uint8Array {
  const codeOf = new Uint8Array(256).fill(unknown);
  for (const [code, letter] of [...letters].entries()) {
    codeOf[letter.charCodeAt(0)] = code;
    codeOf[letter.toLowerCase().charCodeAt(0)] = code;
  }
  for (const [from, to] of Object.entries(aliases)) {
    const code = letters.indexOf(to);
    codeOf[from.charCodeAt(0)] = code;
    codeOf[from.toLowerCase().charCodeAt(0)] = code;
  }
  return codeOf;
}

function checkPenalty(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a number of at least 0`);
  return value;
}

/** Alphabet the sequences use: RNA is scored as DNA, so only DNA and protein remain. */
export function resolveAlphabet(options: ScoringOptions, sequences: readonly string[]): AlignAlphabet {
  if (options.alphabet) return options.alphabet;
  const detected = detectAlphabet(sequences.join(''));
  return detected === 'protein' ? 'protein' : 'dna';
}

/** Builds the scorer for one run: a Biopython matrix for protein, match and mismatch scores for DNA. */
export function buildScorer(alphabet: AlignAlphabet, options: ScoringOptions = {}): Scorer {
  if (alphabet === 'protein') {
    const name = options.matrix ?? 'BLOSUM62';
    const matrix = MATRICES[name];
    if (!matrix) throw new RangeError(`unknown substitution matrix ${name}`);
    const size = matrix.letters.length;
    const table = new Float64Array(size * size);
    for (let a = 0; a < size; a++)
      for (let b = 0; b < size; b++) table[a * size + b] = matrix.values[a]?.[b] as number;
    return finishScorer('protein', matrix.letters, table, options, name, DEFAULTS.protein);
  }
  const match = options.match ?? DEFAULTS.dna.match;
  const mismatch = options.mismatch ?? DEFAULTS.dna.mismatch;
  const letters = 'ACGTN';
  const size = letters.length;
  const table = new Float64Array(size * size);
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) table[a * size + b] = a === b ? match : mismatch;
  return finishScorer('dna', letters, table, options, `match ${match} / mismatch ${mismatch}`, DEFAULTS.dna);
}

function finishScorer(
  alphabet: AlignAlphabet,
  letters: string,
  table: Float64Array,
  options: ScoringOptions,
  label: string,
  defaults: { readonly gapOpen: number; readonly gapExtend: number },
): Scorer {
  const unknown = letters.indexOf(alphabet === 'dna' ? 'N' : 'X');
  const codeOf = buildCodeOf(letters, unknown, alphabet === 'dna' ? { U: 'T' } : {});
  let maxScore = Number.NEGATIVE_INFINITY;
  for (const v of table) maxScore = Math.max(maxScore, v);
  return {
    alphabet,
    letters,
    size: letters.length,
    codeOf,
    unknownCode: unknown,
    table,
    openScore: -checkPenalty('gapOpen', options.gapOpen ?? defaults.gapOpen),
    extendScore: -checkPenalty('gapExtend', options.gapExtend ?? defaults.gapExtend),
    maxScore,
    label,
  };
}

/** Residue codes of a sequence under a scorer. */
export function encodeFor(scorer: Scorer, seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) out[i] = scorer.codeOf[seq.charCodeAt(i) & 0xff] as number;
  return out;
}

/** Substitution score of two letters. */
export function pairScore(scorer: Scorer, a: string, b: string): number {
  const ca = scorer.codeOf[a.charCodeAt(0) & 0xff] as number;
  const cb = scorer.codeOf[b.charCodeAt(0) & 0xff] as number;
  return scorer.table[ca * scorer.size + cb] as number;
}

/** True when two aligned letters are the same residue: equal letters, or letters the scorer maps to one residue (U and T). */
export function residuesMatch(scorer: Scorer, a: string, b: string): boolean {
  if (a === b) return true;
  const ca = scorer.codeOf[a.charCodeAt(0) & 0xff] as number;
  return ca === scorer.codeOf[b.charCodeAt(0) & 0xff] && ca !== scorer.unknownCode;
}

/** Score of an alignment under a scorer: substitutions plus affine gaps. Columns that are gaps in both rows are skipped. */
export function scoreAlignedPair(scorer: Scorer, a: string, b: string, endGapsFree = false): number {
  const n = a.length;
  let first = 0;
  let last = n;
  if (endGapsFree) {
    while (first < n && (a[first] === '-' || b[first] === '-')) first++;
    while (last > first && (a[last - 1] === '-' || b[last - 1] === '-')) last--;
  }
  let total = 0;
  let gap: 'a' | 'b' | null = null;
  for (let c = first; c < last; c++) {
    const x = a[c] as string;
    const y = b[c] as string;
    if (x === '-' && y === '-') continue;
    if (x === '-' || y === '-') {
      const kind = x === '-' ? 'a' : 'b';
      total += gap === kind ? scorer.extendScore : scorer.openScore;
      gap = kind;
    } else {
      total += pairScore(scorer, x, y);
      gap = null;
    }
  }
  return total;
}
