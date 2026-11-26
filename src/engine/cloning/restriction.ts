import { reverseComplement } from '../alphabet';
import { ENZYME_CATALOG, scanSites } from '../restriction';
import type { Enzyme } from '../types';
import { assemble } from './assemble';
import { cutCount, isClassicEnzyme } from './enzymes';
import type {
  Assembly,
  CloningProblem,
  CloningResult,
  CloningWarning,
  Construct,
  Part,
  Piece,
  PieceEnd,
  PlannedPrimer,
  PreparedFragment,
} from './model';
import {
  type DigestedPiece,
  digestPiece,
  endsCompatible,
  flipPiece,
  partRegion,
  pieceFromPart,
  pieceRegionSeq,
  pieceSeq,
  regionFits,
  stickyJunction,
} from './piece';
import { designPieceEnds, type PrimerOptions } from './primer-design';
import { openWithEnzymes, resolveEnzymes } from './vector-opening';

export interface RestrictionRequest extends PrimerOptions {
  readonly method: 'restriction';
  /** Circular vector. */
  readonly vector: Part;
  /** The insert. With `insertMode: 'amplify'` its region is amplified; with `'digest'` it is cut as it is. */
  readonly insert: Part;
  /** One enzyme, or two (in any order: the vector's geometry decides which end each one makes). Absent: chosen. */
  readonly enzymes?: readonly string[];
  /** Default `amplify`: primers add the sites. */
  readonly insertMode?: 'amplify' | 'digest';
  /** Bases before each added site so the enzyme can cut near the end of a PCR product. Default `GTAGTA`. */
  readonly clamp?: string;
  /** The vector ends are dephosphorylated (CIP/rSAP), which blocks self-ligation. */
  readonly dephosphorylateVector?: boolean;
  /** Intended orientation of the insert is the reverse complement of the region. */
  readonly insertReverse?: boolean;
}

const DEFAULT_CLAMP = 'GTAGTA';

const problems = (list: CloningProblem[], warnings: CloningWarning[] = []): CloningResult => ({
  ok: false,
  problems: list,
  warnings,
});

/** Picks the pair of enzymes that cut the vector once, miss the insert region and leave ends that cannot re-anneal. */
function chooseEnzymes(vector: Part, insertSeq: string): Enzyme[] | undefined {
  const candidates = ENZYME_CATALOG.filter((e) => isClassicEnzyme(e) && e.site.length >= 6);
  const vectorSites = scanSites(vector.record.seq, vector.record.topology, candidates).sites;
  const insertSites = scanSites(insertSeq, 'linear', candidates).sites;
  const usable = candidates.filter(
    (_, i) => vectorSites[i]?.topCuts.length === 1 && insertSites[i]?.topCuts.length === 0,
  );
  const preferred = (e: Enzyme) => (e.suppliers.includes('N') ? 1000 : 0) + e.suppliers.length;
  usable.sort((a, b) => preferred(b) - preferred(a) || a.name.localeCompare(b.name));
  const cutAt = (e: Enzyme) => vectorSites[candidates.indexOf(e)]?.topCuts[0] ?? 0;
  for (const first of usable) {
    for (const second of usable) {
      if (first === second || first.isoschizomerOf === second.name) continue;
      if (Math.abs(cutAt(first) - cutAt(second)) < 6) continue;
      const opened = openWithEnzymes(vector, [first, second]);
      if ('code' in opened) continue;
      const { leftEnd, rightEnd } = opened.piece;
      if (leftEnd && rightEnd && !endsCompatible(rightEnd, leftEnd)) return [first, second];
    }
  }
  return undefined;
}

/** `forward` when the piece reads like its source region, `reverse` when it reads as the reverse complement. */
const orientationOf = (piece: Piece) => (piece.strand === 1 ? 'forward' : 'reverse');

/** The ends of a ligation: for each way the insert can sit, whether both junctions anneal. */
function orientations(vector: Piece, insert: Piece) {
  const forward = insert;
  const reverse = flipPiece(insert);
  const fits = (p: Piece) =>
    !!vector.rightEnd &&
    !!vector.leftEnd &&
    !!p.leftEnd &&
    !!p.rightEnd &&
    endsCompatible(vector.rightEnd, p.leftEnd) &&
    endsCompatible(p.rightEnd, vector.leftEnd);
  return [
    { label: orientationOf(forward), insert: forward, ok: fits(forward) },
    { label: orientationOf(reverse), insert: reverse, ok: fits(reverse) },
  ] as const;
}

function constructOf(name: string, vector: Piece, insert: Piece, primers: PlannedPrimer[], label: string) {
  const left = vector.rightEnd;
  const right = vector.leftEnd;
  if (!left || !right || !insert.leftEnd || !insert.rightEnd) return undefined;
  const assembly: Assembly = {
    name,
    pieces: [vector, insert],
    junctions: [stickyJunction(left, insert.leftEnd), stickyJunction(insert.rightEnd, right)],
    primers,
  };
  const built = assemble(assembly);
  return 'construct' in built ? ({ ...built.construct, orientation: label } as Construct) : built.problem;
}

/**
 * Restriction and ligation cloning: digest the vector, prepare the insert, check that the ends anneal, ligate.
 *
 * The insert is either amplified with primers that add the enzyme sites (the default) or cut as it is. The
 * simulation really digests the vector and the insert with the engine's restriction code, so an enzyme that cuts
 * inside the insert, a second cut in the vector, or ends that cannot anneal come back as problems. Both
 * orientations the ends allow are returned, the intended one first. Self-ligation of the vector, blunt ligation
 * and dephosphorylation are warnings, not a kinetics model.
 */
export function designRestrictionCloning(request: RestrictionRequest): CloningResult {
  const { vector, insert } = request;
  const insertRegion = partRegion(insert);
  if (!regionFits(insert.record, insertRegion))
    return problems([{ code: 'region_out_of_range', part: insert.id }]);
  const regionTop = pieceRegionSeq(pieceFromPart(insert, 'insert'));

  let enzymes: Enzyme[] = [];
  if (request.enzymes?.length) {
    const resolved = resolveEnzymes(request.enzymes);
    if ('code' in resolved) return problems([resolved]);
    enzymes = resolved;
  } else {
    const chosen = request.insertMode === 'digest' ? undefined : chooseEnzymes(vector, regionTop);
    if (!chosen) return problems([{ code: 'no_enzyme_pair' }]);
    enzymes = chosen;
  }

  const opened = openWithEnzymes(vector, enzymes);
  if ('code' in opened) return problems([opened]);
  const warnings: CloningWarning[] = [...opened.warnings];
  const vectorPiece = opened.piece;
  const vectorLeft = vectorPiece.leftEnd as PieceEnd;
  const vectorRight = vectorPiece.rightEnd as PieceEnd;

  let insertPiece: Piece;
  let primers: PlannedPrimer[] = [];
  const fragments: PreparedFragment[] = [
    {
      name: vector.id,
      kind: 'digest',
      templateId: vector.record.id,
      product: vector.record.seq,
      primerIds: [],
    },
  ];
  const strand = request.insertReverse ? -1 : 1;
  const mode = request.insertMode ?? 'amplify';

  if (mode === 'amplify') {
    const byName = new Map(enzymes.map((e) => [e.name, e]));
    const leftEnzyme = byName.get(vectorRight.source);
    const rightEnzyme = byName.get(vectorLeft.source);
    if (!leftEnzyme || !rightEnzyme) return problems([{ code: 'no_enzyme_pair' }]);
    for (const enzyme of enzymes) {
      const inside = cutCount(regionTop, 'linear', enzyme);
      if (inside > 0)
        return problems([{ code: 'enzyme_cuts_insert', enzyme: enzyme.name, part: insert.id, cuts: inside }]);
    }
    const clamp = request.clamp ?? DEFAULT_CLAMP;
    const base = pieceFromPart(insert, 'insert', 1);
    const amplicon: Piece = {
      ...base,
      strand,
      leftAdd: clamp + leftEnzyme.site,
      rightAdd: reverseComplement(clamp + rightEnzyme.site),
    };
    const designed = designPieceEnds(amplicon, request);
    primers = designed.primers;
    warnings.push(...designed.warnings);
    const cut = digestPiece(designed.piece, enzymes);
    const middle = cut.filter((f) => f.cutLeft && f.cutRight);
    const total = enzymes.reduce((sum, e) => sum + cutCount(pieceSeq(amplicon), 'linear', e), 0);
    if (middle.length !== 1 || total !== 2) {
      const culprit =
        enzymes.find((e) => cutCount(pieceSeq(amplicon), 'linear', e) > (enzymes.length === 1 ? 2 : 1)) ??
        enzymes[0];
      return problems([
        { code: 'enzyme_cuts_insert', enzyme: culprit?.name ?? '', part: insert.id, cuts: total },
      ]);
    }
    insertPiece = (middle[0] as DigestedPiece).piece;
    fragments.push({
      name: insert.id,
      kind: 'pcr',
      templateId: insert.record.id,
      product: pieceSeq(designed.piece),
      primerIds: primers.map((p) => p.id),
    });
  } else {
    const cut = digestPiece(pieceFromPart(insert, 'insert', 1), enzymes).filter(
      (f) => f.cutLeft && f.cutRight,
    );
    const n = insert.record.seq.length;
    const wanted = insert.region;
    const covers = (f: DigestedPiece) => {
      if (!wanted) return true;
      const rel = (((wanted.start - f.piece.start) % n) + n) % n;
      return (
        (insert.record.topology === 'circular' || f.piece.start <= wanted.start) &&
        rel + wanted.length <= f.piece.length
      );
    };
    const holder = cut.filter(covers).sort((a, b) => b.piece.length - a.piece.length)[0];
    if (!holder) {
      const culprit = enzymes.find((e) => cutCount(regionTop, 'linear', e) > 0) ?? enzymes[0];
      const inside = culprit ? cutCount(regionTop, 'linear', culprit) : 0;
      return problems(
        inside > 0
          ? [{ code: 'enzyme_cuts_insert', enzyme: culprit?.name ?? '', part: insert.id, cuts: inside }]
          : [{ code: 'enzyme_no_site', enzyme: enzymes[0]?.name ?? '', part: insert.id }],
      );
    }
    insertPiece = strand === -1 ? flipPiece(holder.piece) : holder.piece;
    fragments.push({
      name: insert.id,
      kind: 'digest',
      templateId: insert.record.id,
      product: insert.record.seq,
      primerIds: [],
    });
  }

  const ways = orientations(vectorPiece, insertPiece);
  const intended = ways.find((w) => w.ok && w.insert.strand === strand) ?? ways.find((w) => w.ok);
  if (!intended || !insertPiece.leftEnd || !insertPiece.rightEnd) {
    const mismatch =
      !vectorPiece.rightEnd ||
      !insertPiece.leftEnd ||
      !endsCompatible(vectorPiece.rightEnd, insertPiece.leftEnd)
        ? { left: vectorRight, right: insertPiece.leftEnd }
        : { left: insertPiece.rightEnd, right: vectorLeft };
    return problems(
      [
        {
          code: 'incompatible_ends',
          junction: `${mismatch.left?.source}/${mismatch.right?.source}`,
          left: mismatch.left ?? vectorRight,
          right: mismatch.right ?? vectorLeft,
        },
      ],
      warnings,
    );
  }

  const results: Construct[] = [];
  for (const way of [intended, ...ways.filter((w) => w.ok && w !== intended)]) {
    const built = constructOf(`${vector.id}+${insert.id}`, vectorPiece, way.insert, primers, way.label);
    if (built && 'code' in built) return problems([built], warnings);
    if (built) results.push(built);
  }
  if (results.length > 1) warnings.push({ code: 'both_orientations_possible' });
  if (endsCompatible(vectorRight, vectorLeft)) {
    warnings.push({ code: 'vector_self_ligation', dephosphorylate: !!request.dephosphorylateVector });
  }
  if (vectorRight.type === 'blunt' || vectorLeft.type === 'blunt') {
    warnings.push({ code: 'blunt_ligation', orientationUnknown: true });
  }
  if (request.dephosphorylateVector && mode === 'amplify') {
    warnings.push({ code: 'dephosphorylated_vector_unphosphorylated_insert' });
  }
  return { ok: true, design: { method: 'restriction', primers, fragments, constructs: results, warnings } };
}
