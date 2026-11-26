import {
  ANY_END,
  alignQuadratic,
  type Band,
  type FillSpec,
  fillForward,
  type Region,
  type RowScorer,
  State,
  type StateId,
  type TracedPath,
} from './kernel';

const NEG = Number.NEGATIVE_INFINITY;

/** A region at most this many cells is aligned with a stored traceback instead of being split again. */
export const BASE_CELLS = 1 << 24;

export interface GlobalProblem {
  readonly rows: RowScorer;
  readonly n: number;
  readonly m: number;
  readonly go: number;
  readonly ge: number;
  readonly band?: Band;
}

interface Split {
  readonly j: number;
  readonly state: StateId;
  readonly score: number;
}

/**
 * Suffix scores at row `stopRow`: the best score of the path from each cell to the region's end, for each state the
 * cell was reached in. A gap state continues its gap without paying the open penalty again.
 */
function fillBackward(spec: FillSpec, endState: StateId | typeof ANY_END, stopRow: number) {
  const { rows, i1, j0, j1, go, ge, band } = spec;
  const m = j1 - j0;
  const RM = new Float64Array(m + 1).fill(NEG);
  const RX = new Float64Array(m + 1).fill(NEG);
  const RY = new Float64Array(m + 1).fill(NEG);
  const dlo = band?.dlo ?? NEG;
  const dhi = band?.dhi ?? Number.POSITIVE_INFINITY;
  for (let i = i1; i >= stopRow; i--) {
    const scores = i < i1 ? rows.row(i) : null;
    const jlo = Math.max(0, dlo + i - j0);
    const jhi = Math.min(m, dhi + i - j0);
    let dM = jhi + 1 <= m ? (RM[jhi + 1] as number) : NEG;
    if (jhi + 1 <= m) {
      RM[jhi + 1] = NEG;
      RX[jhi + 1] = NEG;
      RY[jhi + 1] = NEG;
    }
    for (let j = jhi; j >= jlo; j--) {
      const oM = RM[j] as number;
      const V = RX[j] as number;
      if (i === i1 && j === m) {
        const open = endState === ANY_END;
        RM[j] = open || endState === State.Pair ? 0 : NEG;
        RX[j] = open || endState === State.GapInB ? 0 : NEG;
        RY[j] = open || endState === State.GapInA ? 0 : NEG;
        dM = oM;
        continue;
      }
      const D = scores && j < m ? (scores[j0 + j] as number) + dM : NEG;
      const H = j < m ? (RY[j + 1] as number) : NEG;
      const openV = go + V;
      const openH = go + H;
      RM[j] = Math.max(D, openV, openH);
      RX[j] = Math.max(D, ge + V, openH);
      RY[j] = Math.max(D, openV, ge + H);
      dM = oM;
    }
    if (jlo > 0) {
      RM[jlo - 1] = NEG;
      RX[jlo - 1] = NEG;
      RY[jlo - 1] = NEG;
    }
  }
  return { M: RM, X: RX, Y: RY };
}

/** Row `mid` cell and state through which an optimal path of the region passes. Ties go to the lowest column, then M, X, Y. */
function findSplit(spec: FillSpec, endState: StateId | typeof ANY_END, mid: number): Split | null {
  const { i0, j0, j1, band } = spec;
  const m = j1 - j0;
  const forward = fillForward(spec, mid - i0);
  const backward = fillBackward(spec, endState, mid);
  const jlo = Math.max(0, (band?.dlo ?? NEG) + mid - j0);
  const jhi = Math.min(m, (band?.dhi ?? Number.POSITIVE_INFINITY) + mid - j0);
  let best: Split | null = null;
  for (let j = jlo; j <= jhi; j++) {
    const totals = [
      (forward.M[j] as number) + (backward.M[j] as number),
      (forward.X[j] as number) + (backward.X[j] as number),
      (forward.Y[j] as number) + (backward.Y[j] as number),
    ];
    for (const state of [State.Pair, State.GapInB, State.GapInA] as const) {
      const total = totals[state] as number;
      if (total > (best?.score ?? NEG)) best = { j: j0 + j, state, score: total };
    }
  }
  return best;
}

/**
 * Optimal global alignment in linear space: Myers and Miller's affine-gap form of Hirschberg's divide and conquer.
 * With a band, the result is the optimum over paths inside it, or null when none exists. A region of at most
 * `baseCells` cells is solved with a stored traceback instead of being split again.
 */
export function alignHirschberg(problem: GlobalProblem, baseCells = BASE_CELLS): TracedPath | null {
  const { rows, n, m, go, ge, band } = problem;
  const ops = new Uint8Array(n + m);
  let length = 0;
  let score = NEG;

  const solve = (
    region: Region,
    startState: StateId,
    endState: StateId | typeof ANY_END,
    top: boolean,
  ): boolean => {
    const { i0, i1, j0, j1 } = region;
    const spec: FillSpec = { ...region, rows, go, ge, mode: 'global', startState, ...(band && { band }) };
    const rowCount = i1 - i0;
    if (rowCount <= 1 || (rowCount + 1) * (j1 - j0 + 1) <= baseCells) {
      const path = alignQuadratic(spec, endState);
      if (!path) return false;
      ops.set(path.ops, length);
      length += path.ops.length;
      if (top) score = path.score;
      return true;
    }
    const mid = i0 + (rowCount >> 1);
    const split = findSplit(spec, endState, mid);
    if (!split) return false;
    if (top) score = split.score;
    return (
      solve({ i0, i1: mid, j0, j1: split.j }, startState, split.state, false) &&
      solve({ i0: mid, i1, j0: split.j, j1 }, split.state, endState, false)
    );
  };

  if (!solve({ i0: 0, i1: n, j0: 0, j1: m }, State.Pair, ANY_END, true)) return null;
  return { score, ops: ops.slice(0, length), startI: 0, startJ: 0, endI: n, endJ: m };
}

/** First half-width tried by the band search. */
const BAND_START = 32;

export type GlobalOutcome =
  | { readonly status: 'ok'; readonly path: TracedPath; readonly banded: boolean }
  | { readonly status: 'too-large'; readonly cells: number };

/**
 * Exact global alignment of two long sequences. It first tries a narrow band around the diagonals and doubles the
 * band until the best banded score is at least an upper bound for any path that leaves it, so the answer is the true
 * optimum. Similar sequences finish in a narrow band; unrelated ones end with the full lattice.
 * `maxScore` is the largest substitution score. `maxCells` caps the lattice area of one attempt.
 */
export function alignGlobalLinear(
  problem: Omit<GlobalProblem, 'band'>,
  maxScore: number,
  maxCells: number,
): GlobalOutcome {
  const { n, m, go, ge } = problem;
  const full = (n + 1) * (m + 1);
  const cheapestGap = Math.min(-go, -ge);
  if (cheapestGap > 0 && maxScore > 0) {
    for (let w = BAND_START; ; w *= 2) {
      const band = { dlo: Math.min(0, m - n) - w, dhi: Math.max(0, m - n) + w };
      const cells = (n + 1) * Math.min(m + 1, band.dhi - band.dlo + 1);
      if (cells * 2 >= full) break;
      if (cells > maxCells) return { status: 'too-large', cells };
      const path = alignHirschberg({ ...problem, band });
      const gapColumns = Math.abs(m - n) + 2 * (w + 1);
      const bound = Math.max(0, (n + m - gapColumns) / 2) * maxScore - gapColumns * cheapestGap;
      if (path && path.score >= bound) return { status: 'ok', path, banded: true };
    }
  }
  if (full > maxCells) return { status: 'too-large', cells: full };
  const path = alignHirschberg(problem) as TracedPath;
  return { status: 'ok', path, banded: false };
}
