import { reverseComplement } from '../alphabet';
import { sliceCircular } from '../location';
import { digest, scanSites } from '../restriction';
import type { EndType, Enzyme, FragmentEnd, SeqRecord, Strand } from '../types';
import type { Junction, Part, Piece, PieceEnd, Region } from './model';

const mod = (value: number, length: number) => ((value % length) + length) % length;

/** The region of a part as `{start, length}`; the whole record when the part names none. */
export function partRegion(part: Part): Region {
  return part.region ?? { start: 0, length: part.record.seq.length };
}

/** True when the region lies on the record: inside it, or anywhere with a length up to the record's when circular. */
export function regionFits(record: SeqRecord, region: Region): boolean {
  const n = record.seq.length;
  if (!(region.length >= 1 && region.length <= n)) return false;
  if (record.topology === 'circular') return region.start >= 0 && region.start < n;
  return region.start >= 0 && region.start + region.length <= n;
}

/** Bases of the region on the top strand of its record (wrapping the origin of a circular record). */
export function regionSeq(record: SeqRecord, start: number, length: number): string {
  return record.topology === 'circular'
    ? sliceCircular(record.seq, start, length)
    : record.seq.slice(start, start + length);
}

/** Builds a piece that reads a whole part's region on the top strand, with no added bases. */
export function pieceFromPart(part: Part, role: Piece['role'], strand: Strand = 1): Piece {
  const { start, length } = partRegion(part);
  return {
    name: part.id,
    role,
    record: part.record,
    start,
    length,
    strand,
    leftAdd: '',
    rightAdd: '',
  };
}

/** The region of a piece in the piece's own orientation. */
export function pieceRegionSeq(piece: Piece): string {
  const top = regionSeq(piece.record, piece.start, piece.length).toUpperCase();
  return piece.strand === 1 ? top : reverseComplement(top);
}

/** The full top strand of a piece: added bases, region, added bases. */
export function pieceSeq(piece: Piece): string {
  return piece.leftAdd + pieceRegionSeq(piece) + piece.rightAdd;
}

function flipEnd(end: PieceEnd | undefined): PieceEnd | undefined {
  return end && { ...end, overhang: reverseComplement(end.overhang) };
}

/**
 * The same molecule read from the other strand: its new top strand is the old bottom strand. With sticky ends the
 * bottom strand covers other bases than the top strand: a 5' end drops its overhang from the top-strand extent
 * at the left and adds it at the right, a 3' end the other way round. Ends swap and sequences are
 * reverse-complemented.
 */
export function flipPiece(piece: Piece): Piece {
  let bottom = piece;
  const { leftEnd, rightEnd } = piece;
  if (leftEnd?.type === 'five_prime') bottom = trimPiece(bottom, leftEnd.overhang.length, 0) ?? bottom;
  if (leftEnd?.type === 'three_prime') bottom = { ...bottom, leftAdd: leftEnd.overhang + bottom.leftAdd };
  if (rightEnd?.type === 'five_prime') bottom = { ...bottom, rightAdd: bottom.rightAdd + rightEnd.overhang };
  if (rightEnd?.type === 'three_prime') bottom = trimPiece(bottom, 0, rightEnd.overhang.length) ?? bottom;
  return {
    ...bottom,
    strand: piece.strand === 1 ? -1 : 1,
    leftAdd: reverseComplement(bottom.rightAdd),
    rightAdd: reverseComplement(bottom.leftAdd),
    leftEnd: flipEnd(rightEnd),
    rightEnd: flipEnd(leftEnd),
    forward: piece.reverse,
    reverse: piece.forward,
  };
}

/**
 * Removes `left` bases from the start and `right` bases from the end of a piece's full top strand, consuming the
 * added bases first and then the region. Returns undefined when the cuts reach past the region.
 */
export function trimPiece(piece: Piece, left: number, right: number): Piece | undefined {
  const dropLeftAdd = Math.min(left, piece.leftAdd.length);
  const dropRightAdd = Math.min(right, piece.rightAdd.length);
  const intoLeft = left - dropLeftAdd;
  const intoRight = right - dropRightAdd;
  const length = piece.length - intoLeft - intoRight;
  if (length < 0) return undefined;
  const start = piece.strand === 1 ? piece.start + intoLeft : piece.start + intoRight;
  const anchor = (a: Piece['forward'], into: number) => a && { ...a, anneal: Math.max(0, a.anneal - into) };
  return {
    ...piece,
    start: piece.record.topology === 'circular' ? mod(start, piece.record.seq.length) : start,
    length,
    leftAdd: piece.leftAdd.slice(dropLeftAdd),
    rightAdd: piece.rightAdd.slice(0, piece.rightAdd.length - dropRightAdd),
    forward: anchor(piece.forward, intoLeft),
    reverse: anchor(piece.reverse, intoRight),
  };
}

function toPieceEnd(end: FragmentEnd): PieceEnd {
  return end.kind === 'cut'
    ? { type: end.end, overhang: end.overhang, source: end.enzyme }
    : { type: 'blunt', overhang: '', source: 'terminus' };
}

export interface DigestedPiece {
  readonly piece: Piece;
  /** True when the end was made by an enzyme (not the terminus of a linear molecule). */
  readonly cutLeft: boolean;
  readonly cutRight: boolean;
}

/** True when the piece is a whole circular record with nothing added, so it digests as a circle. */
function isWholeCircle(piece: Piece): boolean {
  return (
    piece.record.topology === 'circular' &&
    piece.strand === 1 &&
    piece.length === piece.record.seq.length &&
    piece.leftAdd === '' &&
    piece.rightAdd === ''
  );
}

/**
 * Digests a piece with the given enzymes and returns its fragments as pieces whose ends carry the cut. A whole
 * circular record digests as a circle; anything else (a PCR product, a region) digests as a linear molecule.
 */
export function digestPiece(piece: Piece, enzymes: readonly Enzyme[]): DigestedPiece[] {
  const circular = isWholeCircle(piece);
  const seq = pieceSeq(piece);
  const topology = circular ? 'circular' : 'linear';
  const fragments = digest(seq, topology, scanSites(seq, topology, enzymes).sites);
  const result: DigestedPiece[] = [];
  for (const fragment of fragments) {
    const first = fragment.location.segments[0];
    if (!first) continue;
    const leftEnd = toPieceEnd(fragment.leftEnd);
    const rightEnd = toPieceEnd(fragment.rightEnd);
    const base: Piece | undefined = circular
      ? { ...piece, start: mod(piece.start + first.start, seq.length), length: fragment.length }
      : trimPiece(piece, first.start, seq.length - first.start - fragment.length);
    if (!base) continue;
    result.push({
      piece: { ...base, leftEnd, rightEnd },
      cutLeft: fragment.leftEnd.kind === 'cut',
      cutRight: fragment.rightEnd.kind === 'cut',
    });
  }
  return result;
}

/** True when two ends anneal: the right end of one piece and the left end of the next, in the same orientation. */
export function endsCompatible(right: PieceEnd, left: PieceEnd): boolean {
  return right.type === left.type && right.overhang === left.overhang;
}

/** Whether an end is blunt, 5' or 3'. */
export function describeEnd(end: PieceEnd): { type: EndType; overhang: string; source: string } {
  return { type: end.type, overhang: end.overhang, source: end.source };
}

/** The junction where `right` (the end of one piece) meets `left` (the start of the next): sticky or blunt, no shared bases. */
export function stickyJunction(right: PieceEnd, left: PieceEnd): Junction {
  const length = left.overhang.length;
  const blunt = left.type === 'blunt';
  const offset = left.type === 'three_prime' ? -length : 0;
  return {
    kind: blunt ? 'blunt' : 'sticky',
    label: `${right.source}/${left.source}`,
    overlap: 0,
    mark: { offset, length },
  };
}
