import type { Enzyme } from '../types';
import { cutCount, findEnzyme, isClassicEnzyme, isTypeIIS } from './enzymes';
import type { CloningProblem, CloningWarning, Part, Piece, Region } from './model';
import { type DigestedPiece, digestPiece, pieceFromPart } from './piece';

/** How a circular vector is opened: cut with enzymes, or opened by removing a region (an empty region is a cut point). */
export type VectorOpening = { readonly enzymes: readonly string[] } | { readonly remove: Region };

/** Two fragments within this fraction of each other's length cannot be told apart on a gel. */
const COMIGRATION = 0.2;

export interface OpenedVector {
  /** The linear vector as a piece (top strand between the cuts); its ends carry the cuts. */
  readonly piece: Piece;
  readonly enzymes: readonly Enzyme[];
  readonly warnings: CloningWarning[];
}

/** Looks up classic enzymes by name; returns the problem for the first one that is unknown or unsuitable. */
export function resolveEnzymes(names: readonly string[]): Enzyme[] | CloningProblem {
  const enzymes: Enzyme[] = [];
  for (const name of names) {
    const found = findEnzyme(name);
    if (!found) return { code: 'enzyme_unknown', enzyme: name };
    if (!isClassicEnzyme(found))
      return { code: 'enzyme_not_suitable', enzyme: name, reason: 'degenerate_site' };
    enzymes.push(found);
  }
  return enzymes;
}

/**
 * Cuts a circular vector with enzymes that each cut it once and keeps the largest fragment as the backbone.
 * Warns when the discarded fragment is too close in size to separate on a gel.
 */
export function openWithEnzymes(vector: Part, enzymes: readonly Enzyme[]): OpenedVector | CloningProblem {
  for (const enzyme of enzymes) {
    const cuts = cutCount(vector.record.seq, vector.record.topology, enzyme);
    if (cuts === 0) return { code: 'enzyme_no_site', enzyme: enzyme.name, part: vector.id };
    if (cuts > 1) return { code: 'enzyme_cuts_vector_repeatedly', enzyme: enzyme.name, cuts };
  }
  const fragments = digestPiece(pieceFromPart(vector, 'vector'), enzymes).filter(
    (f) => f.cutLeft && f.cutRight,
  );
  const ranked = [...fragments].sort((a, b) => b.piece.length - a.piece.length);
  const backbone = ranked[0] as DigestedPiece;
  const stub = ranked[1];
  const warnings: CloningWarning[] = [];
  if (stub && Math.abs(stub.piece.length - backbone.piece.length) <= COMIGRATION * backbone.piece.length) {
    warnings.push({
      code: 'vector_stub_comigrates',
      stubLength: stub.piece.length,
      backboneLength: backbone.piece.length,
    });
  }
  return { piece: backbone.piece, enzymes, warnings };
}

/** Opens the vector as asked. Removing a region keeps the rest of the circle as the linear vector. */
export function openVector(vector: Part, opening: VectorOpening): OpenedVector | CloningProblem {
  if ('enzymes' in opening) {
    const enzymes = resolveEnzymes(opening.enzymes);
    return 'code' in enzymes ? enzymes : openWithEnzymes(vector, enzymes);
  }
  const n = vector.record.seq.length;
  const { start, length } = opening.remove;
  if (!(length >= 0 && length < n && start >= 0 && start < n) || vector.record.topology !== 'circular') {
    return { code: 'region_out_of_range', part: vector.id };
  }
  const piece: Piece = {
    ...pieceFromPart({ ...vector, region: { start: (start + length) % n, length: n - length } }, 'vector'),
    leftEnd: { type: 'blunt', overhang: '', source: 'opening' },
    rightEnd: { type: 'blunt', overhang: '', source: 'opening' },
  };
  return { piece, enzymes: [], warnings: [] };
}
