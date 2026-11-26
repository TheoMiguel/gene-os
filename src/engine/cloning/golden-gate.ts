import goldenGateData from '../../data/cloning-golden-gate.json';
import { reverseComplement } from '../alphabet';
import { scanSites } from '../restriction';
import type { Enzyme } from '../types';
import { assemble } from './assemble';
import { cutCount, findEnzyme, isTypeIIS } from './enzymes';
import type {
  Assembly,
  CloningProblem,
  CloningResult,
  CloningWarning,
  Junction,
  Part,
  Piece,
  PieceEnd,
  PlannedPrimer,
  PreparedFragment,
} from './model';
import {
  digestPiece,
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

/** The Type IIS enzymes the Golden Gate designer accepts. */
export const GOLDEN_GATE_ENZYMES: readonly string[] = goldenGateData.enzymes;

export interface GoldenGateRequest extends PrimerOptions {
  readonly method: 'golden_gate';
  /** One of `GOLDEN_GATE_ENZYMES`. */
  readonly enzyme: string;
  /** The destination vector. */
  readonly vector: Part;
  /**
   * `digest`: the vector already carries two sites of the enzyme and is cut as it is; its two end overhangs fix
   * the first and last junction. `pcr`: the vector region is amplified with sites added like any other part.
   */
  readonly vectorMode: 'digest' | 'pcr';
  /** Parts in assembly order, between the vector's right end and its left end. */
  readonly parts: readonly Part[];
  /**
   * Overhang of each junction, `parts.length + 1` entries: vector to first part, between parts, last part to
   * vector. A missing or undefined entry is designed. Vector-fixed junctions in `digest` mode take the vector's.
   */
  readonly overhangs?: readonly (string | undefined)[];
  /**
   * `scar` (default): the overhang is added between the parts. `native`: the overhang is the first bases of the
   * next part, so the join leaves no scar (only for junctions that do not touch a digested vector).
   */
  readonly junctionStyle?: 'scar' | 'native';
  readonly clamp?: string;
}

const problem = (list: CloningProblem[], warnings: CloningWarning[] = []): CloningResult => ({
  ok: false,
  problems: list,
  warnings,
});

const BASES = 'ACGT';

/** Every overhang of `length` bases that is not palindromic, not a long homopolymer and not all one strand type. */
function overhangCandidates(length: number): string[] {
  const all: string[] = [''];
  for (let i = 0; i < length; i++) {
    const next: string[] = [];
    for (const prefix of all) for (const base of BASES) next.push(prefix + base);
    all.splice(0, all.length, ...next);
  }
  const { maxHomopolymer } = goldenGateData.overhangRules;
  const run = new RegExp(`(.)\\1{${maxHomopolymer - 1},}`);
  return all.filter((o) => o !== reverseComplement(o) && !run.test(o) && /[GC]/.test(o) && /[AT]/.test(o));
}

const hamming = (a: string, b: string) => [...a].filter((c, i) => c !== b[i]).length;

/**
 * Chooses `count` overhangs of `length` bases that stay at least `minHammingDistance` apart from each other and
 * from each other's reverse complements, and from the `taken` ones. Deterministic. Returns fewer when none are left.
 */
export function designOverhangs(count: number, length: number, taken: readonly string[] = []): string[] {
  const { minHammingDistance } = goldenGateData.overhangRules;
  const chosen: string[] = [];
  const clash = (candidate: string, other: string) =>
    hamming(candidate, other) < minHammingDistance ||
    hamming(candidate, reverseComplement(other)) < minHammingDistance;
  for (const candidate of overhangCandidates(length)) {
    if (chosen.length === count) break;
    if ([...taken, ...chosen].every((other) => !clash(candidate, other))) chosen.push(candidate);
  }
  return chosen;
}

/** Problems with a set of overhangs: wrong shape, palindromes, duplicates (a reverse complement counts as one). */
export function checkOverhangs(overhangs: readonly string[], length: number): CloningProblem[] {
  const found: CloningProblem[] = [];
  overhangs.forEach((o, junction) => {
    if (o.length !== length || !/^[ACGT]+$/.test(o))
      found.push({ code: 'overhang_invalid', junction, overhang: o });
    else if (o === reverseComplement(o)) found.push({ code: 'palindromic_overhang', overhang: o, junction });
  });
  const seen = new Map<string, number[]>();
  overhangs.forEach((o, junction) => {
    const key = [o, reverseComplement(o)].sort()[0] as string;
    seen.set(key, [...(seen.get(key) ?? []), junction]);
  });
  for (const [key, junctions] of seen) {
    if (junctions.length > 1) {
      found.push({
        code: 'duplicate_overhang',
        overhang: overhangs[junctions[0] as number] ?? key,
        junctions,
      });
    }
  }
  return found;
}

/** Bases between the recognition site and the top-strand cut, and the overhang length, for a Type IIS enzyme. */
function geometry(enzyme: Enzyme) {
  return { spacer: enzyme.topCut - enzyme.site.length, overhang: enzyme.bottomCut - enzyme.topCut };
}

const withEnds = (piece: Piece, leftEnd: PieceEnd, rightEnd: PieceEnd): Piece => ({
  ...piece,
  leftEnd,
  rightEnd,
});

/**
 * Golden Gate assembly: a Type IIS enzyme cuts every part outside its recognition site and a ligase joins the
 * parts through their unique overhangs, all in one pot.
 *
 * Each part is amplified with primers that add `clamp + site + spacer + overhang` on its left and
 * `overhang + spacer + site (reverse) + clamp` on its right, so the sites sit outside the final product. The
 * simulation cuts every product with the engine's own digest and joins the pieces in the given order; every
 * overhang must be unique and non-palindromic. Internal sites of the enzyme in a part are a warning (that part
 * would be cut in the reaction), and the construct shown is the intended one.
 */
export function designGoldenGate(request: GoldenGateRequest): CloningResult {
  const enzyme = GOLDEN_GATE_ENZYMES.includes(request.enzyme) ? findEnzyme(request.enzyme) : undefined;
  if (!enzyme) return problem([{ code: 'enzyme_unknown', enzyme: request.enzyme }]);
  if (!isTypeIIS(enzyme))
    return problem([{ code: 'enzyme_not_suitable', enzyme: enzyme.name, reason: 'not_type_iis' }]);
  if (request.parts.length === 0) return problem([{ code: 'no_parts' }]);
  for (const part of [request.vector, ...request.parts]) {
    if (!regionFits(part.record, partRegion(part)))
      return problem([{ code: 'region_out_of_range', part: part.id }]);
  }
  const { spacer, overhang: length } = geometry(enzyme);
  const clamp = request.clamp ?? goldenGateData.clamp;
  const spacerBases = 'A'.repeat(spacer);
  const style = request.junctionStyle ?? 'scar';
  const parts = request.parts;
  const junctionCount = parts.length + 1;
  const warnings: CloningWarning[] = [];

  // The vector, either cut as it is or amplified like a part.
  let vectorCut: Piece | undefined;
  if (request.vectorMode === 'digest') {
    const cuts = cutCount(request.vector.record.seq, request.vector.record.topology, enzyme);
    if (cuts === 0)
      return problem([{ code: 'enzyme_no_site', enzyme: enzyme.name, part: request.vector.id }]);
    const fragments = digestPiece(pieceFromPart(request.vector, 'vector'), [enzyme]).filter(
      (f) => f.cutLeft && f.cutRight,
    );
    vectorCut = [...fragments].sort((a, b) => b.piece.length - a.piece.length)[0]?.piece;
    if (!vectorCut)
      return problem([{ code: 'enzyme_no_site', enzyme: enzyme.name, part: request.vector.id }]);
    const left = vectorCut.leftEnd as PieceEnd;
    const right = vectorCut.rightEnd as PieceEnd;
    const mismatch = (index: number, wanted: string | undefined, actual: string): CloningProblem[] =>
      wanted !== undefined && wanted !== actual
        ? [{ code: 'overhang_invalid', junction: index, overhang: wanted }]
        : [];
    const bad = [
      ...mismatch(0, request.overhangs?.[0], right.overhang),
      ...mismatch(junctionCount - 1, request.overhangs?.[junctionCount - 1], left.overhang),
    ];
    if (bad.length) return problem(bad);
  }

  // Overhang of every junction.
  const fixed = (index: number): string | undefined => {
    if (vectorCut && index === 0) return vectorCut.rightEnd?.overhang;
    if (vectorCut && index === junctionCount - 1) return vectorCut.leftEnd?.overhang;
    return request.overhangs?.[index];
  };
  const regionAfter = (index: number): string | undefined => {
    const next = index === junctionCount - 1 ? request.vector : parts[index];
    return next && !(vectorCut && index === junctionCount - 1)
      ? pieceRegionSeq(pieceFromPart(next, 'insert')).slice(0, length)
      : undefined;
  };
  const overhangs: string[] = [];
  const toDesign: number[] = [];
  for (let j = 0; j < junctionCount; j++) {
    const wanted = fixed(j) ?? (style === 'native' ? regionAfter(j) : undefined);
    if (wanted === undefined) toDesign.push(j);
    overhangs.push(wanted ?? '');
  }
  const given = overhangs.filter((_, j) => !toDesign.includes(j));
  const generated = designOverhangs(toDesign.length, length, given);
  if (generated.length < toDesign.length)
    return problem([{ code: 'duplicate_overhang', overhang: '', junctions: toDesign }]);
  toDesign.forEach((j, k) => {
    overhangs[j] = generated[k] as string;
  });
  const overhangProblems = checkOverhangs(overhangs, length);
  if (overhangProblems.length) return problem(overhangProblems);

  // A junction adds its overhang to the right piece unless the style is native or the vector end supplies it.
  const addsOverhang = (j: number) => {
    if (vectorCut && j === junctionCount - 1) return false;
    if (vectorCut && j === 0) return true;
    return style === 'scar' || request.overhangs?.[j] !== undefined;
  };

  const primers: PlannedPrimer[] = [];
  const fragments: PreparedFragment[] = [];
  const pieces: Piece[] = [];
  const makeCore = (
    part: Part,
    role: Piece['role'],
    inJunction: number,
    outJunction: number,
  ): Piece | CloningProblem => {
    const base = pieceFromPart(part, role);
    const amplicon: Piece = {
      ...base,
      leftAdd:
        clamp +
        enzyme.site +
        spacerBases +
        (addsOverhang(inJunction) ? (overhangs[inJunction] as string) : ''),
      rightAdd: (overhangs[outJunction] as string) + reverseComplement(clamp + enzyme.site + spacerBases),
    };
    const designed = designPieceEnds(amplicon, request);
    primers.push(...designed.primers);
    warnings.push(...designed.warnings);
    const inside = cutCount(pieceRegionSeq(base), 'linear', enzyme);
    if (inside > 0)
      warnings.push({ code: 'internal_site', enzyme: enzyme.name, part: part.id, cuts: inside });
    fragments.push({
      name: part.id,
      kind: 'pcr',
      templateId: part.record.id,
      product: pieceSeq(designed.piece),
      primerIds: designed.primers.map((p) => p.id),
    });
    const cut = digestPiece(designed.piece, [enzyme]).filter((f) => f.cutLeft && f.cutRight);
    if (cut.length === 1 && cut[0]) return cut[0].piece;
    // Internal sites cut the product more than once: show the intended product, as designed.
    const leftTrim = designed.piece.leftAdd.length - (addsOverhang(inJunction) ? length : 0);
    const trimmed = trimPiece(designed.piece, leftTrim, designed.piece.rightAdd.length);
    return trimmed
      ? withEnds(
          trimmed,
          { type: 'five_prime', overhang: overhangs[inJunction] as string, source: enzyme.name },
          { type: 'five_prime', overhang: overhangs[outJunction] as string, source: enzyme.name },
        )
      : { code: 'primer_design_failed', part: part.id, end: 'forward' };
  };

  if (vectorCut) {
    pieces.push(vectorCut);
    fragments.push({
      name: request.vector.id,
      kind: 'digest',
      templateId: request.vector.record.id,
      product: request.vector.record.seq,
      primerIds: [],
    });
    const leftover = cutCount(pieceSeq(vectorCut), 'linear', enzyme);
    if (leftover > 0)
      warnings.push({ code: 'internal_site', enzyme: enzyme.name, part: request.vector.id, cuts: leftover });
  } else {
    const core = makeCore(request.vector, 'vector', junctionCount - 1, 0);
    if ('code' in core) return problem([core], warnings);
    pieces.push(core);
  }
  for (let i = 0; i < parts.length; i++) {
    const core = makeCore(parts[i] as Part, 'insert', i, i + 1);
    if ('code' in core) return problem([core], warnings);
    pieces.push(core);
  }

  // One-pot join in the given order: each right end must anneal to the next left end.
  const junctions: Junction[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const left = pieces[i] as Piece;
    const right = pieces[(i + 1) % pieces.length] as Piece;
    if (!left.rightEnd || !right.leftEnd || !endsCompatible(left.rightEnd, right.leftEnd)) {
      const fallback: PieceEnd = { type: 'blunt', overhang: '', source: enzyme.name };
      return problem(
        [
          {
            code: 'incompatible_ends',
            junction: `${i}`,
            left: left.rightEnd ?? fallback,
            right: right.leftEnd ?? fallback,
          },
        ],
        warnings,
      );
    }
    junctions.push({
      ...stickyJunction(left.rightEnd, right.leftEnd),
      label: `${enzyme.name} overhang ${right.leftEnd.overhang}`,
    });
  }

  const assembly: Assembly = {
    name: `${request.vector.id}+${parts.map((p) => p.id).join('+')}`,
    pieces,
    junctions,
    primers,
  };
  const built = assemble(assembly);
  if ('problem' in built) return problem([built.problem], warnings);
  const survivors = scanSites(built.construct.record.seq, 'circular', [enzyme]).sites[0]?.topCuts.length ?? 0;
  if (survivors > 0)
    warnings.push({ code: 'internal_site', enzyme: enzyme.name, part: 'construct', cuts: survivors });
  return {
    ok: true,
    design: { method: 'golden_gate', primers, fragments, constructs: [built.construct], warnings },
  };
}
