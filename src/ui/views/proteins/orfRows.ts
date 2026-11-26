import { proteinWeight } from '../../../engine/composition';
import { locationLength, regionStart } from '../../../engine/location';
import type { Orf } from '../../../engine/orf';
import { gravy, isoelectricPoint } from '../../../engine/protein';
import type { Frame } from '../../../engine/translate';
import type { Strand } from '../../../engine/types';

/** One ORF as the table and the map show it. */
export interface OrfRow {
  /** `ORF1`, `ORF2`, ... in order of position along the sequence. */
  readonly id: string;
  readonly orf: Orf;
  readonly frame: Frame;
  /** First base of the ORF, 1-based on the top strand. On the minus strand this is its lowest position. */
  readonly start: number;
  /** Last base, 1-based. Smaller than `start` when the ORF crosses the origin of a circular sequence. */
  readonly end: number;
  readonly lengthAa: number;
  readonly weight: number;
  readonly pI: number;
  readonly gravy: number;
}

/** A range on the top strand, 0-based half-open, with the strand an ORF sits on. */
export interface OrfSpan {
  readonly start: number;
  readonly end: number;
  readonly strand: Strand;
}

/** Identifies an ORF across rescans: its frame, first base and length. */
export function orfKey(orf: Orf): string {
  return `${orf.frame}:${regionStart(orf.location)}:${locationLength(orf.location)}`;
}

/**
 * The range the shared selection takes for an ORF: the segment that holds its 5' end. The selection cannot
 * cross the origin, so an ORF that wraps selects the part before it.
 */
export function orfSpan(orf: Orf): OrfSpan {
  const first = orf.location.segments[0] as { start: number; end: number };
  return { start: first.start, end: first.end, strand: orf.location.strand };
}

/** Table rows for a scan result: the numbering, the 1-based coordinates and the protein properties. */
export function orfRows(orfs: readonly Orf[], seqLength: number): OrfRow[] {
  return orfs.map((orf, index) => {
    const first = regionStart(orf.location);
    const length = locationLength(orf.location);
    return {
      id: `ORF${index + 1}`,
      orf,
      frame: orf.frame,
      start: first + 1,
      end: ((first + length - 1) % seqLength) + 1,
      lengthAa: orf.lengthAa,
      weight: proteinWeight(orf.protein),
      pI: isoelectricPoint(orf.protein),
      gravy: gravy(orf.protein),
    };
  });
}

/** `+1`, `-2`: a frame as the user reads it. */
export function frameLabel(frame: Frame): string {
  return frame > 0 ? `+${frame}` : `${frame}`;
}
