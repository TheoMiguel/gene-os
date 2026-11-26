import { sliceCircular } from '../../../engine/location';
import {
  DEFAULT_DESIGN,
  type DesignConstraints,
  type DesignedPrimer,
  designPrimers,
  type PrimerPair,
} from '../../../engine/primers';
import type { Span, Topology } from '../../../engine/types';

/**
 * Designs primer pairs around `target` and returns them with spans in the coordinates of the whole sequence.
 *
 * `designPrimers` works on a linear string, so this gives it only the window the product can span: the target and
 * `productSize.max` bases on each side. On a circular sequence the window may cross the origin, and a returned span
 * may then end past the sequence length, as a binding does. A target that wraps has `end <= start`.
 * Returns an empty list when the target is empty or does not fit in the sequence.
 */
export function designForRegion(
  seq: string,
  topology: Topology,
  target: Span,
  constraints: Partial<DesignConstraints> = {},
): PrimerPair[] {
  const n = seq.length;
  const c = { ...DEFAULT_DESIGN, ...constraints };
  const wraps = topology === 'circular' && target.end <= target.start;
  const size = wraps ? n - target.start + target.end : target.end - target.start;
  if (n === 0 || size <= 0 || size > n || target.start < 0 || target.end > n) return [];

  if (topology === 'linear') {
    const from = Math.max(0, target.start - c.productSize.max);
    const to = Math.min(n, target.end + c.productSize.max);
    return designPrimers(
      seq.slice(from, to),
      { start: target.start - from, end: target.end - from },
      constraints,
    ).map((pair) => shift(pair, from, n, false));
  }
  const flank = Math.min(c.productSize.max, Math.floor((n - size) / 2));
  const offset = (((target.start - flank) % n) + n) % n;
  const window = sliceCircular(seq, offset, size + 2 * flank);
  return designPrimers(window, { start: flank, end: flank + size }, constraints).map((pair) =>
    shift(pair, offset, n, true),
  );
}

function shift(pair: PrimerPair, by: number, n: number, circular: boolean): PrimerPair {
  const move = (primer: DesignedPrimer): DesignedPrimer => {
    const start = circular ? (primer.span.start + by) % n : primer.span.start + by;
    return { ...primer, span: { start, end: start + (primer.span.end - primer.span.start) } };
  };
  return { ...pair, forward: move(pair.forward), reverse: move(pair.reverse) };
}

/** The terms of one primer's penalty. Their sum is the primer's penalty. */
export interface PrimerTerms {
  /** °C between the primer's Tm and the optimum Tm. */
  readonly tm: number;
  /** Bases between the primer's length and the optimum length. */
  readonly length: number;
  /** 0.1 per kcal/mol of hairpin and self-dimer deltaG below 0. */
  readonly structure: number;
  readonly total: number;
}

/** Why a pair scored as it did: the penalty terms of each primer and of the pair. */
export interface PairExplanation {
  readonly forward: PrimerTerms;
  readonly reverse: PrimerTerms;
  /** °C between the two Tm values. */
  readonly deltaTm: number;
  /** 0.1 per kcal/mol of cross-dimer deltaG below 0. */
  readonly crossDimer: number;
  readonly total: number;
}

function termsOf(primer: DesignedPrimer, c: DesignConstraints): PrimerTerms {
  const tm = Math.abs(primer.tm - c.tm.opt);
  const length = Math.abs(primer.span.end - primer.span.start - c.length.opt);
  const structure = 0.1 * (-primer.hairpinDg - primer.selfDimerDg);
  return { tm, length, structure, total: tm + length + structure };
}

/**
 * Breaks the penalty of a designed pair into the terms the engine adds up (the primer3 default weighting): per
 * primer the distance from the optimum Tm and length plus a structure term, then the Tm difference and the
 * cross-dimer term. A lower total ranks higher.
 */
export function explainPair(pair: PrimerPair, constraints: Partial<DesignConstraints> = {}): PairExplanation {
  const c = { ...DEFAULT_DESIGN, ...constraints };
  const forward = termsOf(pair.forward, c);
  const reverse = termsOf(pair.reverse, c);
  const crossDimer = -0.1 * pair.crossDimerDg;
  return {
    forward,
    reverse,
    deltaTm: pair.deltaTm,
    crossDimer,
    total: forward.total + reverse.total + pair.deltaTm + crossDimer,
  };
}
