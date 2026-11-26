import { reverseComplement } from './alphabet';
import type { Alphabet, Location, Span, Strand } from './types';

/** Number of bases a span covers. */
export function spanLength(span: Span): number {
  return span.end - span.start;
}

/** Total bases covered by every segment of a location. */
export function locationLength(location: Location): number {
  let total = 0;
  for (const segment of location.segments) total += spanLength(segment);
  return total;
}

/** Smallest span that covers all segments (the feature's extent on the top strand, ignoring the origin split). */
export function locationBounds(location: Location): Span {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const segment of location.segments) {
    start = Math.min(start, segment.start);
    end = Math.max(end, segment.end);
  }
  return { start, end };
}

/** True when the 0-based top-strand position lies inside one of the location's segments. */
export function locationContains(location: Location, position: number): boolean {
  return location.segments.some((segment) => position >= segment.start && position < segment.end);
}

/** True when the location is made of more than one segment. */
export function isSplit(location: Location): boolean {
  return location.segments.length > 1;
}

/**
 * Builds the location of `length` bases that begin at `start` on a circular sequence of `seqLength` bases.
 * `start` is taken modulo the sequence length. A region that runs past the end is split into two segments
 * (`[start, seqLength)` and `[0, rest)`), listed 5'→3' of the feature: top-strand order for strand 1 and the
 * reverse for strand -1, so the first segment is always the feature's 5' end.
 * Throws when `length` is not between 1 and `seqLength`.
 */
export function circularLocation(start: number, length: number, seqLength: number, strand: Strand): Location {
  if (!(length >= 1 && length <= seqLength)) {
    throw new RangeError(`length ${length} is outside 1..${seqLength}`);
  }
  const s = ((start % seqLength) + seqLength) % seqLength;
  const end = s + length;
  if (end <= seqLength) return { segments: [{ start: s, end }], strand };
  const head: Span = { start: s, end: seqLength };
  const tail: Span = { start: 0, end: end - seqLength };
  return { segments: strand === 1 ? [head, tail] : [tail, head], strand };
}

/** Location of one contiguous region on a linear sequence. */
export function linearLocation(start: number, end: number, strand: Strand): Location {
  return { segments: [{ start, end }], strand };
}

/**
 * Top-strand start of a location's region in the sense `circularLocation` builds it: the origin-side segment
 * that opens the region. Inverse of `circularLocation` for a one- or two-segment location.
 */
export function regionStart(location: Location): number {
  const first = location.segments[0] as Span;
  const last = location.segments[location.segments.length - 1] as Span;
  return location.strand === 1 ? first.start : last.start;
}

/** `length` bases of a circular sequence starting at `start` (taken modulo the length), across the origin if needed. */
export function sliceCircular(seq: string, start: number, length: number): string {
  const n = seq.length;
  const s = ((start % n) + n) % n;
  return s + length <= n ? seq.slice(s, s + length) : seq.slice(s) + seq.slice(0, s + length - n);
}

/**
 * Sequence of a location in the feature's own orientation: segments joined in order, each reverse-complemented
 * when the strand is -1. Oracle: `Bio.SeqFeature.SeqFeature.extract`.
 */
export function extractLocation(seq: string, location: Location, alphabet: Alphabet = 'dna'): string {
  const parts = location.segments.map((segment) => {
    const piece = seq.slice(segment.start, segment.end);
    return location.strand === -1 ? reverseComplement(piece, alphabet) : piece;
  });
  return parts.join('');
}

/** A 1-based, inclusive range as the UI shows it. */
export interface DisplayRange {
  readonly from: number;
  readonly to: number;
}

/** Converts a 0-based half-open span to the 1-based inclusive range the UI shows. */
export function toDisplayRange(span: Span): DisplayRange {
  return { from: span.start + 1, to: span.end };
}

/** Converts a 1-based inclusive range back to a 0-based half-open span. */
export function fromDisplayRange(range: DisplayRange): Span {
  return { start: range.from - 1, end: range.to };
}

/**
 * GenBank-style text for a location in 1-based positions: `10..20`, `join(90..100,1..10)`,
 * `complement(10..20)`. Segments are written in the order stored, so a strand -1 location is written
 * 5'→3' of the feature inside `complement(join(...))` in top-strand order.
 */
export function formatLocation(location: Location): string {
  const ranges = location.segments.map((s) => {
    const { from, to } = toDisplayRange(s);
    return from === to ? `${from}` : `${from}..${to}`;
  });
  const body = location.strand === -1 ? [...ranges].reverse() : ranges;
  const joined = body.length > 1 ? `join(${body.join(',')})` : (body[0] as string);
  return location.strand === -1 ? `complement(${joined})` : joined;
}
