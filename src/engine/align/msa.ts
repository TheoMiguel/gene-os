import { dropSharedGaps, findDifferences } from './columns';
import { alignPair } from './pairwise';
import { mergeProfiles, type Profile, singleProfile } from './profile';
import { buildScorer, pairScore, resolveAlphabet, type Scorer } from './scoring';
import { type GuideTree, kmerDistances, upgma } from './tree';
import { type AlignAlphabet, ColumnClass, type Difference, type PairwiseOptions } from './types';

export interface MsaOptions extends Omit<PairwiseOptions, 'mode'> {
  /**
   * How the guide tree measures distance. `alignment` aligns every pair (exact, quadratic in length), `kmer` counts
   * shared k-mers (linear), `auto` picks `alignment` while all pairs together stay under 20 Mcells.
   */
  readonly distance?: 'auto' | 'alignment' | 'kmer';
  /** Largest lattice of one profile merge. Beyond it the result is `too-large`. Default 100 Mcells. */
  readonly maxCells?: number;
}

export interface MultipleAlignment {
  readonly alphabet: AlignAlphabet;
  /** Aligned rows with `-` for gaps, in input order. All have the same length. */
  readonly rows: readonly string[];
  readonly length: number;
  /** Mean pairwise score: every pair of rows scored as a pairwise alignment, shared gap columns dropped. */
  readonly score: number;
  /** Mean over row pairs of identical columns over alignment length. */
  readonly percentIdentity: number;
  /** Mean over row pairs of identical plus similar columns over alignment length. */
  readonly percentSimilarity: number;
  /** One `ColumnClass` per column: Gap when any row has a gap, Identical when all residues match, else Similar or Mismatch. */
  readonly classes: Uint8Array;
  /** Share of rows that hold the most common residue of each column. */
  readonly conservation: Float64Array;
  readonly guideTree: GuideTree;
}

export type MsaResult =
  | { readonly status: 'ok'; readonly alignment: MultipleAlignment }
  | { readonly status: 'too-large'; readonly cells: number; readonly limit: number };

const DEFAULT_MERGE_CELLS = 1e8;
const EXACT_DISTANCE_CELLS = 2e7;

function alignmentDistances(seqs: readonly string[], options: MsaOptions): Float64Array {
  const n = seqs.length;
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const result = alignPair(seqs[i] as string, seqs[j] as string, { ...options, mode: 'global' });
      const d = result.status === 'ok' ? 1 - result.alignment.stats.percentIdentity / 100 : 1;
      out[i * n + j] = d;
      out[j * n + i] = d;
    }
  }
  return out;
}

function pairCells(seqs: readonly string[]): number {
  let cells = 0;
  for (let i = 0; i < seqs.length; i++) {
    for (let j = i + 1; j < seqs.length; j++)
      cells += ((seqs[i] as string).length + 1) * ((seqs[j] as string).length + 1);
  }
  return cells;
}

function alignTree(
  tree: GuideTree,
  profiles: readonly Profile[],
  scorer: Scorer,
  maxCells: number,
): { profile: Profile } | { cells: number } {
  if ('leaf' in tree) return { profile: profiles[tree.leaf] as Profile };
  const left = alignTree(tree.left, profiles, scorer, maxCells);
  if ('cells' in left) return left;
  const right = alignTree(tree.right, profiles, scorer, maxCells);
  if ('cells' in right) return right;
  const merged = mergeProfiles(scorer, left.profile, right.profile, maxCells);
  if (!merged) return { cells: (left.profile.length + 1) * (right.profile.length + 1) };
  return { profile: merged };
}

/** Class and conservation of every column. */
function columnSummary(
  scorer: Scorer,
  rows: readonly string[],
  length: number,
): { classes: Uint8Array; conservation: Float64Array } {
  const classes = new Uint8Array(length);
  const conservation = new Float64Array(length);
  for (let c = 0; c < length; c++) {
    const tally = new Map<string, number>();
    let gap = false;
    for (const row of rows) {
      const letter = row[c] as string;
      if (letter === '-') gap = true;
      else tally.set(letter, (tally.get(letter) ?? 0) + 1);
    }
    conservation[c] = Math.max(0, ...tally.values()) / rows.length;
    if (gap) classes[c] = ColumnClass.Gap;
    else if (tally.size === 1) classes[c] = ColumnClass.Identical;
    else {
      const letters = [...tally.keys()];
      const allPositive = letters.every((x, i) =>
        letters.slice(i + 1).every((y) => pairScore(scorer, x, y) > 0),
      );
      classes[c] = allPositive ? ColumnClass.Similar : ColumnClass.Mismatch;
    }
  }
  return { classes, conservation };
}

/** Mean pairwise score and percentages of an alignment. */
function pairwiseSummary(
  scorer: Scorer,
  rows: readonly string[],
): { score: number; identity: number; similarity: number } {
  let score = 0;
  let identity = 0;
  let similarity = 0;
  let pairs = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const [a, b] = dropSharedGaps(rows[i] as string, rows[j] as string);
      let gap = 0;
      let identical = 0;
      let similar = 0;
      for (let c = 0; c < a.length; c++) {
        const x = a[c] as string;
        const y = b[c] as string;
        if (x === '-' || y === '-') {
          const kind = x === '-' ? 1 : 2;
          score += gap === kind ? scorer.extendScore : scorer.openScore;
          gap = kind;
          continue;
        }
        gap = 0;
        const s = pairScore(scorer, x, y);
        score += s;
        if (x === y) identical++;
        else if (s > 0) similar++;
      }
      if (a.length > 0) {
        identity += (100 * identical) / a.length;
        similarity += (100 * (identical + similar)) / a.length;
      }
      pairs++;
    }
  }
  return pairs === 0
    ? { score: 0, identity: 100, similarity: 100 }
    : { score: score / pairs, identity: identity / pairs, similarity: similarity / pairs };
}

/**
 * Progressive multiple alignment: a distance matrix, a UPGMA guide tree, then profile-to-profile alignment from the
 * leaves up with the pairwise affine gap model. Deterministic. It is not Clustal, so columns can differ from its output.
 * A profile merge keeps a traceback byte per cell, so each merge must stay under `maxCells`: about 10 kb per sequence.
 */
export function alignMultiple(sequences: readonly string[], options: MsaOptions = {}): MsaResult {
  if (sequences.length === 0) throw new RangeError('alignMultiple needs at least one sequence');
  const seqs = sequences.map((s) => s.toUpperCase());
  const alphabet = resolveAlphabet(options, seqs);
  const scorer = buildScorer(alphabet, options);
  const n = seqs.length;
  const limit = options.maxCells ?? DEFAULT_MERGE_CELLS;

  const exact =
    options.distance === 'alignment' ||
    (options.distance !== 'kmer' && pairCells(seqs) <= EXACT_DISTANCE_CELLS);
  const distances =
    n < 3
      ? new Float64Array(n * n)
      : exact
        ? alignmentDistances(seqs, { ...options, alphabet })
        : kmerDistances(seqs, alphabet);
  const guideTree = n === 1 ? ({ leaf: 0 } as GuideTree) : upgma(distances, n);
  const profiles = seqs.map((seq, index) => singleProfile(scorer, index, seq));
  const merged = alignTree(guideTree, profiles, scorer, limit);
  if ('cells' in merged) return { status: 'too-large', cells: merged.cells, limit };

  const { profile } = merged;
  const rows = new Array<string>(n);
  for (const [r, member] of profile.members.entries()) rows[member] = profile.rows[r] as string;
  const summary = pairwiseSummary(scorer, rows);
  return {
    status: 'ok',
    alignment: {
      alphabet,
      rows,
      length: profile.length,
      score: summary.score,
      percentIdentity: summary.identity,
      percentSimilarity: summary.similarity,
      ...columnSummary(scorer, rows, profile.length),
      guideTree,
    },
  };
}

/** Differences of every row against row 0, the reference, in the coordinates of the original sequences. */
export function msaDifferences(
  msa: Pick<MultipleAlignment, 'rows' | 'alphabet'>,
): { readonly sequence: number; readonly differences: readonly Difference[] }[] {
  const reference = msa.rows[0] as string;
  const scorer = buildScorer(msa.alphabet);
  return msa.rows
    .slice(1)
    .map((row, k) => ({ sequence: k + 1, differences: findDifferences(reference, row, scorer) }));
}

export interface ConsensusOptions {
  /** Share of rows (0 to 1) that must hold the same residue for the column to call it. Default 0.5. */
  readonly threshold?: number;
  /** Written where no residue reaches the threshold. Default `N` for DNA and `X` for protein. */
  readonly unresolved?: string;
  /** Keep columns where gaps are the most common symbol as `-`. By default they are left out. */
  readonly keepGapColumns?: boolean;
}

/**
 * Consensus of an alignment: per column, the residue held by at least `threshold` of the rows, ties by letter order.
 * A column where gaps are the most common symbol is dropped, or kept as `-` with `keepGapColumns`.
 */
export function consensus(
  rows: readonly string[],
  alphabet: AlignAlphabet,
  options: ConsensusOptions = {},
): string {
  const threshold = options.threshold ?? 0.5;
  const unresolved = options.unresolved ?? (alphabet === 'dna' ? 'N' : 'X');
  const length = rows[0]?.length ?? 0;
  let out = '';
  for (let c = 0; c < length; c++) {
    const tally = new Map<string, number>();
    for (const row of rows) tally.set(row[c] as string, (tally.get(row[c] as string) ?? 0) + 1);
    const ranked = [...tally.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    const [letter, count] = ranked[0] as [string, number];
    if (letter === '-') {
      if (options.keepGapColumns) out += '-';
    } else out += count / rows.length >= threshold ? letter : unresolved;
  }
  return out;
}
