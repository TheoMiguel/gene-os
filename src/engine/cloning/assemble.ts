import type { Feature, Location, SeqRecord, Span, Strand } from '../types';
import type { Assembly, CloningProblem, Construct, Junction, JunctionInfo, Piece } from './model';
import { pieceSeq } from './piece';

const mod = (value: number, length: number) => ((value % length) + length) % length;

/** A feature carried from a piece, in construct coordinates before the origin is chosen (may run past the end). */
interface Placed {
  readonly feature: Feature;
  readonly segments: Span[];
  readonly strand: Strand;
}

/**
 * The segments of a feature in ascending top-strand order, unwrapped so each one lies after the previous one:
 * a feature across the origin of a circular record becomes one run that continues past the record's length.
 */
function unwrap(feature: Feature, n: number, circular: boolean): Span[] {
  const stored = feature.location.segments;
  const ascending = feature.location.strand === -1 ? [...stored].reverse() : [...stored];
  if (!circular) return ascending;
  const out: Span[] = [];
  let previousEnd = 0;
  for (const seg of ascending) {
    const shift =
      out.length > 0 && seg.start < previousEnd ? Math.ceil((previousEnd - seg.start) / n) * n : 0;
    out.push({ ...seg, start: seg.start + shift, end: seg.end + shift });
    previousEnd = seg.end + shift;
  }
  return out;
}

/**
 * Clips a source feature to the piece's region and maps it to construct coordinates, `base` being the construct
 * position of the region's first base. A piece read on the reverse strand flips the feature. Cut ends are marked
 * partial. A feature that the region holds in two places (the vector cut around an insert) comes out as one
 * feature per place, because the insert interrupts it. Returns nothing when no part of the feature is inside.
 */
function carry(feature: Feature, piece: Piece, base: number): Placed[] {
  const { record, start, length } = piece;
  const n = record.seq.length;
  const circular = record.topology === 'circular';
  const flip = piece.strand === -1;
  const unwrapped = unwrap(feature, n, circular);
  const strand = (feature.location.strand * piece.strand) as Strand;
  const placed: Placed[] = [];
  for (const lap of circular ? [-1, 0, 1] : [0]) {
    const parts: Span[] = [];
    for (const seg of unwrapped) {
      const from = seg.start + lap * n;
      const to = seg.end + lap * n;
      const lo = Math.max(from, start);
      const hi = Math.min(to, start + length);
      if (lo >= hi) continue;
      const cutLow = lo > from;
      const cutHigh = hi < to;
      if (seg.betweenBases && (cutLow || cutHigh)) continue;
      const a = flip ? base + length - (hi - start) : base + (lo - start);
      const b = flip ? base + length - (lo - start) : base + (hi - start);
      const partialStart = flip ? cutHigh || seg.partialEnd : cutLow || seg.partialStart;
      const partialEnd = flip ? cutLow || seg.partialStart : cutHigh || seg.partialEnd;
      parts.push({
        start: a,
        end: b,
        ...(partialStart ? { partialStart: true as const } : {}),
        ...(partialEnd ? { partialEnd: true as const } : {}),
        ...(seg.betweenBases ? { betweenBases: true as const } : {}),
      });
    }
    if (parts.length === 0) continue;
    parts.sort((x, y) => x.start - y.start);
    placed.push({ feature, segments: strand === -1 ? parts.reverse() : parts, strand });
  }
  return placed;
}

/** Moves a span to the coordinates of a circular sequence of `n` bases that starts at linear position `origin`. */
function rotateSpan(span: Span, origin: number, n: number): Span[] {
  const size = span.end - span.start;
  const start = mod(span.start - origin, n);
  if (start + size <= n) return [{ ...span, start, end: start + size }];
  const { partialStart, partialEnd } = span;
  return [
    { start, end: n, ...(partialStart ? { partialStart } : {}) },
    { start: 0, end: start + size - n, ...(partialEnd ? { partialEnd } : {}) },
  ];
}

/** Segments of a feature on a rotated circle, in the feature's biological order (a split piece keeps 5'→3'). */
function rotateSegments(segments: readonly Span[], strand: Strand, origin: number, n: number): Span[] {
  const out: Span[] = [];
  for (const segment of segments) {
    const parts = rotateSpan(segment, origin, n);
    if (parts.length === 2 && strand === -1) parts.reverse();
    out.push(...parts);
  }
  const merged: Span[] = [];
  for (const segment of out) {
    const last = merged[merged.length - 1];
    const joins =
      last &&
      !segment.betweenBases &&
      (strand === 1 ? last.end === segment.start : last.start === segment.end) &&
      !last.partialEnd &&
      !segment.partialStart;
    if (!last || !joins) {
      merged.push(segment);
    } else if (strand === 1) {
      merged[merged.length - 1] = { ...last, end: segment.end };
    } else {
      merged[merged.length - 1] = { ...segment, end: last.end };
    }
  }
  return merged;
}

function location(segments: Span[], strand: Strand, operator?: Location['operator']): Location {
  return { segments, strand, ...(operator ? { operator } : {}) };
}

/** Position, in a piece's own top strand, of the base that sits on position 0 of the source record, if it is kept. */
function originIndex(piece: Piece): number | undefined {
  const n = piece.record.seq.length;
  if (piece.record.topology !== 'circular') return undefined;
  const d = mod(-piece.start, n);
  if (d >= piece.length) return undefined;
  return piece.leftAdd.length + (piece.strand === 1 ? d : piece.length - 1 - d);
}

/**
 * Joins the pieces of an assembly into one circular construct.
 *
 * Features of each piece's region are carried over with shifted coordinates (a feature cut by the join becomes
 * partial), every junction is marked, and the annealing part of every primer is marked. The vector's own origin
 * stays at position 0 whenever the join keeps that base.
 * Returns a problem when two pieces do not share the bases their junction claims.
 */
export function assemble(assembly: Assembly): { construct: Construct } | { problem: CloningProblem } {
  const { pieces, junctions } = assembly;
  const seqs = pieces.map(pieceSeq);
  const offsets: number[] = [];
  let at = 0;
  for (let i = 0; i < pieces.length; i++) {
    offsets.push(at);
    const junction = junctions[i] as Junction;
    const next = seqs[(i + 1) % pieces.length] as string;
    const here = seqs[i] as string;
    if (
      junction.overlap > 0 &&
      here.slice(here.length - junction.overlap) !== next.slice(0, junction.overlap)
    ) {
      return { problem: { code: 'junction_mismatch', junction: junction.label } };
    }
    at += here.length - junction.overlap;
  }
  const n = at;
  const linear = seqs
    .map((seq, i) => seq.slice(0, seq.length - (junctions[i] as Junction).overlap))
    .join('')
    .toUpperCase();

  const vectorIndex = Math.max(
    0,
    pieces.findIndex((p) => p.role === 'vector'),
  );
  const anchor = pieces[vectorIndex] as Piece;
  const kept = originIndex(anchor);
  const origin = kept === undefined ? 0 : mod((offsets[vectorIndex] as number) + kept, n);

  const features: Feature[] = [];
  const usedIds = new Set<string>();
  const uniqueId = (wanted: string) => {
    let id = wanted;
    for (let k = 2; usedIds.has(id); k++) id = `${wanted}~${k}`;
    usedIds.add(id);
    return id;
  };

  pieces.forEach((piece, i) => {
    const base = (offsets[i] as number) + piece.leftAdd.length;
    for (const feature of piece.record.features) {
      for (const placed of carry(feature, piece, base)) {
        features.push({
          ...feature,
          id: uniqueId(`${piece.name}:${feature.id}`),
          location: location(
            rotateSegments(placed.segments, placed.strand, origin, n),
            placed.strand,
            feature.location.operator,
          ),
        });
      }
    }
    const primerBind = (primerId: string, anneal: number, from: number, strand: Strand) => {
      const primer = assembly.primers.find((p) => p.id === primerId);
      if (!primer || anneal <= 0) return;
      features.push({
        id: uniqueId(`primer:${primerId}:${strand}`),
        type: 'primer_bind',
        name: primer.name,
        location: location(rotateSegments([{ start: from, end: from + anneal }], strand, origin, n), strand),
        origin: 'user',
        qualifiers: { note: [`${primer.seq} (Tm ${primer.tm.toFixed(1)} C)`] },
      });
    };
    if (piece.forward) primerBind(piece.forward.primerId, piece.forward.anneal, base, 1);
    if (piece.reverse)
      primerBind(
        piece.reverse.primerId,
        piece.reverse.anneal,
        base + piece.length - piece.reverse.anneal,
        -1,
      );
  });

  const infos: JunctionInfo[] = [];
  junctions.forEach((junction, i) => {
    const boundary = i + 1 < pieces.length ? (offsets[i + 1] as number) : n;
    const first = boundary + junction.mark.offset;
    const span: Span =
      junction.mark.length > 0
        ? { start: first, end: first + junction.mark.length }
        : { start: first - 1, end: first + 1, betweenBases: true };
    infos.push({
      label: junction.label,
      kind: junction.kind,
      position: mod(first, n),
      length: junction.mark.length,
    });
    features.push({
      id: uniqueId(`junction:${i}`),
      type: 'misc_feature',
      name: junction.label,
      location: location(rotateSegments([span], 1, origin, n), 1),
      origin: 'user',
      qualifiers: { note: [`cloning junction (${junction.kind})`] },
    });
  });

  const record: SeqRecord = {
    id: assembly.name.replace(/\s+/g, '_'),
    name: assembly.name,
    description: `Simulated construct: ${pieces.map((p) => p.name).join(' + ')}`,
    alphabet: 'dna',
    topology: 'circular',
    seq: linear.slice(origin) + linear.slice(0, origin),
    features,
    metadata: { molType: 'DNA' },
  };
  return { construct: { orientation: 'forward', record, junctions: infos } };
}
