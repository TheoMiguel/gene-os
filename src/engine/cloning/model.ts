/**
 * Data shape shared by every cloning method (spec section 4.5).
 *
 * Every method answers one question: which double-stranded pieces, joined at which junctions, close into one
 * circular construct? So a method is data plus a small designer:
 *
 *   Piece     one stretch of a source record, read on one strand, with the bases a primer adds outside it
 *             (`leftAdd`, `rightAdd`: homology arm, enzyme site, att site, CACC, ...).
 *   Junction  how piece i meets piece i+1 (the last piece meets the first). `overlap` bases are shared by both
 *             pieces and appear once in the construct (homology arms, recombination core). Sticky and blunt
 *             ends share nothing: top strands of digest fragments tile the molecule, so they concatenate.
 *   Assembly  pieces + junctions + the primers to order. `assemble` turns it into the construct record.
 *
 * Designers (restriction.ts, gibson.ts, golden-gate.ts, gateway.ts, topo.ts, lic.ts) only decide the pieces,
 * the added bases and the junction kinds. Feature carry-over, junction and primer annotation, origin handling
 * and the consistency check at every junction live once, in assemble.ts.
 */
import type { EndType, SeqRecord, Strand } from '../types';

export type CloningMethod =
  | 'restriction'
  | 'gibson'
  | 'in_fusion'
  | 'golden_gate'
  | 'gateway'
  | 'topo'
  | 'lic';

/** A region of a record: `length` bases from `start`; on a circular record it may cross the origin. */
export interface Region {
  readonly start: number;
  readonly length: number;
}

/** A molecule the user supplies, or the part of it that goes into the construct. Absent region: the whole record. */
export interface Part {
  readonly id: string;
  readonly record: SeqRecord;
  readonly region?: Region;
}

/** The primer that anneals at one end of a piece, anchored to the piece's region. */
export interface PrimerAnchor {
  readonly primerId: string;
  /** Bases of the primer that anneal to the region (the rest is its 5' tail). */
  readonly anneal: number;
}

/** One end of a piece: the single-stranded overhang it leaves, in the top-strand orientation of the piece. */
export interface PieceEnd {
  readonly type: EndType;
  readonly overhang: string;
  /** What made the end: an enzyme name, `pcr`, `chew-back`, `recombination`. */
  readonly source: string;
}

export interface Piece {
  readonly name: string;
  readonly role: 'vector' | 'insert';
  readonly record: SeqRecord;
  /** Region on the source record; wraps the origin when the record is circular. */
  readonly start: number;
  readonly length: number;
  /** -1 reads the region as its reverse complement. */
  readonly strand: Strand;
  /** Bases added before and after the region, in the piece's own orientation. */
  readonly leftAdd: string;
  readonly rightAdd: string;
  readonly leftEnd?: PieceEnd | undefined;
  readonly rightEnd?: PieceEnd | undefined;
  readonly forward?: PrimerAnchor | undefined;
  readonly reverse?: PrimerAnchor | undefined;
}

export type JunctionKind = 'sticky' | 'blunt' | 'homology' | 'recombination' | 'ta' | 'topo';

export interface Junction {
  readonly kind: JunctionKind;
  readonly label: string;
  /** Bases shared by both pieces (0 for ends that only concatenate). */
  readonly overlap: number;
  /**
   * The bases to mark as the junction, relative to the construct position where the right piece starts:
   * `[offset, offset + length)`. A length of 0 marks the site between two bases.
   */
  readonly mark: { readonly offset: number; readonly length: number };
}

export interface PlannedPrimer {
  readonly id: string;
  readonly name: string;
  /** 5'→3', tail included. */
  readonly seq: string;
  readonly annealLength: number;
  readonly tailLength: number;
  /** Nearest-neighbor Tm of the annealing part, °C. */
  readonly tm: number;
  /** Record the primer anneals to. */
  readonly templateId: string;
}

export interface Assembly {
  readonly name: string;
  readonly pieces: readonly Piece[];
  /** `junctions[i]` joins `pieces[i]` to `pieces[(i + 1) % pieces.length]`. */
  readonly junctions: readonly Junction[];
  readonly primers: readonly PlannedPrimer[];
}

/** What the user must prepare before the reaction: a PCR product, a digest, a chewed-back end. */
export interface PreparedFragment {
  readonly name: string;
  readonly kind: 'pcr' | 'digest' | 'chew_back' | 'as_is';
  readonly templateId: string;
  /** Sequence of the double-stranded product before enzyme treatment (PCR product, or the digested molecule). */
  readonly product: string;
  readonly primerIds: readonly string[];
  /** LIC: the single dNTP the T4 DNA polymerase chew-back runs with. */
  readonly dntp?: string;
}

// ---------------------------------------------------------------------------
// Problems stop the design; warnings do not. Both are data the UI translates.
// ---------------------------------------------------------------------------

export interface EndDescription {
  readonly type: EndType;
  readonly overhang: string;
  readonly source: string;
}

export type CloningProblem =
  | { readonly code: 'no_parts' }
  | { readonly code: 'region_out_of_range'; readonly part: string }
  | { readonly code: 'enzyme_unknown'; readonly enzyme: string }
  | {
      readonly code: 'enzyme_not_suitable';
      readonly enzyme: string;
      readonly reason: 'type_iis' | 'degenerate_site' | 'not_type_iis';
    }
  | { readonly code: 'enzyme_no_site'; readonly enzyme: string; readonly part: string }
  | {
      readonly code: 'enzyme_cuts_insert';
      readonly enzyme: string;
      readonly part: string;
      readonly cuts: number;
    }
  | { readonly code: 'enzyme_cuts_vector_repeatedly'; readonly enzyme: string; readonly cuts: number }
  | { readonly code: 'no_enzyme_pair' }
  | {
      readonly code: 'incompatible_ends';
      readonly junction: string;
      readonly left: EndDescription;
      readonly right: EndDescription;
    }
  | { readonly code: 'duplicate_overhang'; readonly overhang: string; readonly junctions: readonly number[] }
  | { readonly code: 'palindromic_overhang'; readonly overhang: string; readonly junction: number }
  | { readonly code: 'overhang_invalid'; readonly junction: number; readonly overhang: string }
  | { readonly code: 'primer_design_failed'; readonly part: string; readonly end: 'forward' | 'reverse' }
  | {
      readonly code: 'overlap_out_of_range';
      readonly min: number;
      readonly max: number;
      readonly value: number;
    }
  | { readonly code: 'topo_missing_cacc'; readonly part: string }
  | { readonly code: 'topo_site_out_of_range' }
  | { readonly code: 'att_site_unknown'; readonly variant: number }
  | { readonly code: 'att_site_not_found'; readonly part: string; readonly count: number }
  | { readonly code: 'att_no_route'; readonly detail: 'no_chain' | 'ambiguous_chain' | 'unused_parts' }
  | {
      readonly code: 'lic_overhang_mismatch';
      readonly junction: string;
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly code: 'lic_no_stop_nucleotide'; readonly part: string }
  | { readonly code: 'junction_mismatch'; readonly junction: string };

export type CloningWarning =
  | { readonly code: 'vector_self_ligation'; readonly dephosphorylate: boolean }
  | { readonly code: 'blunt_ligation'; readonly orientationUnknown: true }
  | { readonly code: 'dephosphorylated_vector_unphosphorylated_insert' }
  | { readonly code: 'vector_stub_comigrates'; readonly stubLength: number; readonly backboneLength: number }
  | { readonly code: 'both_orientations_possible' }
  | { readonly code: 'internal_site'; readonly enzyme: string; readonly part: string; readonly cuts: number }
  | { readonly code: 'three_prime_overhang_end'; readonly part: string; readonly enzyme: string }
  | { readonly code: 'primer_tm_low'; readonly primer: string; readonly tm: number }
  | { readonly code: 'primer_long'; readonly primer: string; readonly length: number }
  | { readonly code: 'overlap_gc_extreme'; readonly junction: string; readonly gc: number }
  | { readonly code: 'overlap_repeat'; readonly junction: string }
  | { readonly code: 'topo_site_without_t' }
  | { readonly code: 'topo_directional_needs_blunt' }
  | { readonly code: 'topo_a_overhang_lost' }
  | { readonly code: 'no_counterselection'; readonly part: string }
  | { readonly code: 'counterselection_kept'; readonly part: string }
  | { readonly code: 'insert_arc_guessed'; readonly part: string }
  | { readonly code: 'lic_overhang_short'; readonly junction: string; readonly length: number };

export interface JunctionInfo {
  readonly label: string;
  readonly kind: JunctionKind;
  /** Construct position (0-based) of the first base of the marked region. */
  readonly position: number;
  readonly length: number;
}

export interface Construct {
  /** How the insert sits: `forward`, `reverse` or a method-specific label. */
  readonly orientation: string;
  readonly record: SeqRecord;
  readonly junctions: readonly JunctionInfo[];
}

export interface CloningDesign {
  readonly method: CloningMethod;
  readonly primers: readonly PlannedPrimer[];
  readonly fragments: readonly PreparedFragment[];
  /** The intended construct first, then every other orientation the ends allow. */
  readonly constructs: readonly Construct[];
  readonly warnings: readonly CloningWarning[];
}

export type CloningResult =
  | { readonly ok: true; readonly design: CloningDesign }
  | {
      readonly ok: false;
      readonly problems: readonly CloningProblem[];
      readonly warnings: readonly CloningWarning[];
    };
