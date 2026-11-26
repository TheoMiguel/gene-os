import { LADDERS, type Ladder, migrationPosition, resolvingRange, suggestLadder } from '../../../engine/gel';

/** Agarose percentages the gel offers. The engine's resolving table covers 0.3 to 2 %, so the control stops at 2. */
export const AGAROSE_MIN = 0.5;
export const AGAROSE_MAX = 2;
export const AGAROSE_STEP = 0.1;

const CANDIDATES = [0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.5, 1.8, 2] as const;

/**
 * Two bands closer than this fraction of the lane look like one smear on the picture: with bands 4 to 9 px thick
 * on a gel about 300 px long, a gap of 3 % is under 10 px. This is a display heuristic for the warning, not a
 * reference value; the engine merges bands only below a gap of 0.8 %.
 */
export const RESOLVABLE_GAP = 0.03;
/** The engine's own merge threshold: bands closer than this are drawn as one band. */
const MERGED_GAP = 0.008;

/** Fragments that sit too close on the gel to tell apart. */
export interface CloseGroup {
  /** Fragment sizes in bp, largest first. */
  readonly sizes: readonly number[];
  /** The engine draws them as one band. */
  readonly merged: boolean;
  /** Every fragment has the same size, so no agarose percentage can separate them. */
  readonly identical: boolean;
}

/** Groups of fragments whose bands lie within `RESOLVABLE_GAP` of their neighbour at this agarose percentage. */
export function closeGroups(sizes: readonly number[], agarose: number): CloseGroup[] {
  const placed = sizes
    .filter((bp) => bp > 0)
    .map((bp) => ({ bp, position: migrationPosition(bp, agarose) }))
    .sort((a, b) => a.position - b.position);
  const groups: { bp: number[]; merged: boolean }[] = [];
  let previous: (typeof placed)[number] | undefined;
  for (const band of placed) {
    const gap = previous ? band.position - previous.position : Number.POSITIVE_INFINITY;
    if (previous && gap < RESOLVABLE_GAP) {
      const group = groups[groups.length - 1];
      group?.bp.push(band.bp);
      if (group && gap < MERGED_GAP) group.merged = true;
    } else {
      groups.push({ bp: [band.bp], merged: false });
    }
    previous = band;
  }
  return groups
    .filter((group) => group.bp.length > 1)
    .map((group) => {
      const bp = [...group.bp].sort((a, b) => b - a);
      return { sizes: bp, merged: group.merged, identical: bp.every((value) => value === bp[0]) };
    });
}

/** An agarose percentage that leaves fewer close groups than `current`, or null when none does. */
export function suggestAgarose(sizes: readonly number[], current: number): number | null {
  const base = closeGroups(sizes, current).length;
  let best: { percent: number; groups: number } | null = null;
  for (const percent of CANDIDATES) {
    const groups = closeGroups(sizes, percent).length;
    if (groups >= base) continue;
    if (
      !best ||
      groups < best.groups ||
      (groups === best.groups && Math.abs(percent - current) < Math.abs(best.percent - current))
    )
      best = { percent, groups };
  }
  return best?.percent ?? null;
}

/**
 * The agarose percentage that suits a size range: the one whose resolving range holds the most fragments, then
 * the one that leaves the fewest close groups, then the one nearest 1 %, the usual first choice.
 */
export function defaultAgarose(sizes: readonly number[]): number {
  const positive = sizes.filter((bp) => bp > 0);
  if (positive.length === 0) return 1;
  let best = { percent: 1, inside: -1, groups: Number.POSITIVE_INFINITY };
  for (const percent of CANDIDATES) {
    const { minBp, maxBp } = resolvingRange(percent);
    const inside = positive.filter((bp) => bp >= minBp && bp <= maxBp).length;
    const groups = closeGroups(positive, percent).length;
    const better =
      inside > best.inside ||
      (inside === best.inside &&
        (groups < best.groups ||
          (groups === best.groups && Math.abs(percent - 1) < Math.abs(best.percent - 1))));
    if (better) best = { percent, inside, groups };
  }
  return best.percent;
}

/** The ladder the engine suggests for these sizes, or the first catalog entry when there are none. */
export function autoLadder(sizes: readonly number[]): Ladder {
  return sizes.some((bp) => bp > 0) ? suggestLadder(sizes) : (LADDERS[0] as Ladder);
}

/** Size with thousands separators and the unit, as shown on the picture. */
export function formatBp(bp: number): string {
  return `${Math.round(bp).toLocaleString('en-US')} bp`;
}

/** Height in px of a band of this relative intensity: more DNA gives a thicker band. */
export function bandThickness(intensity: number): number {
  return 2.2 + 7 * Math.sqrt(Math.min(1, Math.max(0, intensity)));
}

/** Opacity of a band core: faint bands stay visible, the heaviest band is solid. */
export function bandBrightness(intensity: number): number {
  return 0.2 + 0.8 * Math.sqrt(Math.min(1, Math.max(0, intensity)));
}

/** A small stable pseudo-random number in 0..1 from two integers, so a gel looks organic and never changes between renders. */
export function jitter(a: number, b: number): number {
  let h = (Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
