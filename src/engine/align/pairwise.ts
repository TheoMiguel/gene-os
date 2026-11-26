import { bytesToString } from '../alphabet';
import { classifyColumns, computeStats, coreColumns, findDifferences } from './columns';
import { alignGlobalLinear } from './hirschberg';
import { alignQuadratic, Op, type RowScorer, State, type TracedPath } from './kernel';
import { buildScorer, encodeFor, resolveAlphabet, type Scorer } from './scoring';
import type { AlignMode, PairwiseAlignment, PairwiseOptions, PairwiseResult } from './types';

/**
 * Largest lattice, in cells, each mode computes. Local and overlap alignment keep one traceback byte per cell, so
 * they stop at 100 Mcells (about 10 kb by 10 kb, 1.5 s measured). Global alignment runs in linear space and is
 * bounded by time instead, at about 45 Mcells per second: 2.5 Gcells caps unrelated sequences near 50 kb by 50 kb.
 * Similar sequences need only a band around the diagonal, so 100 kb pairs that differ by a few per mille fit.
 */
export const MODE_CELL_LIMITS: Readonly<Record<AlignMode, number>> = {
  global: 2.5e9,
  local: 1e8,
  overlap: 1e8,
};

/** Global alignments up to this many cells use one traceback matrix instead of the divide and conquer. */
const DIRECT_CELLS = 4e6;

/** Scores of every residue of B against a residue of A, with one precomputed row per residue code of A. */
export function pairRows(scorer: Scorer, codesA: Uint8Array, codesB: Uint8Array): RowScorer {
  const rows: (Float64Array | undefined)[] = new Array(scorer.size);
  return {
    row(i) {
      const code = codesA[i] as number;
      let row = rows[code];
      if (!row) {
        row = new Float64Array(codesB.length);
        const offset = code * scorer.size;
        for (let j = 0; j < row.length; j++) row[j] = scorer.table[offset + (codesB[j] as number)] as number;
        rows[code] = row;
      }
      return row;
    },
  };
}

/** Turns path steps into two gapped strings. */
export function renderOps(
  ops: Uint8Array,
  a: string,
  b: string,
  startA: number,
  startB: number,
): [string, string] {
  const rowA = new Uint8Array(ops.length);
  const rowB = new Uint8Array(ops.length);
  let i = startA;
  let j = startB;
  for (let c = 0; c < ops.length; c++) {
    const op = ops[c];
    rowA[c] = op === Op.GapInA ? 45 : a.charCodeAt(i++);
    rowB[c] = op === Op.GapInB ? 45 : b.charCodeAt(j++);
  }
  return [bytesToString(rowA), bytesToString(rowB)];
}

/** Opens the free end gaps of an overlap alignment: the path covers every residue of both sequences. */
function withFlanks(path: TracedPath, n: number, m: number): Uint8Array {
  const lead = path.startI + path.startJ;
  const trail = n - path.endI + (m - path.endJ);
  const ops = new Uint8Array(lead + path.ops.length + trail);
  ops.fill(Op.GapInB, 0, path.startI);
  ops.fill(Op.GapInA, path.startI, lead);
  ops.set(path.ops, lead);
  const tail = lead + path.ops.length;
  ops.fill(Op.GapInB, tail, tail + n - path.endI);
  ops.fill(Op.GapInA, tail + n - path.endI, ops.length);
  return ops;
}

/**
 * Aligns two sequences. Global is Needleman-Wunsch and local is Smith-Waterman, both with affine gaps. Overlap lets
 * either sequence overhang the other for free, which is what comparing a read to a reference needs.
 * Oracle: `Bio.Align.PairwiseAligner` with the same scores, in `mode` global or local, and `end_gap_score = 0` for overlap.
 * Global runs in linear space; the other modes return `too-large` past `MODE_CELL_LIMITS`.
 */
export function alignPair(seqA: string, seqB: string, options: PairwiseOptions = {}): PairwiseResult {
  const mode = options.mode ?? 'global';
  const a = seqA.toUpperCase();
  const b = seqB.toUpperCase();
  const n = a.length;
  const m = b.length;
  const alphabet = resolveAlphabet(options, [a, b]);
  const scorer = buildScorer(alphabet, options);
  const rows = pairRows(scorer, encodeFor(scorer, a), encodeFor(scorer, b));
  const limit = options.maxCells ?? MODE_CELL_LIMITS[mode];
  const cells = (n + 1) * (m + 1);
  const go = scorer.openScore;
  const ge = scorer.extendScore;

  let path: TracedPath;
  let method: PairwiseAlignment['method'] = 'quadratic';
  if (mode === 'global' && cells > DIRECT_CELLS) {
    const outcome = alignGlobalLinear({ rows, n, m, go, ge }, scorer.maxScore, limit);
    if (outcome.status === 'too-large') return { status: 'too-large', cells: outcome.cells, limit, mode };
    path = outcome.path;
    method = outcome.banded ? 'banded-hirschberg' : 'hirschberg';
  } else {
    if (cells > limit) return { status: 'too-large', cells, limit, mode };
    path = alignQuadratic({
      rows,
      i0: 0,
      i1: n,
      j0: 0,
      j1: m,
      go,
      ge,
      mode,
      startState: State.Pair,
    }) as TracedPath;
  }

  const ops = mode === 'overlap' ? withFlanks(path, n, m) : path.ops;
  const startA = mode === 'overlap' ? 0 : path.startI;
  const startB = mode === 'overlap' ? 0 : path.startJ;
  const [alignedA, alignedB] = renderOps(ops, a, b, startA, startB);
  const classes = classifyColumns(scorer, alignedA, alignedB);
  const [from, to] = mode === 'overlap' ? coreColumns(alignedA, alignedB) : [0, classes.length];
  const alignment: PairwiseAlignment = {
    mode,
    alphabet,
    score: path.score,
    alignedA,
    alignedB,
    startA,
    endA: mode === 'overlap' ? n : path.endI,
    startB,
    endB: mode === 'overlap' ? m : path.endJ,
    classes,
    stats: computeStats(classes, alignedA, alignedB, from, to),
    differences: findDifferences(alignedA, alignedB, scorer, startA, startB),
    method,
  };
  return { status: 'ok', alignment };
}
