import { type AlignMode, alignPair, type Difference, type PairwiseAlignment } from '../engine/align';
import { countLetters, gcContent, nucleotideSeries } from '../engine/composition';
import { ENZYME_CATALOG, scanSites } from '../engine/restriction';
import type { Enzyme, SeqRecord } from '../engine/types';

/**
 * Restriction enzymes of the comparison map: the cutters a student meets in cloning, from the commercial
 * catalog. The whole catalog would list hundreds of enzymes that mean nothing to the reader.
 */
export const RESTRICTION_PANEL = [
  'EcoRI',
  'BamHI',
  'HindIII',
  'XbaI',
  'SalI',
  'PstI',
  'SphI',
  'KpnI',
  'SacI',
  'NotI',
  'XhoI',
  'NcoI',
  'NdeI',
  'EcoRV',
  'SmaI',
  'ApaI',
  'ClaI',
  'SpeI',
  'BglII',
  'NheI',
  'MluI',
  'AgeI',
  'AscI',
  'PacI',
  'ScaI',
  'BsaI',
] as const;

/** Cells the comparison alignment may compute before it gives up, about a second of work. */
export const REPORT_MAX_CELLS = 3e7;

/** Most points one GC curve holds. */
const GC_POINTS = 300;

export interface CompositionEntry {
  readonly letter: string;
  readonly count: number;
  /** Share of the sequence, 0..1. */
  readonly fraction: number;
}

export interface SequenceSummary {
  readonly name: string;
  readonly description: string;
  readonly accession: string;
  readonly organism: string;
  readonly length: number;
  readonly alphabet: SeqRecord['alphabet'];
  readonly topology: SeqRecord['topology'];
  /** The four bases (or the residues that occur, for a protein) and the share of everything else. */
  readonly composition: readonly CompositionEntry[];
  /** G+C fraction 0..1, or null for a protein. */
  readonly gc: number | null;
}

export interface DifferenceCounts {
  readonly substitutions: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly insertedResidues: number;
  readonly deletedResidues: number;
  /** Purine-purine or pyrimidine-pyrimidine substitutions. Zero for proteins. */
  readonly transitions: number;
  readonly transversions: number;
}

export type AlignmentOutcome =
  | {
      readonly status: 'ok';
      readonly alignment: PairwiseAlignment;
      /** The differences that count: terminal overhangs of an overlap alignment are left out. */
      readonly differences: readonly Difference[];
      readonly counts: DifferenceCounts;
    }
  | { readonly status: 'too-large'; readonly cells: number; readonly limit: number }
  | { readonly status: 'incompatible' };

export interface RestrictionRow {
  readonly enzyme: string;
  readonly site: string;
  /** Top-strand cut positions: the cut falls after this base, counted from 1. */
  readonly cutsA: readonly number[];
  readonly cutsB: readonly number[];
}

export interface GcCurve {
  readonly window: number;
  /** Window centres in bases, counted from 1. */
  readonly x: readonly number[];
  /** G+C fraction 0..1 per window. */
  readonly y: readonly number[];
}

export interface ComparisonData {
  readonly a: SequenceSummary;
  readonly b: SequenceSummary;
  readonly alignment: AlignmentOutcome;
  /** Null when either sequence is not a nucleotide sequence. */
  readonly restriction: readonly RestrictionRow[] | null;
  readonly gc: { readonly a: GcCurve; readonly b: GcCurve } | null;
}

export interface CompareOptions {
  readonly mode?: AlignMode;
  /** Called before each stage with its name, so a caller can show progress. */
  readonly onStage?: (stage: 'summary' | 'alignment' | 'restriction' | 'gc') => void;
}

const NUCLEOTIDE_LETTERS = { dna: 'ACGT', rna: 'ACGU', protein: '' } as const;

/** Name, size, type, topology and composition of one record. */
export function summarize(record: SeqRecord): SequenceSummary {
  const counts = countLetters(record.seq);
  const total = record.seq.length || 1;
  const letters = NUCLEOTIDE_LETTERS[record.alphabet];
  const composition: CompositionEntry[] =
    record.alphabet === 'protein'
      ? Object.entries(counts)
          .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
          .slice(0, 8)
          .map(([letter, count]) => ({ letter, count, fraction: count / total }))
      : [
          ...[...letters].map((letter) => ({
            letter,
            count: counts[letter] ?? 0,
            fraction: (counts[letter] ?? 0) / total,
          })),
          (() => {
            const other = record.seq.length - [...letters].reduce((sum, l) => sum + (counts[l] ?? 0), 0);
            return { letter: '*', count: other, fraction: other / total };
          })(),
        ];
  return {
    name: record.name,
    description: record.description,
    accession: record.metadata.accession ?? '',
    organism: record.metadata.organism ?? '',
    length: record.seq.length,
    alphabet: record.alphabet,
    topology: record.topology,
    composition,
    gc: record.alphabet === 'protein' || record.seq.length === 0 ? null : gcContent(record.seq),
  };
}

const PURINES = new Set(['A', 'G']);

/** Counts the differences by kind, and the substitutions by transition and transversion. */
export function countDifferences(differences: readonly Difference[], nucleotide: boolean): DifferenceCounts {
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;
  let insertedResidues = 0;
  let deletedResidues = 0;
  let transitions = 0;
  for (const difference of differences) {
    if (difference.kind === 'substitution') {
      substitutions++;
      const ref = difference.ref.toUpperCase().replace('U', 'T');
      const alt = difference.alt.toUpperCase().replace('U', 'T');
      if (nucleotide && PURINES.has(ref) === PURINES.has(alt) && 'ACGT'.includes(ref) && 'ACGT'.includes(alt))
        transitions++;
    } else if (difference.kind === 'insertion') {
      insertions++;
      insertedResidues += difference.alt.length;
    } else {
      deletions++;
      deletedResidues += difference.ref.length;
    }
  }
  const transversions = nucleotide ? substitutions - transitions : 0;
  return {
    substitutions,
    insertions,
    deletions,
    insertedResidues,
    deletedResidues,
    transitions,
    transversions,
  };
}

function align(a: SeqRecord, b: SeqRecord, mode: AlignMode): AlignmentOutcome {
  if ((a.alphabet === 'protein') !== (b.alphabet === 'protein')) return { status: 'incompatible' };
  if (a.seq.length === 0 || b.seq.length === 0) return { status: 'incompatible' };
  const result = alignPair(a.seq, b.seq, { mode, maxCells: REPORT_MAX_CELLS });
  if (result.status === 'too-large') return { status: 'too-large', cells: result.cells, limit: result.limit };
  const { alignment } = result;
  const differences =
    mode === 'overlap' ? alignment.differences.filter((d) => !d.terminal) : alignment.differences;
  return {
    status: 'ok',
    alignment,
    differences,
    counts: countDifferences(differences, a.alphabet !== 'protein'),
  };
}

function panelEnzymes(): Enzyme[] {
  const byName = new Map(ENZYME_CATALOG.map((enzyme) => [enzyme.name, enzyme]));
  return RESTRICTION_PANEL.flatMap((name) => byName.get(name) ?? []);
}

function restrictionRows(a: SeqRecord, b: SeqRecord): RestrictionRow[] {
  const enzymes = panelEnzymes();
  const scanA = scanSites(a.seq, a.topology, enzymes);
  const scanB = scanSites(b.seq, b.topology, enzymes);
  return enzymes
    .map((enzyme, i) => ({
      enzyme: enzyme.name,
      site: enzyme.site,
      cutsA: [...((scanA.sites[i]?.topCuts as Int32Array | undefined) ?? [])].sort((x, y) => x - y),
      cutsB: [...((scanB.sites[i]?.topCuts as Int32Array | undefined) ?? [])].sort((x, y) => x - y),
    }))
    .filter((row) => row.cutsA.length + row.cutsB.length > 0);
}

function gcCurve(record: SeqRecord): GcCurve {
  const length = record.seq.length;
  const window = Math.max(1, Math.min(length, Math.max(20, Math.ceil(length / GC_POINTS))));
  const series = nucleotideSeries(record.seq, 'gc', { window, step: window, partial: false });
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < series.values.length; i++) {
    const value = series.values[i] as number;
    if (!Number.isFinite(value)) continue;
    x.push((series.starts[i] as number) + window / 2 + 0.5);
    y.push(value);
  }
  return { window, x, y };
}

/**
 * Compares two records for the report: a summary of each, the alignment with its differences and statistics, the
 * restriction sites of a panel of common enzymes and the GC content along each sequence. Pure data, no DOM, so it
 * runs in a Web Worker. Protein records skip the restriction map and the GC curves.
 */
export function compareSequences(a: SeqRecord, b: SeqRecord, options: CompareOptions = {}): ComparisonData {
  const { mode = 'global', onStage } = options;
  onStage?.('summary');
  const summaryA = summarize(a);
  const summaryB = summarize(b);
  onStage?.('alignment');
  const alignment = align(a, b, mode);
  const nucleotide = a.alphabet !== 'protein' && b.alphabet !== 'protein';
  onStage?.('restriction');
  const restriction = nucleotide ? restrictionRows(a, b) : null;
  onStage?.('gc');
  const gc = nucleotide ? { a: gcCurve(a), b: gcCurve(b) } : null;
  return { a: summaryA, b: summaryB, alignment, restriction, gc };
}
