import { complement } from '../alphabet';
import { assemble } from './assemble';
import type {
  Assembly,
  CloningProblem,
  CloningResult,
  CloningWarning,
  Junction,
  Part,
  Piece,
  PieceEnd,
  PreparedFragment,
} from './model';
import {
  endsCompatible,
  partRegion,
  pieceFromPart,
  pieceRegionSeq,
  pieceSeq,
  regionFits,
  stickyJunction,
  trimPiece,
} from './piece';
import { designPieceEnds, type PrimerOptions } from './primer-design';
import { openVector, type VectorOpening } from './vector-opening';

export type Dntp = 'A' | 'C' | 'G' | 'T';

export interface LicRequest extends PrimerOptions {
  readonly method: 'lic';
  readonly vector: Part;
  readonly opening: VectorOpening;
  /** The insert region is amplified; its primers carry the extensions that anneal to the vector's overhangs. */
  readonly insert: Part;
  /** dNTP of the vector's chew-back. Default: the one that leaves overhangs closest to 12 bases. */
  readonly vectorDntp?: Dntp;
  /** dNTP of the insert's chew-back. Default: the one that needs the fewest added bases. */
  readonly insertDntp?: Dntp;
}

const DNTPS: readonly Dntp[] = ['A', 'C', 'G', 'T'];
/** Overhang length that kits use; shorter ones anneal poorly. */
const GOOD_OVERHANG = 12;
const SHORT_OVERHANG = 10;

const fail = (list: CloningProblem[], warnings: CloningWarning[] = []): CloningResult => ({
  ok: false,
  problems: list,
  warnings,
});

/**
 * T4 DNA polymerase with one dNTP on a blunt double-stranded molecule. Its 3'→5' exonuclease chews each 3' end
 * inward until it meets the first base the dNTP can refill, so each end keeps a 5' overhang of the other strand.
 * `left` is the overhang at the left end (top-strand bases before the first complement of the dNTP) and `right`
 * the overhang at the right end (top-strand bases after the last dNTP base). Undefined when either end finds no
 * stop base or the two chewed strands would part.
 */
export function chewBack(top: string, dntp: Dntp): { left: number; right: number } | undefined {
  const first = top.indexOf(complement(dntp));
  const last = top.lastIndexOf(dntp);
  if (first === -1 || last === -1 || first > last + 1) return undefined;
  return { left: first, right: top.length - (last + 1) };
}

/** Chews a piece back and returns it with its 5' overhang ends: the top strand keeps its 5' end and loses the 3' end. */
function chewPiece(piece: Piece, dntp: Dntp): Piece | undefined {
  const top = pieceSeq(piece);
  const chewed = chewBack(top, dntp);
  const trimmed = chewed && trimPiece(piece, 0, chewed.right);
  if (!chewed || !trimmed) return undefined;
  const end = (overhang: string): PieceEnd => ({
    type: 'five_prime',
    overhang,
    source: `T4 pol + d${dntp}TP`,
  });
  return {
    ...trimmed,
    leftEnd: end(top.slice(0, chewed.left)),
    rightEnd: end(top.slice(top.length - chewed.right)),
  };
}

/**
 * Ligation-independent cloning: T4 DNA polymerase with one dNTP chews the 3' ends of the vector and of the PCR
 * insert back to complementary single-stranded overhangs, which anneal without a ligase.
 *
 * The vector is opened first (its ends are taken as blunt; a 3' overhang end is warned about). The chew-back of
 * the vector fixes its two overhangs. The insert primers then carry those overhangs as 5' extensions, plus a
 * stop base on a side where the region does not already provide one, and the dNTP of the insert is the one that
 * needs the fewest added bases. The simulation chews both molecules and checks that the overhangs anneal.
 */
export function designLic(request: LicRequest): CloningResult {
  for (const part of [request.vector, request.insert]) {
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

  const vectorTop = pieceSeq(opened.piece);
  const vectorChoices = request.vectorDntp ? [request.vectorDntp] : DNTPS;
  const scored = vectorChoices
    .map((dntp) => ({ dntp, chew: chewBack(vectorTop, dntp) }))
    .filter(
      (c): c is { dntp: Dntp; chew: { left: number; right: number } } =>
        !!c.chew && c.chew.left > 0 && c.chew.right > 0,
    )
    .sort(
      (a, b) =>
        Math.abs(a.chew.left - GOOD_OVERHANG) +
        Math.abs(a.chew.right - GOOD_OVERHANG) -
        (Math.abs(b.chew.left - GOOD_OVERHANG) + Math.abs(b.chew.right - GOOD_OVERHANG)),
    );
  const choice = scored[0];
  if (!choice) return fail([{ code: 'lic_no_stop_nucleotide', part: request.vector.id }]);
  const vector = chewPiece(opened.piece, choice.dntp);
  if (!vector?.leftEnd || !vector.rightEnd)
    return fail([{ code: 'lic_no_stop_nucleotide', part: request.vector.id }]);

  // The insert's left overhang must equal the vector's right overhang, and its right overhang the vector's left.
  const wantLeft = vector.rightEnd.overhang;
  const wantRight = vector.leftEnd.overhang;
  const base = pieceFromPart(request.insert, 'insert');
  const region = pieceRegionSeq(base);
  const options = (request.insertDntp ? [request.insertDntp] : DNTPS)
    .filter((x) => !wantLeft.includes(complement(x)) && !wantRight.includes(x))
    .map((x) => {
      const addLeft = region.startsWith(complement(x)) ? '' : complement(x);
      const addRight = region.endsWith(x) ? '' : x;
      return { dntp: x, addLeft, addRight, cost: addLeft.length + addRight.length };
    })
    .sort((a, b) => a.cost - b.cost);
  const pick = options[0];
  if (!pick) return fail([{ code: 'lic_no_stop_nucleotide', part: request.insert.id }], warnings);

  const amplicon: Piece = { ...base, leftAdd: wantLeft + pick.addLeft, rightAdd: pick.addRight + wantRight };
  const designed = designPieceEnds(amplicon, request);
  warnings.push(...designed.warnings);
  const insert = chewPiece(designed.piece, pick.dntp);
  if (!insert?.leftEnd || !insert.rightEnd)
    return fail([{ code: 'lic_no_stop_nucleotide', part: request.insert.id }], warnings);

  const pairs: [string, PieceEnd, PieceEnd][] = [
    ['left', vector.rightEnd, insert.leftEnd],
    ['right', insert.rightEnd, vector.leftEnd],
  ];
  for (const [side, right, left] of pairs) {
    if (!endsCompatible(right, left)) {
      return fail(
        [{ code: 'lic_overhang_mismatch', junction: side, expected: right.overhang, actual: left.overhang }],
        warnings,
      );
    }
    if (right.overhang.length < SHORT_OVERHANG)
      warnings.push({ code: 'lic_overhang_short', junction: side, length: right.overhang.length });
  }

  const junctions: Junction[] = pairs.map(([side, right, left]) => ({
    ...stickyJunction(right, left),
    label: `LIC overhang ${side}`,
  }));
  const assembly: Assembly = {
    name: `${request.vector.id}+${request.insert.id}`,
    pieces: [vector, insert],
    junctions,
    primers: designed.primers,
  };
  const built = assemble(assembly);
  if ('problem' in built) return fail([built.problem], warnings);
  const fragments: PreparedFragment[] = [
    {
      name: request.vector.id,
      kind: 'chew_back',
      templateId: request.vector.record.id,
      product: vectorTop,
      primerIds: [],
      dntp: choice.dntp,
    },
    {
      name: request.insert.id,
      kind: 'pcr',
      templateId: request.insert.record.id,
      product: pieceSeq(designed.piece),
      primerIds: designed.primers.map((p) => p.id),
      dntp: pick.dntp,
    },
  ];
  return {
    ok: true,
    design: { method: 'lic', primers: designed.primers, fragments, constructs: [built.construct], warnings },
  };
}
