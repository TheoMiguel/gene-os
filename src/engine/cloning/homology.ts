import { reverseComplement } from '../alphabet';
import { gcPercent } from '../primers';
import { assemble } from './assemble';
import type {
  Assembly,
  CloningProblem,
  CloningResult,
  CloningWarning,
  Junction,
  Part,
  Piece,
  PlannedPrimer,
  PreparedFragment,
} from './model';
import { partRegion, pieceFromPart, pieceRegionSeq, pieceSeq, regionFits } from './piece';
import { designPieceEnds, type PrimerOptions } from './primer-design';
import { openVector, type VectorOpening } from './vector-opening';

export interface HomologyRequest extends PrimerOptions {
  readonly method: 'gibson' | 'in_fusion';
  /** Circular vector. */
  readonly vector: Part;
  readonly opening: VectorOpening;
  /** Inserts in the order they sit in the construct, 5' to 3' on the vector's top strand. Each region is amplified. */
  readonly inserts: readonly Part[];
  /** Homology arm length, bases. Gibson default 30 (20 to 40 is the usual range); In-Fusion default 15. */
  readonly overlap?: number;
  /** Per insert: -1 places the region as its reverse complement. Default all 1. */
  readonly strands?: readonly (1 | -1)[];
}

const OVERLAP = {
  gibson: { min: 15, max: 80, default: 30 },
  in_fusion: { min: 15, max: 40, default: 15 },
} as const;
const GC_LOW = 40;
const GC_HIGH = 65;

/** How many times `needle` occurs on either strand of a circular sequence. */
function circularOccurrences(seq: string, needle: string): number {
  const doubled = seq + seq.slice(0, needle.length - 1);
  const count = (haystack: string, probe: string) => {
    let hits = 0;
    for (let at = haystack.indexOf(probe); at !== -1; at = haystack.indexOf(probe, at + 1)) hits++;
    return hits;
  };
  return count(doubled, needle) + count(doubled, reverseComplement(needle));
}

/**
 * Gibson Assembly and In-Fusion cloning: homology-arm joins into a linearized vector.
 *
 * Each insert is amplified with primers whose 5' tails copy the end of its left neighbour (the vector end for the
 * first insert); the last insert's reverse primer also carries the start of the vector. Adjacent pieces then share
 * `overlap` bases and the construct is their overlap-driven join. Gibson and In-Fusion differ only in the default
 * overlap and the allowed range.
 */
export function designHomologyCloning(request: HomologyRequest): CloningResult {
  const limits = OVERLAP[request.method];
  const overlap = request.overlap ?? limits.default;
  const fail = (list: CloningProblem[], warnings: CloningWarning[] = []): CloningResult => ({
    ok: false,
    problems: list,
    warnings,
  });
  if (request.inserts.length === 0) return fail([{ code: 'no_parts' }]);
  if (!(overlap >= limits.min && overlap <= limits.max)) {
    return fail([{ code: 'overlap_out_of_range', min: limits.min, max: limits.max, value: overlap }]);
  }
  for (const part of [request.vector, ...request.inserts]) {
    if (!regionFits(part.record, partRegion(part)))
      return fail([{ code: 'region_out_of_range', part: part.id }]);
  }
  const opened = openVector(request.vector, request.opening);
  if ('code' in opened) return fail([opened]);

  const warnings: CloningWarning[] = [...opened.warnings];
  for (const end of [opened.piece.leftEnd, opened.piece.rightEnd]) {
    if (end?.type === 'three_prime') {
      warnings.push({ code: 'three_prime_overhang_end', part: request.vector.id, enzyme: end.source });
    }
  }
  const vector = opened.piece;
  const pieces: Piece[] = [vector];
  const primers: PlannedPrimer[] = [];
  const fragments: PreparedFragment[] = [
    {
      name: request.vector.id,
      kind: opened.enzymes.length ? 'digest' : 'as_is',
      templateId: request.vector.record.id,
      product: pieceSeq(vector),
      primerIds: [],
    },
  ];

  for (let i = 0; i < request.inserts.length; i++) {
    const part = request.inserts[i] as Part;
    const neighbour = pieces[i] as Piece;
    const neighbourRegion = pieceRegionSeq(neighbour);
    if (neighbourRegion.length < overlap) {
      return fail([
        { code: 'overlap_out_of_range', min: limits.min, max: neighbourRegion.length, value: overlap },
      ]);
    }
    const last = i === request.inserts.length - 1;
    const base = pieceFromPart(part, 'insert', request.strands?.[i] ?? 1);
    const piece: Piece = {
      ...base,
      leftAdd: neighbourRegion.slice(neighbourRegion.length - overlap),
      rightAdd: last ? pieceRegionSeq(vector).slice(0, overlap) : '',
    };
    const designed = designPieceEnds(piece, request);
    warnings.push(...designed.warnings);
    primers.push(...designed.primers);
    pieces.push(designed.piece);
    fragments.push({
      name: part.id,
      kind: 'pcr',
      templateId: part.record.id,
      product: pieceSeq(designed.piece),
      primerIds: designed.primers.map((p) => p.id),
    });
  }

  const label = request.method === 'gibson' ? 'Gibson overlap' : 'In-Fusion overlap';
  const junctions: Junction[] = pieces.map((_, i) => ({
    kind: 'homology',
    label: `${label} ${i + 1}`,
    overlap,
    mark: { offset: 0, length: overlap },
  }));
  const assembly: Assembly = {
    name: `${request.vector.id}+${request.inserts.map((p) => p.id).join('+')}`,
    pieces,
    junctions,
    primers,
  };
  const built = assemble(assembly);
  if ('problem' in built) return fail([built.problem], warnings);

  junctions.forEach((junction, i) => {
    const right = pieces[(i + 1) % pieces.length] as Piece;
    const arm = pieceSeq(right).slice(0, overlap);
    const gc = gcPercent(arm);
    if (gc < GC_LOW || gc > GC_HIGH)
      warnings.push({ code: 'overlap_gc_extreme', junction: junction.label, gc });
    if (circularOccurrences(built.construct.record.seq, arm) > 1) {
      warnings.push({ code: 'overlap_repeat', junction: junction.label });
    }
  });
  return {
    ok: true,
    design: { method: request.method, primers, fragments, constructs: [built.construct], warnings },
  };
}
