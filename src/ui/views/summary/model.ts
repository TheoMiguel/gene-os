import { AMINO_ACIDS } from '../../../engine/alphabet';
import type { DetectedFeature } from '../../../engine/features';
import { formatLocation, regionStart } from '../../../engine/location';
import type { Orf } from '../../../engine/orf';
import type { OrganismInference } from '../../../engine/organism';
import type { Alphabet, SeqRecord, Topology } from '../../../engine/types';
import type { Language } from '../../../state/settings';

// ---------------------------------------------------------------------------
// Window sizes
// ---------------------------------------------------------------------------

const MIN_DEFAULT_WINDOW = 10;
const WINDOWS_PER_SEQUENCE = 100;
const HYDROPATHY_WINDOW = 9;

function snapToNice(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / magnitude;
  const nice = [1, 2, 5, 10].reduce((best, candidate) =>
    Math.abs(candidate - mantissa) < Math.abs(best - mantissa) ? candidate : best,
  );
  return nice * magnitude;
}

/** A window of about 1% of the sequence, snapped to 1, 2 or 5 times a power of ten, never below 10 bases or above the length. */
export function defaultWindow(length: number): number {
  if (length <= 0) return 0;
  return Math.min(length, snapToNice(Math.max(MIN_DEFAULT_WINDOW, length / WINDOWS_PER_SEQUENCE)));
}

/** Distance between window starts: a tenth of the window, so a chart holds about a thousand points at any length. */
export function windowStep(window: number): number {
  return Math.max(1, Math.floor(window / 10));
}

/** Keeps a window the user typed inside 2..length (or 1 for a one-base sequence). Not a number gives the default. */
export function clampWindow(value: number, length: number): number {
  if (!Number.isFinite(value)) return defaultWindow(length);
  return Math.max(Math.min(2, length), Math.min(length, Math.round(value)));
}

/** The Kyte-Doolittle window of the field, 9 residues, or the whole protein when it is shorter. */
export function defaultHydropathyWindow(length: number): number {
  return Math.max(1, Math.min(HYDROPATHY_WINDOW, length));
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

/** A whole number with the digit grouping of the interface language. */
export function formatInt(value: number, language: Language): string {
  return new Intl.NumberFormat(language).format(value);
}

/** A number with exactly `digits` decimals, in the interface language. */
export function formatFixed(value: number, digits: number, language: Language): string {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** A 0..1 fraction as a percent with one decimal. */
export function formatPercent(fraction: number, language: Language, digits = 1): string {
  return `${formatFixed(fraction * 100, digits, language)}%`;
}

/** Length with its unit: `2,686 bp` (`pb` in Spanish and Portuguese) for a nucleotide sequence, `286 aa` for a protein. */
export function formatLength(length: number, alphabet: Alphabet, language: Language): string {
  const unit = alphabet === 'protein' ? 'aa' : language === 'en' ? 'bp' : 'pb';
  return `${formatInt(length, language)} ${unit}`;
}

/** A rounded size for a long sequence (`5.39 kb`, `4.64 Mb`), or null under 1 000 bases. */
export function roughSize(length: number, language: Language): string | null {
  if (length >= 1_000_000) return `${formatFixed(length / 1_000_000, 2, language)} Mb`;
  if (length >= 1_000) return `${formatFixed(length / 1_000, 2, language)} kb`;
  return null;
}

/** A mass in g/mol as Da, kDa or MDa, whichever keeps the number between 1 and 1 000. */
export function formatMass(gramsPerMole: number, language: Language): string {
  if (gramsPerMole >= 1_000_000) return `${formatFixed(gramsPerMole / 1_000_000, 2, language)} MDa`;
  if (gramsPerMole >= 1_000) return `${formatFixed(gramsPerMole / 1_000, 2, language)} kDa`;
  return `${formatFixed(gramsPerMole, 1, language)} Da`;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** The letter of the row that gathers every character that is not a plain base or amino acid. */
export const OTHER_LETTER = '*';

/** One row of the composition table. */
export interface CompositionRow {
  readonly letter: string;
  /** The three-letter amino acid code; the letter itself for a base. */
  readonly name: string;
  readonly count: number;
  /** Fraction of the whole sequence, 0..1. */
  readonly fraction: number;
}

const AMINO_ACID_NAMES: Readonly<Record<string, string>> = {
  A: 'Ala',
  C: 'Cys',
  D: 'Asp',
  E: 'Glu',
  F: 'Phe',
  G: 'Gly',
  H: 'His',
  I: 'Ile',
  K: 'Lys',
  L: 'Leu',
  M: 'Met',
  N: 'Asn',
  P: 'Pro',
  Q: 'Gln',
  R: 'Arg',
  S: 'Ser',
  T: 'Thr',
  V: 'Val',
  W: 'Trp',
  Y: 'Tyr',
};

/** The letters the composition table lists for an alphabet, in display order. */
export function compositionLetters(alphabet: Alphabet): readonly string[] {
  if (alphabet === 'protein') return [...AMINO_ACIDS];
  return alphabet === 'rna' ? ['A', 'C', 'G', 'U'] : ['A', 'C', 'G', 'T'];
}

/**
 * Rows of the composition table: each plain base or amino acid, then one row for every other character
 * (ambiguity codes, stops, gaps) when there are any. Fractions are of the whole length.
 */
export function compositionRows(
  counts: Readonly<Record<string, number>>,
  alphabet: Alphabet,
  length: number,
): CompositionRow[] {
  const rows = compositionLetters(alphabet).map((letter): CompositionRow => {
    const count = counts[letter] ?? 0;
    return {
      letter,
      name: alphabet === 'protein' ? (AMINO_ACID_NAMES[letter] ?? letter) : letter,
      count,
      fraction: length === 0 ? 0 : count / length,
    };
  });
  const other = length - rows.reduce((sum, row) => sum + row.count, 0);
  if (other > 0)
    rows.push({ letter: OTHER_LETTER, name: OTHER_LETTER, count: other, fraction: other / length });
  return rows;
}

/** A segment of the base-composition strip: where it starts and how wide it is, as fractions of the strip. */
export interface StripSegment {
  readonly letter: string;
  readonly count: number;
  readonly fraction: number;
  readonly offset: number;
}

/** The strip's segments, left to right in table order. An absent letter keeps its place with zero width. */
export function stripSegments(rows: readonly CompositionRow[]): StripSegment[] {
  let offset = 0;
  return rows.map((row) => {
    const segment = { letter: row.letter, count: row.count, fraction: row.fraction, offset };
    offset += row.fraction;
    return segment;
  });
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

/** Why the view shows the topology it shows. */
export type TopologyBasis =
  | 'stated'
  | 'chosen'
  | 'overlap'
  | 'vector'
  | 'assumed'
  | 'pending'
  | 'unavailable';

export interface TopologyReading {
  readonly topology: Topology;
  readonly basis: TopologyBasis;
}

/** File formats whose header says whether the molecule is circular. FASTA, raw text and AB1 do not. */
const STATING_FORMATS: ReadonlySet<string> = new Set(['genbank', 'embl', 'snapgene']);
const MIN_OVERLAP = 20;
const MAX_OVERLAP = 1000;
const MIN_LENGTH_FOR_OVERLAP = 100;

/** True when the file format records the topology, so the value is the file's and not a guess. */
export function statesTopology(record: SeqRecord): boolean {
  return record.metadata.sourceFormat !== undefined && STATING_FORMATS.has(record.metadata.sourceFormat);
}

/**
 * Length of the longest stretch the sequence ends with and starts with (at least 20 bases, at most 1 000 and half
 * the length), or 0. A circular molecule written as a line often repeats its start at the end.
 */
export function endsOverlap(seq: string): number {
  if (seq.length < MIN_LENGTH_FOR_OVERLAP) return 0;
  const upper = Math.min(MAX_OVERLAP, Math.floor(seq.length / 2));
  for (let k = upper; k >= MIN_OVERLAP; k--) {
    if (seq.endsWith(seq.slice(0, k))) return k;
  }
  return 0;
}

/**
 * The topology to show for a record. A GenBank, EMBL or SnapGene file states it. Otherwise the user's choice wins,
 * then overlapping ends, then a vector call by the organism inference, and a molecule with none of these is assumed
 * linear. While the organism inference runs and nothing else decides, the reading is `pending`.
 */
export function readTopology(
  record: SeqRecord,
  chosen: boolean,
  organism: 'pending' | 'failed' | OrganismInference,
): TopologyReading {
  if (statesTopology(record)) return { topology: record.topology, basis: 'stated' };
  if (chosen) return { topology: record.topology, basis: 'chosen' };
  if (endsOverlap(record.seq) > 0) return { topology: 'circular', basis: 'overlap' };
  if (organism === 'pending') return { topology: record.topology, basis: 'pending' };
  if (organism === 'failed') return { topology: record.topology, basis: 'unavailable' };
  return organism.category === 'synthetic-vector'
    ? { topology: 'circular', basis: 'vector' }
    : { topology: 'linear', basis: 'assumed' };
}

// ---------------------------------------------------------------------------
// ORFs and detected features
// ---------------------------------------------------------------------------

/** ORFs of at least this many codons are listed; a short sequence lists shorter ones, where a small gene is the point. */
export function minOrfCodons(length: number): number {
  return length < 5_000 ? 30 : 100;
}

/** The `count` longest ORFs, longest first, without sorting the whole list. */
export function longestOrfs(orfs: readonly Orf[], count: number): Orf[] {
  const best: Orf[] = [];
  for (const orf of orfs) {
    if (best.length === count && orf.lengthAa <= (best[count - 1] as Orf).lengthAa) continue;
    let at = best.length;
    while (at > 0 && (best[at - 1] as Orf).lengthAa < orf.lengthAa) at--;
    best.splice(at, 0, orf);
    if (best.length > count) best.pop();
  }
  return best;
}

/** One line of the detected-feature table. */
export interface FeatureRow {
  readonly feature: DetectedFeature;
  /** 0-based position the Sequence view opens at. */
  readonly position: number;
  /** GenBank-style 1-based location text. */
  readonly location: string;
}

/** Table rows for the detected features, in sequence order. */
export function featureRows(features: readonly DetectedFeature[]): FeatureRow[] {
  return features
    .map((feature) => ({
      feature,
      position: regionStart(feature.location),
      location: formatLocation(feature.location),
    }))
    .sort((a, b) => a.position - b.position);
}

/** How many detected features of each type there are, most frequent first. */
export function featureTypeCounts(
  features: readonly DetectedFeature[],
): readonly (readonly [DetectedFeature['type'], number])[] {
  const counts = new Map<DetectedFeature['type'], number>();
  for (const feature of features) counts.set(feature.type, (counts.get(feature.type) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
