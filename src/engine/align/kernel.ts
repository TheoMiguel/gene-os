import type { AlignMode } from './types';

/** Supplies the substitution score of every residue of B against residue `i` of A. */
export interface RowScorer {
  /** Scores of A[i] against B[j], indexed by the absolute column `j`. The array may be reused by the next call. */
  row(i: number): Float64Array;
}

/** Operations of an alignment path, in the order they read the two sequences. */
export const Op = { Pair: 0, GapInB: 1, GapInA: 2 } as const;

/** DP states: how the path reached a cell. A gap state lets the next gap step skip the open penalty. */
export const State = { Pair: 0, GapInB: 1, GapInA: 2 } as const;
export type StateId = (typeof State)[keyof typeof State];

/** Value of `endState` that accepts a path ending in any state. */
export const ANY_END = 3;
const START = 3;
const NEG = Number.NEGATIVE_INFINITY;

/** Diagonal limits `dlo <= j - i <= dhi`, in absolute coordinates, outside which a cell is skipped. */
export interface Band {
  readonly dlo: number;
  readonly dhi: number;
}

/** A rectangle of the lattice: residues `i0..i1` of A against `j0..j1` of B. */
export interface Region {
  readonly i0: number;
  readonly i1: number;
  readonly j0: number;
  readonly j1: number;
}

export interface FillSpec extends Region {
  readonly rows: RowScorer;
  /** Gap open and extend as non-positive scores. */
  readonly go: number;
  readonly ge: number;
  readonly mode: AlignMode;
  /** State the path is in before its first step. A gap state continues a gap that began before the region. */
  readonly startState: StateId;
  readonly band?: Band;
}

export interface Rows3 {
  readonly M: Float64Array;
  readonly X: Float64Array;
  readonly Y: Float64Array;
}

interface FillOutcome {
  /** Best end cell of a local or overlap fill. */
  best: { score: number; i: number; j: number; state: StateId };
}

/**
 * Fills the DP of three states down to row `lastRow` (relative to `i0`) and leaves the last row in the returned arrays,
 * indexed by `j - j0`. With `ptr`, also stores each cell's three predecessors (2 bits each) for a traceback.
 */
export function fillForward(spec: FillSpec, lastRow: number, ptr?: Uint8Array): Rows3 & FillOutcome {
  const { rows, i0, j0, j1, go, ge, mode, startState, band } = spec;
  const m = j1 - j0;
  const W = m + 1;
  const local = mode === 'local';
  const free = local || mode === 'overlap';
  const dlo = band?.dlo ?? NEG;
  const dhi = band?.dhi ?? Number.POSITIVE_INFINITY;
  const last = spec.i1 - i0;
  const M = new Float64Array(W).fill(NEG);
  const X = new Float64Array(W).fill(NEG);
  const Y = new Float64Array(W).fill(NEG);
  const best = { score: NEG, i: i0, j: j0, state: State.Pair as StateId };

  if (free) {
    M.fill(0);
    ptr?.fill(START, 0, W);
  } else {
    if (startState === State.Pair) M[0] = 0;
    else if (startState === State.GapInB) X[0] = 0;
    else Y[0] = 0;
    if (ptr) ptr[0] = START;
    const jhi = Math.min(m, dhi + i0 - j0);
    for (let j = 1; j <= jhi; j++) {
      let v = (M[j - 1] as number) + go;
      let s = 0;
      let t = (Y[j - 1] as number) + ge;
      if (t > v) {
        v = t;
        s = 2;
      }
      t = (X[j - 1] as number) + go;
      if (t > v) {
        v = t;
        s = 1;
      }
      Y[j] = v;
      if (ptr) ptr[j] = s << 4;
    }
  }

  if (mode === 'overlap') trackOverlapEnd(best, M, X, Y, i0, j0, m, last === 0);
  for (let i = 1; i <= lastRow; i++) {
    const scores = rows.row(i0 + i - 1);
    const base = i * W;
    const jlo = Math.max(1, dlo + i0 + i - j0);
    const jhi = Math.min(m, dhi + i0 + i - j0);
    const colZero = !free ? dlo <= j0 - (i0 + i) && j0 - (i0 + i) <= dhi : true;
    let dM = M[0] as number;
    let dX = X[0] as number;
    let dY = Y[0] as number;
    if (free) {
      M[0] = 0;
      if (ptr) ptr[base] = START;
    } else if (colZero) {
      let v = (M[0] as number) + go;
      let s = 0;
      let t = (X[0] as number) + ge;
      if (t > v) {
        v = t;
        s = 1;
      }
      t = (Y[0] as number) + go;
      if (t > v) {
        v = t;
        s = 2;
      }
      M[0] = NEG;
      X[0] = v;
      Y[0] = NEG;
      if (ptr) ptr[base] = s << 2;
    } else {
      M[0] = NEG;
      X[0] = NEG;
      Y[0] = NEG;
    }
    if (jlo > 1) {
      M[jlo - 1] = NEG;
      X[jlo - 1] = NEG;
      Y[jlo - 1] = NEG;
    }
    let lM = jlo > 1 ? NEG : (M[jlo - 1] as number);
    let lX = jlo > 1 ? NEG : (X[jlo - 1] as number);
    let lY = jlo > 1 ? NEG : (Y[jlo - 1] as number);
    const offset = j0 - 1;
    for (let j = jlo; j <= jhi; j++) {
      const uM = M[j] as number;
      const uX = X[j] as number;
      const uY = Y[j] as number;
      let pm = dM;
      let ps = 0;
      if (dX > pm) {
        pm = dX;
        ps = 1;
      }
      if (dY > pm) {
        pm = dY;
        ps = 2;
      }
      if (local && pm <= 0) {
        pm = 0;
        ps = START;
      }
      const mv = pm + (scores[offset + j] as number);
      let xv = uM + go;
      let xs = 0;
      let t = uX + ge;
      if (t > xv) {
        xv = t;
        xs = 1;
      }
      t = uY + go;
      if (t > xv) {
        xv = t;
        xs = 2;
      }
      let yv = lM + go;
      let ys = 0;
      t = lY + ge;
      if (t > yv) {
        yv = t;
        ys = 2;
      }
      t = lX + go;
      if (t > yv) {
        yv = t;
        ys = 1;
      }
      M[j] = mv;
      X[j] = xv;
      Y[j] = yv;
      if (ptr) ptr[base + j] = ps | (xs << 2) | (ys << 4);
      dM = uM;
      dX = uX;
      dY = uY;
      lM = mv;
      lX = xv;
      lY = yv;
      if (local && mv > best.score) {
        best.score = mv;
        best.i = i0 + i;
        best.j = j0 + j;
        best.state = State.Pair;
      }
    }
    if (mode === 'overlap') trackOverlapEnd(best, M, X, Y, i0 + i, j0, m, i === last);
  }
  return { M, X, Y, best };
}

/** Overlap alignments may end in the last column of any row or anywhere in the last row. */
function trackOverlapEnd(
  best: FillOutcome['best'],
  M: Float64Array,
  X: Float64Array,
  Y: Float64Array,
  i: number,
  j0: number,
  m: number,
  lastRow: boolean,
): void {
  const from = lastRow ? 0 : m;
  for (let j = from; j <= m; j++) {
    for (const [state, arr] of [
      [State.Pair, M],
      [State.GapInB, X],
      [State.GapInA, Y],
    ] as const) {
      const v = arr[j] as number;
      if (v > best.score) {
        best.score = v;
        best.i = i;
        best.j = j0 + j;
        best.state = state;
      }
    }
  }
}

export interface TracedPath {
  readonly score: number;
  /** Path steps in forward order. */
  readonly ops: Uint8Array;
  /** Lattice cells where the path starts and ends, in absolute coordinates. */
  readonly startI: number;
  readonly startJ: number;
  readonly endI: number;
  readonly endJ: number;
}

/**
 * Optimal path through a region with a stored traceback. Memory is one byte per cell, so the caller bounds the area.
 * `endState` is 0, 1 or 2 to force the path to end in that state, or `ANY_END`. Global mode only reads it.
 */
export function alignQuadratic(
  spec: FillSpec,
  endState: StateId | typeof ANY_END = ANY_END,
): TracedPath | null {
  const { i0, i1, j0, j1, mode } = spec;
  const n = i1 - i0;
  const m = j1 - j0;
  const W = m + 1;
  const ptr = new Uint8Array((n + 1) * W);
  const { M, X, Y, best } = fillForward(spec, n, ptr);

  let score: number;
  let state: StateId;
  let i: number;
  let j: number;
  if (mode === 'global') {
    i = n;
    j = m;
    const finals: readonly number[] = [M[m] as number, X[m] as number, Y[m] as number];
    state = State.Pair;
    score = NEG;
    for (const s of [State.Pair, State.GapInB, State.GapInA] as const) {
      if ((endState === ANY_END || endState === s) && (finals[s] as number) > score) {
        score = finals[s] as number;
        state = s;
      }
    }
    if (score === NEG) return null;
  } else {
    if (best.score === NEG || (mode === 'local' && best.score <= 0)) {
      return { score: 0, ops: new Uint8Array(0), startI: i0, startJ: j0, endI: i0, endJ: j0 };
    }
    score = best.score;
    state = best.state;
    i = best.i - i0;
    j = best.j - j0;
  }

  const endI = i0 + i;
  const endJ = j0 + j;
  if (mode === 'overlap' && (i === 0 || j === 0)) {
    return { score, ops: new Uint8Array(0), startI: endI, startJ: endJ, endI, endJ };
  }
  const buffer = new Uint8Array(n + m);
  let k = 0;
  const overlap = mode === 'overlap';
  const global = mode === 'global';
  while (global ? i > 0 || j > 0 : true) {
    const p = ptr[i * W + j] as number;
    if (state === State.Pair) {
      buffer[k++] = Op.Pair;
      i--;
      j--;
      const pred = p & 3;
      if (pred === START) break;
      state = pred as StateId;
    } else if (state === State.GapInB) {
      buffer[k++] = Op.GapInB;
      i--;
      state = ((p >> 2) & 3) as StateId;
    } else {
      buffer[k++] = Op.GapInA;
      j--;
      state = ((p >> 4) & 3) as StateId;
    }
    if (overlap && (i === 0 || j === 0)) break;
  }
  const ops = buffer.subarray(0, k).reverse();
  return { score, ops, startI: i0 + i, startJ: j0 + j, endI, endJ };
}
