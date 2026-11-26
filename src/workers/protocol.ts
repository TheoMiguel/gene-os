import type {
  CodonUsageOptions,
  CodonUsageRow,
  NucleotideSeriesKind,
  WindowOptions,
  WindowSeries,
} from '../engine/composition';
import type { DetectedFeature } from '../engine/features';
import type { Orf, OrfOptions } from '../engine/orf';
import type { OrganismInference } from '../engine/organism';
import type { RestrictionScan } from '../engine/restriction';
import type { SearchOptions, SearchResult } from '../engine/search';
import type { SequenceSummary } from '../engine/summary';
import type { Frame } from '../engine/translate';
import type { Alphabet, Topology } from '../engine/types';

/** The part of a record every analysis needs. Plain data, so it crosses a worker boundary unchanged. */
export interface AnalysisInput {
  readonly seq: string;
  readonly topology: Topology;
  readonly alphabet: Alphabet;
}

/**
 * Every whole-sequence scan the workers run: its parameters and its result. Unset `circular` follows the
 * record's topology; unset `alphabet` follows the record's alphabet.
 */
export interface AnalysisDefinitions {
  /** ORF scan (`findOrfs`). */
  orfs: { params: OrfOptions; result: Orf[] };
  /** Restriction sites of the named enzymes, or of the whole catalog when `enzymes` is absent (`scanSites`). */
  restriction: { params: { readonly enzymes?: readonly string[] }; result: RestrictionScan };
  /** Known-element detection (`detectFeatures`) on the bundled catalog. */
  features: { params: { readonly proteins?: boolean }; result: DetectedFeature[] };
  /** One sliding-window chart series of a nucleotide sequence (`nucleotideSeries`). */
  nucleotideSeries: { params: { readonly kind: NucleotideSeriesKind } & WindowOptions; result: WindowSeries };
  /** Running sum of GC skew over consecutive windows (`cumulativeGcSkew`). */
  cumulativeGcSkew: { params: { readonly window: number }; result: WindowSeries };
  /**
   * Kyte-Doolittle profile (`hydropathyProfile`). A protein record is used as it is; a nucleotide record is
   * translated in `frame` (default +1) first.
   */
  hydropathy: { params: { readonly window?: number; readonly frame?: Frame }; result: WindowSeries };
  /** Codon counts and RSCU of one reading frame (`codonUsage`). */
  codonUsage: {
    params: CodonUsageOptions;
    result: { rows: CodonUsageRow[]; total: number };
  };
  /** Substring, motif or regex search (`searchSequence`). */
  search: { params: { readonly query: string } & SearchOptions; result: SearchResult };
  /** Counts, GC, skew, weight and protein properties of the whole sequence (`summarizeSequence`). */
  summary: { params: Record<string, never>; result: SequenceSummary };
  /** Likely kind of source of the sequence, from its composition (`inferOrganism`). */
  organism: { params: Record<string, never>; result: OrganismInference };
}

export type AnalysisKind = keyof AnalysisDefinitions;
export type ParamsOf<K extends AnalysisKind> = AnalysisDefinitions[K]['params'];
export type ResultOf<K extends AnalysisKind> = AnalysisDefinitions[K]['result'];

/** Main thread to worker. */
export interface AnalysisRequestMessage {
  readonly id: number;
  readonly kind: AnalysisKind;
  readonly input: AnalysisInput;
  readonly params: unknown;
}

/** Worker to main thread. */
export type AnalysisResponseMessage =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly reason: string };

const MAX_WALK_DEPTH = 4;

/** Every ArrayBuffer inside a result (typed-array columns), so the worker moves them instead of copying. */
export function transferablesOf(value: unknown): ArrayBuffer[] {
  const found = new Set<ArrayBuffer>();
  const walk = (node: unknown, depth: number) => {
    if (typeof node !== 'object' || node === null) return;
    if (ArrayBuffer.isView(node)) {
      if (node.buffer instanceof ArrayBuffer) found.add(node.buffer);
      return;
    }
    if (depth >= MAX_WALK_DEPTH) return;
    for (const child of Array.isArray(node) ? node : Object.values(node)) walk(child, depth + 1);
  };
  walk(value, 0);
  return [...found];
}

/** JSON with sorted keys: the same parameters give the same key whatever order the caller wrote them in. */
export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_key, node: unknown) =>
    node && typeof node === 'object' && !Array.isArray(node)
      ? Object.fromEntries(Object.entries(node).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : node,
  );
}
