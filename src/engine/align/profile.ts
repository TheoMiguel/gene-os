import { bytesToString } from '../alphabet';
import { alignQuadratic, Op, type RowScorer, State } from './kernel';
import { encodeFor, type Scorer } from './scoring';

/** The aligned rows of a set of sequences and, for every column, how many of them hold each residue code. */
export interface Profile {
  /** Input indices of the sequences, one per row. */
  readonly members: readonly number[];
  readonly rows: readonly string[];
  readonly length: number;
  /** `length * scorer.size` residue counts; gaps are not counted. */
  readonly counts: Float64Array;
}

/** A profile of one sequence. */
export function singleProfile(scorer: Scorer, index: number, seq: string): Profile {
  const size = scorer.size;
  const counts = new Float64Array(seq.length * size);
  const codes = encodeFor(scorer, seq);
  for (let c = 0; c < codes.length; c++) counts[c * size + (codes[c] as number)] = 1;
  return { members: [index], rows: [seq], length: seq.length, counts };
}

/** Score of every column of Q against column `i` of P: the expected substitution score of a random residue pair. */
function profileRows(scorer: Scorer, p: Profile, q: Profile): RowScorer {
  const size = scorer.size;
  const m = q.length;
  const rowsInP = p.members.length;
  const rowsInQ = q.members.length;
  const against = new Float64Array(size * m);
  for (let j = 0; j < m; j++) {
    for (let b = 0; b < size; b++) {
      const f = (q.counts[j * size + b] as number) / rowsInQ;
      if (f === 0) continue;
      for (let a = 0; a < size; a++)
        against[a * m + j] = (against[a * m + j] as number) + f * (scorer.table[a * size + b] as number);
    }
  }
  const scratch = new Float64Array(m);
  return {
    row(i) {
      scratch.fill(0);
      for (let a = 0; a < size; a++) {
        const f = (p.counts[i * size + a] as number) / rowsInP;
        if (f === 0) continue;
        const offset = a * m;
        for (let j = 0; j < m; j++) scratch[j] = (scratch[j] as number) + f * (against[offset + j] as number);
      }
      return scratch;
    },
  };
}

/** Rebuilds the aligned rows of one side of a merge from the path steps. `takes` is the step that reads this side. */
function spliceRows(rows: readonly string[], ops: Uint8Array, reads: (op: number) => boolean): string[] {
  return rows.map((row) => {
    const out = new Uint8Array(ops.length);
    let at = 0;
    for (let c = 0; c < ops.length; c++) out[c] = reads(ops[c] as number) ? row.charCodeAt(at++) : 45;
    return bytesToString(out);
  });
}

/**
 * Aligns two profiles with the pairwise affine model and returns the merged profile. Null when the lattice would
 * exceed `maxCells`.
 */
export function mergeProfiles(scorer: Scorer, p: Profile, q: Profile, maxCells: number): Profile | null {
  if ((p.length + 1) * (q.length + 1) > maxCells) return null;
  const path = alignQuadratic({
    rows: profileRows(scorer, p, q),
    i0: 0,
    i1: p.length,
    j0: 0,
    j1: q.length,
    go: scorer.openScore,
    ge: scorer.extendScore,
    mode: 'global',
    startState: State.Pair,
  });
  const ops = (path as NonNullable<typeof path>).ops;
  const size = scorer.size;
  const counts = new Float64Array(ops.length * size);
  let i = 0;
  let j = 0;
  for (let c = 0; c < ops.length; c++) {
    const op = ops[c];
    if (op !== Op.GapInA)
      for (let a = 0; a < size; a++) counts[c * size + a] = p.counts[i * size + a] as number;
    if (op !== Op.GapInB)
      for (let a = 0; a < size; a++)
        counts[c * size + a] = (counts[c * size + a] as number) + (q.counts[j * size + a] as number);
    if (op !== Op.GapInA) i++;
    if (op !== Op.GapInB) j++;
  }
  return {
    members: [...p.members, ...q.members],
    rows: [
      ...spliceRows(p.rows, ops, (op) => op !== Op.GapInA),
      ...spliceRows(q.rows, ops, (op) => op !== Op.GapInB),
    ],
    length: ops.length,
    counts,
  };
}
