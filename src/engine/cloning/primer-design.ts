import { reverseComplement } from '../alphabet';
import { PRIMER3_CONDITIONS, tmNearestNeighbor } from '../primers';
import type { PrimerConditions } from '../types';
import type { CloningWarning, Piece, PlannedPrimer } from './model';
import { pieceRegionSeq } from './piece';

export interface PrimerOptions {
  /** Tm the annealing part should reach, °C. Default 60. */
  readonly targetTm?: number;
  /** Shortest and longest annealing part, bases. Default 18 and 35. */
  readonly annealRange?: { readonly min: number; readonly max: number };
  readonly conditions?: PrimerConditions;
}

const DEFAULT_RANGE = { min: 18, max: 35 };
/** A primer longer than this is expensive and error-prone to order. */
const LONG_PRIMER = 60;

/** Shortest prefix of `seq` (5'→3') whose nearest-neighbor Tm reaches the target, within the allowed range. */
function annealingPrefix(seq: string, options: PrimerOptions): { length: number; tm: number } {
  const target = options.targetTm ?? 60;
  const range = options.annealRange ?? DEFAULT_RANGE;
  const conditions = options.conditions ?? PRIMER3_CONDITIONS;
  const max = Math.min(range.max, seq.length);
  let length = Math.min(range.min, max);
  let tm = tmNearestNeighbor(seq.slice(0, length), conditions);
  while (tm < target && length < max) {
    length++;
    tm = tmNearestNeighbor(seq.slice(0, length), conditions);
  }
  return { length, tm };
}

export interface DesignedEnds {
  readonly piece: Piece;
  readonly primers: PlannedPrimer[];
  readonly warnings: CloningWarning[];
}

/**
 * Designs the two primers that amplify a piece: the forward primer is the piece's left added bases plus the
 * annealing start of its region, the reverse primer the reverse complement of the region's end plus the right
 * added bases. Each annealing part is the shortest that reaches the target Tm. Returns the piece with its primer
 * anchors set.
 */
export function designPieceEnds(piece: Piece, options: PrimerOptions = {}): DesignedEnds {
  const region = pieceRegionSeq(piece);
  const conditions = options.conditions ?? PRIMER3_CONDITIONS;
  const forward = annealingPrefix(region, options);
  const reverse = annealingPrefix(reverseComplement(region), options);
  const forwardSeq = piece.leftAdd + region.slice(0, forward.length);
  const reverseSeq = reverseComplement(region.slice(region.length - reverse.length) + piece.rightAdd);
  const make = (suffix: 'F' | 'R', seq: string, anneal: number, tail: number): PlannedPrimer => ({
    id: `${piece.name}-${suffix}`,
    name: `${piece.name}-${suffix}`,
    seq,
    annealLength: anneal,
    tailLength: tail,
    tm: tmNearestNeighbor(seq.slice(seq.length - anneal), conditions),
    templateId: piece.record.id,
  });
  const primers = [
    make('F', forwardSeq, forward.length, piece.leftAdd.length),
    make('R', reverseSeq, reverse.length, piece.rightAdd.length),
  ];
  const target = options.targetTm ?? 60;
  const warnings: CloningWarning[] = [];
  for (const primer of primers) {
    if (primer.tm < target - 3) warnings.push({ code: 'primer_tm_low', primer: primer.name, tm: primer.tm });
    if (primer.seq.length > LONG_PRIMER)
      warnings.push({ code: 'primer_long', primer: primer.name, length: primer.seq.length });
  }
  return {
    piece: {
      ...piece,
      forward: { primerId: primers[0]?.id ?? '', anneal: forward.length },
      reverse: { primerId: primers[1]?.id ?? '', anneal: reverse.length },
    },
    primers,
    warnings,
  };
}
