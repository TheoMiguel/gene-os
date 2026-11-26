import attData from '../../data/cloning-att-sites.json';
import { reverseComplement } from '../alphabet';
import type { Feature } from '../types';
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
import { flipPiece, partRegion, pieceFromPart, pieceSeq, regionFits, trimPiece } from './piece';
import { designPieceEnds, type PrimerOptions } from './primer-design';

/** The att site variants 1 to 5: the attB sequence and the crossover window every att form of the variant carries. */
export const ATT_SITES: ReadonlyMap<number, { readonly attB: string; readonly window: string }> = new Map(
  attData.sites.map((s) => [
    s.variant,
    {
      attB: s.attB,
      window: s.attB.slice(attData.crossover.start, attData.crossover.start + attData.crossover.length),
    },
  ]),
);

const WINDOW = attData.crossover.length;

export interface GatewayInsert {
  readonly part: Part;
  /** BP: amplify the region with primers that add these attB sites (variant numbers). Absent: use the part as it is. */
  readonly attB?: { readonly left: number; readonly right: number };
}

export interface GatewayRequest extends PrimerOptions {
  readonly method: 'gateway';
  /** `BP`: attB x attP gives attL. `LR`: attL x attR gives attB. */
  readonly reaction: 'BP' | 'LR';
  /** The donor (attP) or destination (attR) vector: circular, two sites around a ccdB cassette. */
  readonly vector: Part;
  /** PCR products or templates (BP) or entry clones (LR). Several inserts chain through shared variants. */
  readonly inserts: readonly GatewayInsert[];
}

/** A site on a molecule: its variant and the strand its window reads on (the sign). */
interface Site {
  readonly signed: number;
  readonly position: number;
}

/** A stretch of a molecule between two sites, windows included. */
interface Arc {
  readonly piece: Piece;
  readonly left: number;
  readonly right: number;
}

const fail = (list: CloningProblem[], warnings: CloningWarning[] = []): CloningResult => ({
  ok: false,
  problems: list,
  warnings,
});

/** Every site on a sequence, both strands, in position order. A circular sequence is read across its origin. */
function findSites(seq: string, circular: boolean): Site[] {
  const n = seq.length;
  const text = circular ? seq + seq.slice(0, WINDOW - 1) : seq;
  const sites: Site[] = [];
  for (const [variant, { window }] of ATT_SITES) {
    for (const [probe, sign] of [
      [window, 1],
      [reverseComplement(window), -1],
    ] as const) {
      for (let at = text.indexOf(probe); at !== -1 && at < n; at = text.indexOf(probe, at + 1)) {
        sites.push({ signed: sign * variant, position: at });
      }
    }
  }
  return sites.sort((a, b) => a.position - b.position);
}

/** The arcs between a molecule's two sites: one for a linear molecule, two for a circular one. */
function arcsOf(piece: Piece, sites: readonly [Site, Site], circular: boolean): Arc[] {
  const n = piece.record.seq.length;
  if (!circular) {
    const [a, b] = sites;
    const trimmed = trimPiece(piece, a.position, pieceSeq(piece).length - (b.position + WINDOW));
    return trimmed ? [{ piece: trimmed, left: a.signed, right: b.signed }] : [];
  }
  const [a, b] = sites;
  const arc = (from: Site, to: Site): Arc => {
    const length = ((to.position - from.position + n) % n) + WINDOW;
    return { piece: { ...piece, start: from.position, length }, left: from.signed, right: to.signed };
  };
  return [arc(a, b), arc(b, a)];
}

/** True when any segment of the feature lies inside the region, which may cross the origin of a circular record. */
function touches(feature: Feature, piece: Piece): boolean {
  const n = piece.record.seq.length;
  return feature.location.segments.some((s) =>
    [0, 1].some((k) => s.start + k * n < piece.start + piece.length && s.end + k * n > piece.start),
  );
}

/** Of the two arcs of a circular molecule, the one that holds fewer of the features `score` counts (ties: shorter). */
function pickArc(arcs: readonly Arc[], score: (arc: Arc) => number): { arc: Arc; clear: boolean } {
  const ranked = [...arcs].sort((x, y) => score(x) - score(y) || x.piece.length - y.piece.length);
  const [first, second] = ranked as [Arc, Arc];
  return { arc: first, clear: score(first) !== score(second) };
}

const isCcdB = (f: Feature) => /ccdb/i.test(f.name);
const isBackboneFeature = (f: Feature) => f.type === 'rep_origin' || f.type === 'resistance';
const countIn = (arc: Arc, test: (f: Feature) => boolean) =>
  arc.piece.record.features.filter((f) => test(f) && touches(f, arc.piece)).length;

/**
 * Gateway cloning, BP and LR, with the multi-fragment chain of MultiSite Gateway.
 *
 * Recombination is modelled the way it acts on sequence: two molecules swap the sides of the shared crossover
 * window of an att site variant, so the product is the vector backbone joined to the insert arcs at those
 * windows. A site is written as its variant and the strand it reads on; arcs chain when the site that ends one
 * is the site that starts the next, which fixes the order and the orientation of every insert. The arc of the
 * vector that holds the ccdB cassette is dropped (it goes to the by-product), so the construct carries no ccdB.
 * The by-product is not built.
 */
export function designGateway(request: GatewayRequest): CloningResult {
  const warnings: CloningWarning[] = [];
  const primers: PlannedPrimer[] = [];
  const fragments: PreparedFragment[] = [];
  if (request.inserts.length === 0) return fail([{ code: 'no_parts' }]);
  for (const part of [request.vector, ...request.inserts.map((i) => i.part)]) {
    if (!regionFits(part.record, partRegion(part)))
      return fail([{ code: 'region_out_of_range', part: part.id }]);
  }

  // Vector: the cassette arc goes, the backbone stays.
  const vectorPiece = pieceFromPart(request.vector, 'vector');
  const vectorSites = findSites(request.vector.record.seq, request.vector.record.topology === 'circular');
  if (vectorSites.length !== 2 || request.vector.record.topology !== 'circular') {
    return fail([{ code: 'att_site_not_found', part: request.vector.id, count: vectorSites.length }]);
  }
  const vectorArcs = arcsOf(
    { ...vectorPiece, length: request.vector.record.seq.length, start: 0 },
    vectorSites as [Site, Site],
    true,
  );
  const cassette = pickArc(vectorArcs, (a) => -countIn(a, isCcdB));
  const removed =
    countIn(cassette.arc, isCcdB) > 0 ? cassette.arc : pickArc(vectorArcs, (a) => a.piece.length).arc;
  if (!(countIn(removed, isCcdB) > 0))
    warnings.push({ code: 'no_counterselection', part: request.vector.id });
  const backbone = vectorArcs.find((a) => a !== removed) as Arc;
  fragments.push({
    name: request.vector.id,
    kind: 'as_is',
    templateId: request.vector.record.id,
    product: request.vector.record.seq,
    primerIds: [],
  });

  // Inserts: amplify with attB tails, or take the part as it is; then find the arc between its two sites.
  const insertArcs: Arc[] = [];
  for (const insert of request.inserts) {
    let piece = pieceFromPart(insert.part, 'insert');
    if (insert.attB) {
      const left = ATT_SITES.get(insert.attB.left);
      const right = ATT_SITES.get(insert.attB.right);
      if (!left) return fail([{ code: 'att_site_unknown', variant: insert.attB.left }]);
      if (!right) return fail([{ code: 'att_site_unknown', variant: insert.attB.right }]);
      const tails = {
        leftAdd: attData.primerPrefix + left.attB,
        rightAdd: reverseComplement(attData.primerPrefix + right.attB),
      };
      const designed = designPieceEnds({ ...piece, ...tails }, request);
      primers.push(...designed.primers);
      warnings.push(...designed.warnings);
      piece = designed.piece;
      fragments.push({
        name: insert.part.id,
        kind: 'pcr',
        templateId: insert.part.record.id,
        product: pieceSeq(piece),
        primerIds: designed.primers.map((p) => p.id),
      });
    } else {
      fragments.push({
        name: insert.part.id,
        kind: 'as_is',
        templateId: insert.part.record.id,
        product: insert.part.record.seq,
        primerIds: [],
      });
    }
    const circular = insert.attB ? false : insert.part.record.topology === 'circular';
    const inTails = (at: number) =>
      at + WINDOW <= piece.leftAdd.length || at >= piece.leftAdd.length + piece.length;
    const sites = findSites(insert.attB ? pieceSeq(piece) : insert.part.record.seq, circular).filter(
      (site) => !insert.attB || inTails(site.position),
    );
    if (sites.length !== 2)
      return fail([{ code: 'att_site_not_found', part: insert.part.id, count: sites.length }], warnings);
    const whole = insert.attB ? piece : { ...piece, start: 0, length: insert.part.record.seq.length };
    const arcs = arcsOf(whole, sites as [Site, Site], circular);
    if (arcs.length === 2) {
      const { arc, clear } = pickArc(arcs, (a) => countIn(a, isBackboneFeature));
      if (!clear) warnings.push({ code: 'insert_arc_guessed', part: insert.part.id });
      insertArcs.push(arc);
    } else if (arcs[0]) {
      insertArcs.push(arcs[0]);
    }
  }

  // Order and orient the inserts: each arc starts with the site the previous one ended with.
  const target = removed.right;
  const chains: Arc[][] = [];
  const walk = (current: number, used: ReadonlySet<number>, chain: readonly Arc[]) => {
    if (used.size === insertArcs.length) {
      if (current === target) chains.push([...chain]);
      return;
    }
    insertArcs.forEach((arc, k) => {
      if (used.has(k)) return;
      if (arc.left === current) walk(arc.right, new Set([...used, k]), [...chain, arc]);
      if (-arc.right === current) {
        const flipped: Arc = { piece: flipPiece(arc.piece), left: -arc.right, right: -arc.left };
        walk(flipped.right, new Set([...used, k]), [...chain, flipped]);
      }
    });
  };
  walk(removed.left, new Set(), []);
  if (chains.length !== 1) {
    return fail(
      [{ code: 'att_no_route', detail: chains.length === 0 ? 'no_chain' : 'ambiguous_chain' }],
      warnings,
    );
  }
  const chain = chains[0] as Arc[];

  const pieces: Piece[] = [backbone.piece, ...chain.map((a) => a.piece)];
  const names = [backbone.right, ...chain.map((a) => a.right)];
  const form = request.reaction === 'BP' ? 'attL' : 'attB';
  const junctions: Junction[] = pieces.map((_, i) => ({
    kind: 'recombination',
    label: `${form}${Math.abs(names[i] as number)}`,
    overlap: WINDOW,
    mark: { offset: 0, length: WINDOW },
  }));
  const assembly: Assembly = {
    name: `${request.vector.id}+${request.inserts.map((i) => i.part.id).join('+')}`,
    pieces,
    junctions,
    primers,
  };
  const built = assemble(assembly);
  if ('problem' in built) return fail([built.problem], warnings);
  if (built.construct.record.features.some(isCcdB)) {
    warnings.push({ code: 'counterselection_kept', part: request.vector.id });
  }
  return {
    ok: true,
    design: { method: 'gateway', primers, fragments, constructs: [built.construct], warnings },
  };
}
