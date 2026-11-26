/**
 * Core domain types shared by the analysis engine, the file formats and the UI.
 *
 * Conventions (see docs/architecture.md):
 * - Coordinates are 0-based, half-open `[start, end)`. The UI shows 1-based, inclusive positions.
 * - Sequences are stored upper-case. DNA and RNA keep their own letters (T vs U); IUPAC codes are allowed.
 * - A feature that crosses the origin of a circular sequence is stored as two segments, never as
 *   one segment with `start > end`. Every segment satisfies `0 <= start < end <= length`.
 * - All records are plain, serialisable data so they cross a Web Worker boundary and a project file unchanged.
 */

export type Alphabet = 'dna' | 'rna' | 'protein';
export type Topology = 'linear' | 'circular';
export type Strand = 1 | -1;

/** Half-open interval on the top strand. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** A possibly discontinuous location, e.g. GenBank `join(...)` or an origin-spanning feature. */
export interface Location {
  /** Segments in biological order (5'→3' of the feature). Never empty. */
  readonly segments: readonly Span[];
  readonly strand: Strand;
}

export const FEATURE_TYPES = [
  'gene',
  'CDS',
  'promoter',
  'terminator',
  'RBS',
  'rep_origin',
  'resistance',
  'tag',
  'primer_bind',
  'protein_bind',
  'enhancer',
  'polyA_signal',
  'regulatory',
  'misc_feature',
  'custom',
] as const;
export type FeatureType = (typeof FEATURE_TYPES)[number];

/** Where an annotation came from. Auto-detected features are recomputed, never persisted as user data. */
export type FeatureOrigin = 'file' | 'user' | 'detected';

export interface Feature {
  readonly id: string;
  readonly type: FeatureType;
  readonly name: string;
  readonly location: Location;
  readonly origin: FeatureOrigin;
  /** CSS color. Absent means the theme color for `type`. */
  readonly color?: string;
  readonly description?: string;
  /** Free-form qualifiers from GenBank/EMBL (`/note`, `/product`, ...), kept for lossless export. */
  readonly qualifiers?: Readonly<Record<string, readonly string[]>>;
}

export interface SeqMetadata {
  readonly accession?: string;
  readonly organism?: string;
  readonly molType?: string;
  readonly date?: string;
  /** File format the record was read from, for round-trip export defaults. */
  readonly sourceFormat?: SequenceFormat;
}

export interface SeqRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly alphabet: Alphabet;
  readonly topology: Topology;
  readonly seq: string;
  readonly features: readonly Feature[];
  readonly metadata: SeqMetadata;
  /** Sanger trace data when read from an AB1 file. */
  readonly trace?: Chromatogram;
}

export interface Chromatogram {
  /** Trace intensity per channel, sampled at the same points. */
  readonly channels: Readonly<Record<'A' | 'C' | 'G' | 'T', readonly number[]>>;
  /** Sample index of the peak for each called base. Same length as the record's `seq`. */
  readonly peakPositions: readonly number[];
  /** Phred quality per called base, when the file has it. */
  readonly quality?: readonly number[];
}

export type SequenceFormat = 'fasta' | 'genbank' | 'embl' | 'snapgene' | 'ab1' | 'raw';

// ---------------------------------------------------------------------------
// Restriction enzymes
// ---------------------------------------------------------------------------

export type EndType = 'blunt' | 'five_prime' | 'three_prime';

/**
 * A restriction enzyme with a single cut per recognition site (Type II and Type IIS).
 *
 * Cut offsets are measured from the first base of the recognition site on the top strand, in the
 * site's own orientation: `topCut` is where the top strand is cut, `bottomCut` where the bottom
 * strand is cut, both expressed as top-strand positions. EcoRI (G^AATTC) has topCut 1, bottomCut 5.
 * Type IIS enzymes cut outside the site, so offsets may be negative or exceed the site length.
 */
export interface Enzyme {
  readonly name: string;
  /** Recognition site, IUPAC, 5'→3'. */
  readonly site: string;
  readonly topCut: number;
  readonly bottomCut: number;
  /** Supplier codes (REBASE letters, e.g. N = NEB, F = Thermo Fisher). */
  readonly suppliers: readonly string[];
  /** Isoschizomer group key: enzymes that share `site` and cut offsets. */
  readonly isoschizomerOf?: string;
}

export interface CutSite {
  readonly enzyme: string;
  /** Top-strand cut position, 0-based, the index of the first base after the cut. */
  readonly topCut: number;
  readonly bottomCut: number;
  /** Start of the matched recognition site on the top strand. */
  readonly siteStart: number;
  /** Strand the recognition site was found on. */
  readonly siteStrand: Strand;
  readonly end: EndType;
  /** Single-stranded overhang, 5'→3' on the top strand. Empty for blunt ends. */
  readonly overhang: string;
}

export interface Fragment {
  /** Location on the parent; an origin-spanning fragment of a circular parent has two segments. */
  readonly location: Location;
  readonly length: number;
  readonly leftEnd: FragmentEnd;
  readonly rightEnd: FragmentEnd;
}

/** One end of a fragment: the enzyme that made it, or the physical end of a linear molecule. */
export type FragmentEnd =
  | { readonly kind: 'cut'; readonly enzyme: string; readonly end: EndType; readonly overhang: string }
  | { readonly kind: 'terminus' };

// ---------------------------------------------------------------------------
// Primers and PCR
// ---------------------------------------------------------------------------

export interface PrimerConditions {
  /** Monovalent cation concentration, mM. */
  readonly naMm: number;
  /** Divalent cation concentration, mM. */
  readonly mgMm: number;
  /** dNTP concentration, mM. */
  readonly dntpMm: number;
  /** Primer (oligo) concentration, nM. */
  readonly oligoNm: number;
}

export interface Primer {
  readonly id: string;
  readonly name: string;
  /** 5'→3'. May carry a 5' tail that does not bind the template (restriction site, homology arm). */
  readonly seq: string;
}

export interface PrimerBinding {
  readonly primerId: string;
  readonly strand: Strand;
  /** Template span the 3' binding part covers. */
  readonly span: Span;
  readonly mismatches: number;
}

export interface Amplicon {
  readonly forward: PrimerBinding;
  readonly reverse: PrimerBinding;
  /** Full product including primer tails. */
  readonly seq: string;
  readonly length: number;
  /** True when the product crosses the origin of a circular template. */
  readonly wrapsOrigin: boolean;
}

// ---------------------------------------------------------------------------
// Detected features catalog
// ---------------------------------------------------------------------------

/** A known sequence element the engine searches for (promoters, origins, tags, resistance genes, ...). */
export interface FeatureSignature {
  readonly name: string;
  readonly type: FeatureType;
  /** Nucleotide (IUPAC) or protein sequence to match. */
  readonly seq: string;
  readonly seqAlphabet: 'dna' | 'protein';
  /** Minimum fraction identity for a hit, 0..1. */
  readonly minIdentity: number;
  readonly description?: string;
}
