import topoData from '../../data/cloning-topo.json';
import { assemble } from './assemble';
import type {
  Assembly,
  CloningProblem,
  CloningResult,
  CloningWarning,
  Construct,
  Junction,
  Part,
  Piece,
  PreparedFragment,
} from './model';
import { flipPiece, partRegion, pieceFromPart, pieceRegionSeq, pieceSeq, regionFits } from './piece';
import { designPieceEnds, type PrimerOptions } from './primer-design';

export interface TopoRequest extends PrimerOptions {
  readonly method: 'topo';
  /** Circular TOPO vector. */
  readonly vector: Part;
  /** The insertion point: the insert goes between vector bases `site - 1` and `site` (0-based). */
  readonly site: number;
  readonly insert: Part;
  /** Directional TOPO (blunt product, CACC at the 5' end) or non-directional TA. */
  readonly directional: boolean;
  /**
   * `true` (default): primers amplify the insert region and, for directional TOPO, add CACC. `false`: the region
   * is the finished product, and directional TOPO then needs it to start with CACC.
   */
  readonly amplify?: boolean;
  /** Polymerase of the PCR; decides whether the product has a 3' A. Default: Taq for TA, proofreading for directional. */
  readonly polymerase?: 'taq' | 'proofreading';
}

const fail = (list: CloningProblem[], warnings: CloningWarning[] = []): CloningResult => ({
  ok: false,
  problems: list,
  warnings,
});

/**
 * TOPO cloning: directional (blunt product with CACC, one orientation) or non-directional TA (product with a 3'
 * A overhang that pairs with the vector's T, either orientation).
 *
 * The construct is the vector opened at the site with the product between its ends. The T that pairs with the
 * product's left end is the vector base just before the site, so the site should follow a T; the 3' A of the
 * product is added after the insert. The reaction is a topoisomerase ligation, so no kinetics are modelled.
 */
export function designTopo(request: TopoRequest): CloningResult {
  const { vector, insert, directional } = request;
  const n = vector.record.seq.length;
  if (vector.record.topology !== 'circular' || !(request.site >= 0 && request.site < n)) {
    return fail([{ code: 'topo_site_out_of_range' }]);
  }
  if (!regionFits(insert.record, partRegion(insert)))
    return fail([{ code: 'region_out_of_range', part: insert.id }]);
  const amplify = request.amplify ?? true;
  const polymerase = request.polymerase ?? (directional ? 'proofreading' : 'taq');
  const warnings: CloningWarning[] = [];

  const vectorPiece: Piece = pieceFromPart(
    { ...vector, region: { start: request.site, length: n } },
    'vector',
  );
  const insertBase = pieceFromPart(insert, 'insert');
  const region = pieceRegionSeq(insertBase);
  const prefix = topoData.forwardPrefix;

  if (directional && !amplify && !region.startsWith(prefix))
    return fail([{ code: 'topo_missing_cacc', part: insert.id }]);
  if (directional && polymerase === 'taq') warnings.push({ code: 'topo_directional_needs_blunt' });
  if (!directional && polymerase === 'proofreading') warnings.push({ code: 'topo_a_overhang_lost' });
  if (!directional && vector.record.seq[(request.site - 1 + n) % n] !== 'T')
    warnings.push({ code: 'topo_site_without_t' });

  let insertPiece: Piece = insertBase;
  const fragments: PreparedFragment[] = [];
  let primers: ReturnType<typeof designPieceEnds>['primers'] = [];
  if (amplify) {
    const leftAdd = directional && !region.startsWith(prefix) ? prefix : '';
    const designed = designPieceEnds({ ...insertBase, leftAdd }, request);
    primers = designed.primers;
    warnings.push(...designed.warnings);
    insertPiece = designed.piece;
    fragments.push({
      name: insert.id,
      kind: 'pcr',
      templateId: insert.record.id,
      product: pieceSeq(designed.piece),
      primerIds: primers.map((p) => p.id),
    });
  } else {
    fragments.push({
      name: insert.id,
      kind: 'as_is',
      templateId: insert.record.id,
      product: region,
      primerIds: [],
    });
  }
  const withOverhang = (piece: Piece): Piece =>
    directional ? piece : { ...piece, rightAdd: topoData.taOverhang };

  const junctions = (piece: Piece): Junction[] =>
    directional
      ? [
          {
            kind: 'topo',
            label: `TOPO ${prefix}/${topoData.directionalOverhang}`,
            overlap: 0,
            mark: { offset: 0, length: piece.leftAdd.length ? prefix.length : 0 },
          },
          { kind: 'topo', label: 'TOPO blunt end', overlap: 0, mark: { offset: 0, length: 0 } },
        ]
      : [
          { kind: 'ta', label: 'TOPO TA left', overlap: 0, mark: { offset: -1, length: 1 } },
          { kind: 'ta', label: 'TOPO TA right', overlap: 0, mark: { offset: -1, length: 1 } },
        ];

  const orientations: [string, Piece][] = [['forward', withOverhang(insertPiece)]];
  if (!directional) orientations.push(['reverse', withOverhang(flipPiece(insertPiece))]);
  const constructs: Construct[] = [];
  for (const [label, piece] of orientations) {
    const assembly: Assembly = {
      name: `${vector.id}+${insert.id}`,
      pieces: [vectorPiece, piece],
      junctions: junctions(piece),
      primers,
    };
    const built = assemble(assembly);
    if ('problem' in built) return fail([built.problem], warnings);
    constructs.push({ ...built.construct, orientation: label });
  }
  if (constructs.length > 1) warnings.push({ code: 'both_orientations_possible' });
  return { ok: true, design: { method: 'topo', primers, fragments, constructs, warnings } };
}
