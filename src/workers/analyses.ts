import { codonUsage, cumulativeGcSkew, nucleotideSeries } from '../engine/composition';
import { detectFeatures } from '../engine/features';
import { findOrfs } from '../engine/orf';
import { inferOrganism } from '../engine/organism';
import { hydropathyProfile } from '../engine/protein';
import { ENZYME_CATALOG, scanSites } from '../engine/restriction';
import { searchSequence } from '../engine/search';
import { summarizeSequence } from '../engine/summary';
import { translateFrame } from '../engine/translate';
import type { AnalysisInput, AnalysisKind, ParamsOf, ResultOf } from './protocol';

type Runner<K extends AnalysisKind> = (input: AnalysisInput, params: ParamsOf<K>) => ResultOf<K>;

const circular = (input: AnalysisInput) => input.topology === 'circular';

const RUNNERS: { readonly [K in AnalysisKind]: Runner<K> } = {
  orfs: (input, params) => findOrfs(input.seq, { circular: circular(input), ...params }),

  restriction: (input, params) => {
    const names = params.enzymes ? new Set(params.enzymes) : null;
    const enzymes = names ? ENZYME_CATALOG.filter((enzyme) => names.has(enzyme.name)) : ENZYME_CATALOG;
    return scanSites(input.seq, input.topology, enzymes);
  },

  features: (input, params) => detectFeatures(input.seq, { topology: input.topology, ...params }),

  nucleotideSeries: (input, { kind, ...options }) =>
    nucleotideSeries(input.seq, kind, { circular: circular(input), ...options }),

  cumulativeGcSkew: (input, { window }) => cumulativeGcSkew(input.seq, window),

  hydropathy: (input, { window, frame = 1 }) =>
    hydropathyProfile(input.alphabet === 'protein' ? input.seq : translateFrame(input.seq, frame), window),

  codonUsage: (input, params) => codonUsage(input.seq, params),

  search: (input, { query, ...options }) =>
    searchSequence(input.seq, query, { alphabet: input.alphabet, circular: circular(input), ...options }),

  summary: (input) => summarizeSequence(input.seq, input.alphabet, input.topology),

  organism: (input) => inferOrganism(input.seq, { alphabet: input.alphabet, topology: input.topology }),
};

/** Runs one analysis on the calling thread. The worker calls this; tests and the inline backend call it too. */
export function runAnalysis<K extends AnalysisKind>(
  kind: K,
  input: AnalysisInput,
  params: ParamsOf<K>,
): ResultOf<K> {
  return (RUNNERS[kind] as Runner<K>)(input, params);
}
