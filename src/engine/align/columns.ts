import { pairScore, residuesMatch, type Scorer } from './scoring';
import { type AlignmentStats, ColumnClass, type Difference } from './types';

/** Removes the columns where both rows hold a gap, which a pairwise view of an MSA must ignore. */
export function dropSharedGaps(a: string, b: string): [string, string] {
  let outA = '';
  let outB = '';
  for (let c = 0; c < a.length; c++) {
    if (a[c] === '-' && b[c] === '-') continue;
    outA += a[c];
    outB += b[c];
  }
  return [outA, outB];
}

/** Class of each column of two aligned rows of equal length. */
export function classifyColumns(scorer: Scorer, a: string, b: string): Uint8Array {
  const classes = new Uint8Array(a.length);
  for (let c = 0; c < a.length; c++) {
    const x = a[c] as string;
    const y = b[c] as string;
    if (x === '-' || y === '-') classes[c] = ColumnClass.Gap;
    else if (residuesMatch(scorer, x, y)) classes[c] = ColumnClass.Identical;
    else classes[c] = pairScore(scorer, x, y) > 0 ? ColumnClass.Similar : ColumnClass.Mismatch;
  }
  return classes;
}

/** Index range of the columns between the leading and trailing gap runs. */
export function coreColumns(a: string, b: string): [number, number] {
  let from = 0;
  let to = a.length;
  while (from < to && (a[from] === '-' || b[from] === '-')) from++;
  while (to > from && (a[to - 1] === '-' || b[to - 1] === '-')) to--;
  return [from, to];
}

/** Counts and percentages over columns `[from, to)`. Gap runs break where the gap changes row. */
export function computeStats(
  classes: Uint8Array,
  a: string,
  b: string,
  from = 0,
  to = classes.length,
): AlignmentStats {
  let identical = 0;
  let similar = 0;
  let mismatches = 0;
  let gapColumns = 0;
  let gapRuns = 0;
  let previousGap = 0;
  for (let c = from; c < to; c++) {
    const cls = classes[c] as number;
    if (cls === ColumnClass.Identical) identical++;
    else if (cls === ColumnClass.Similar) similar++;
    else if (cls === ColumnClass.Mismatch) mismatches++;
    else gapColumns++;
    const gap = a[c] === '-' ? 1 : b[c] === '-' ? 2 : 0;
    if (gap !== 0 && gap !== previousGap) gapRuns++;
    previousGap = gap;
  }
  const length = to - from;
  return {
    length,
    identical,
    similar,
    mismatches,
    gapColumns,
    gapRuns,
    percentIdentity: length === 0 ? 0 : (100 * identical) / length,
    percentSimilarity: length === 0 ? 0 : (100 * (identical + similar)) / length,
  };
}

/**
 * Differences of `alt` against `ref`, two aligned rows of equal length. `refStart` and `altStart` are the positions of
 * their first residue in the original sequences. Shared gap columns are skipped. The scorer decides which letters
 * are one residue (RNA U and DNA T); without it, only equal letters match.
 */
export function findDifferences(
  ref: string,
  alt: string,
  scorer?: Scorer,
  refStart = 0,
  altStart = 0,
): Difference[] {
  const [a, b] = dropSharedGaps(ref, alt);
  const out: Difference[] = [];
  let i = refStart;
  let j = altStart;
  let c = 0;
  const n = a.length;
  while (c < n) {
    const x = a[c] as string;
    const y = b[c] as string;
    if (x !== '-' && y !== '-') {
      if (!(scorer ? residuesMatch(scorer, x, y) : x === y)) {
        out.push({
          kind: 'substitution',
          refStart: i,
          refEnd: i + 1,
          altStart: j,
          altEnd: j + 1,
          ref: x,
          alt: y,
          terminal: false,
        });
      }
      i++;
      j++;
      c++;
      continue;
    }
    const start = c;
    const insertion = x === '-';
    const inRun = (k: number) => (insertion ? a[k] === '-' && b[k] !== '-' : b[k] === '-' && a[k] !== '-');
    while (c < n && inRun(c)) c++;
    const run = c - start;
    const terminal = start === 0 || c === n;
    if (insertion) {
      out.push({
        kind: 'insertion',
        refStart: i,
        refEnd: i,
        altStart: j,
        altEnd: j + run,
        ref: '',
        alt: b.slice(start, c),
        terminal,
      });
      j += run;
    } else {
      out.push({
        kind: 'deletion',
        refStart: i,
        refEnd: i + run,
        altStart: j,
        altEnd: j,
        ref: a.slice(start, c),
        alt: '',
        terminal,
      });
      i += run;
    }
  }
  return out;
}
