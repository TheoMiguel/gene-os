import { detectAlphabet } from './alphabet';
import { countLetters, gcContent } from './composition';
import { detectFeatures } from './features';
import { extractLocation, locationLength } from './location';
import { findOrfs } from './orf';
import type { Alphabet, Feature, Topology } from './types';

/**
 * Organism categories the Summary shows. A heuristic from composition, not a classifier:
 *
 * 1. Protein alphabet: `protein`.
 * 2. Vector parts. Detected catalog parts of at least 20 bases (or a tag) count by distinct part. A replication origin
 *    plus a resistance marker, or three distinct parts, in at most 50 kb: `synthetic-vector`.
 * 3. Coding density: the share of bases inside ORFs of 100 codons or more on either strand (bacterial code, ATG).
 *    A dense sequence (0.75 or more) is a compact genome; a sparse one is a eukaryote.
 *    - Dense and at least 300 kb: a bacterium, high-GC from 50% GC upward, low-GC below.
 *    - Dense and 2.5 kb to 300 kb: `phage-virus`.
 *    - Sparse and at least 3 kb: `eukaryote`; CpG depletion (observed/expected below 0.65) adds confidence.
 * 4. Everything else, such as a lone gene or a short fragment: `unknown`.
 *
 * Known limits: a gene-dense eukaryotic genome or a GC-rich eukaryotic region can read as a bacterium, and a long
 * bacterial fragment under 300 kb reads as a phage. The evidence list says what the call rests on.
 */
export type OrganismCategory =
  | 'synthetic-vector'
  | 'high-gc-bacterium'
  | 'low-gc-bacterium'
  | 'eukaryote'
  | 'phage-virus'
  | 'protein'
  | 'unknown';

export interface OrganismMetrics {
  readonly length: number;
  /** GC fraction, 0..1; absent for a protein. */
  readonly gc?: number;
  /** GC fraction at third codon positions of the ORFs found; absent when there are none. */
  readonly gc3?: number;
  /** Share of bases inside ORFs of 100 codons or more on either strand. */
  readonly codingDensity?: number;
  /** CpG observed over expected, `CG * n / (C * G)`. */
  readonly cpgRatio?: number;
  /** Names of the distinct vector parts counted as evidence. */
  readonly vectorParts: readonly string[];
}

export interface OrganismInference {
  readonly category: OrganismCategory;
  /** 0..1. A rule-of-thumb weight, higher when more cues agree. */
  readonly confidence: number;
  /** One line per cue the call rests on, in plain words. */
  readonly evidence: readonly string[];
  readonly metrics: OrganismMetrics;
}

export interface OrganismOptions {
  readonly alphabet?: Alphabet;
  readonly topology?: Topology;
  /** Detected features of the sequence. Default: detected here, for sequences up to 50 kb. */
  readonly features?: readonly Feature[];
}

const VECTOR_MAX_LENGTH = 50_000;
const BACTERIUM_MIN_LENGTH = 300_000;
const VIRUS_MIN_LENGTH = 2_500;
const EUKARYOTE_MIN_LENGTH = 3_000;
const DENSE = 0.75;
const MIN_ORF_CODONS = 100;
const GC3_SAMPLE_ORFS = 500;
const VECTOR_TYPES = new Set([
  'rep_origin',
  'resistance',
  'promoter',
  'terminator',
  'polyA_signal',
  'tag',
  'enhancer',
]);

const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function vectorParts(features: readonly Feature[]): { names: string[]; types: Set<string> } {
  const names = new Set<string>();
  const types = new Set<string>();
  for (const feature of features) {
    if (!VECTOR_TYPES.has(feature.type)) continue;
    if (feature.type !== 'tag' && locationLength(feature.location) < 20) continue;
    names.add(feature.name);
    types.add(feature.type);
  }
  return { names: [...names], types };
}

function orfStatistics(seq: string, circular: boolean) {
  const orfs = findOrfs(seq, { minCodons: MIN_ORF_CODONS, table: 11, circular });
  const covered = new Uint8Array(seq.length);
  for (const orf of orfs) {
    for (const segment of orf.location.segments) covered.fill(1, segment.start, segment.end);
  }
  let bases = 0;
  for (const flag of covered) bases += flag;
  let gc3 = 0;
  let codons = 0;
  const longest = [...orfs].sort((a, b) => b.lengthAa - a.lengthAa).slice(0, GC3_SAMPLE_ORFS);
  for (const orf of longest) {
    const coding = extractLocation(seq, orf.location);
    for (let i = 2; i < coding.length; i += 3) {
      const base = coding[i];
      if (base === 'G' || base === 'C') gc3++;
      codons++;
    }
  }
  return {
    density: seq.length === 0 ? 0 : bases / seq.length,
    gc3: codons === 0 ? undefined : gc3 / codons,
  };
}

function cpgRatio(seq: string): number | undefined {
  const counts = countLetters(seq);
  const c = counts.C ?? 0;
  const g = counts.G ?? 0;
  if (c === 0 || g === 0) return undefined;
  let cg = 0;
  for (let i = seq.indexOf('CG'); i >= 0; i = seq.indexOf('CG', i + 1)) cg++;
  return (cg * seq.length) / (c * g);
}

/**
 * Infers the likely kind of source of a sequence from its composition, length, ORF structure and detected vector
 * parts. See `OrganismCategory` for the rules.
 */
export function inferOrganism(seq: string, options: OrganismOptions = {}): OrganismInference {
  const alphabet = options.alphabet ?? detectAlphabet(seq);
  const length = seq.length;
  if (alphabet === 'protein') {
    return {
      category: 'protein',
      confidence: length >= 20 ? 0.95 : 0.7,
      evidence: [`${length} residues with amino acid letters`],
      metrics: { length, vectorParts: [] },
    };
  }

  const text = seq.toUpperCase();
  const circular = options.topology === 'circular';
  const gc = gcContent(text);
  const evidence: string[] = [`length ${length.toLocaleString('en-US')} bases`, `GC content ${percent(gc)}`];
  const features: readonly Feature[] =
    options.features ??
    (length <= VECTOR_MAX_LENGTH ? detectFeatures(text, { topology: circular ? 'circular' : 'linear' }) : []);
  const parts = vectorParts(features);
  const base = { length, gc, vectorParts: parts.names };

  const hasOriginAndMarker = parts.types.has('rep_origin') && parts.types.has('resistance');
  if (length <= VECTOR_MAX_LENGTH && (hasOriginAndMarker || parts.names.length >= 3)) {
    evidence.push(`vector parts found: ${parts.names.join(', ')}`);
    const confidence = hasOriginAndMarker ? clamp(0.85 + 0.02 * parts.names.length, 0, 0.98) : 0.7;
    return { category: 'synthetic-vector', confidence, evidence, metrics: base };
  }
  if (parts.names.length > 0)
    evidence.push(`vector parts found, too few to call a vector: ${parts.names.join(', ')}`);

  if (length < VIRUS_MIN_LENGTH) {
    evidence.push('too short to place by composition');
    return { category: 'unknown', confidence: 0.2, evidence, metrics: base };
  }

  const { density, gc3 } = orfStatistics(text, circular);
  const cpg = cpgRatio(text);
  evidence.push(`${percent(density)} of the bases lie in ORFs of ${MIN_ORF_CODONS} codons or more`);
  if (gc3 !== undefined) evidence.push(`GC at third codon positions ${percent(gc3)}`);
  if (cpg !== undefined) evidence.push(`CpG observed/expected ${cpg.toFixed(2)}`);
  const metrics: OrganismMetrics = {
    ...base,
    codingDensity: density,
    ...(gc3 === undefined ? {} : { gc3 }),
    ...(cpg === undefined ? {} : { cpgRatio: cpg }),
  };

  if (density >= DENSE) {
    if (length >= BACTERIUM_MIN_LENGTH) {
      const high = gc >= 0.5;
      const distance = Math.abs(gc - 0.5);
      if (distance < 0.05)
        evidence.push('GC content is close to the 50% line between the two bacterial classes');
      const confidence = clamp(0.55 + distance * 2.5 + (density - DENSE) * 0.4, 0.5, 0.95);
      return { category: high ? 'high-gc-bacterium' : 'low-gc-bacterium', confidence, evidence, metrics };
    }
    evidence.push('gene-dense and under 300 kb, the size of a phage or small virus genome');
    return { category: 'phage-virus', confidence: circular ? 0.65 : 0.6, evidence, metrics };
  }
  if (length >= EUKARYOTE_MIN_LENGTH) {
    const depleted = cpg !== undefined && cpg < 0.65;
    if (depleted) evidence.push('CpG is depleted, as in many eukaryotic genomes');
    const confidence = clamp(0.45 + ((DENSE - density) / DENSE) * 0.3 + (depleted ? 0.15 : 0), 0.4, 0.9);
    return { category: 'eukaryote', confidence, evidence, metrics };
  }
  evidence.push('short and sparse in long ORFs');
  return { category: 'unknown', confidence: 0.25, evidence, metrics };
}
