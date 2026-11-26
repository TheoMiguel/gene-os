import { countLetters, gcContent, gcSkew, nucleotideWeight, proteinWeight } from './composition';
import {
  aromaticity,
  type ExtinctionCoefficient,
  extinctionCoefficient,
  gravy,
  instabilityIndex,
  isoelectricPoint,
  netCharge,
} from './protein';
import type { Alphabet, Topology } from './types';

/** The bulk properties of a protein, each computed by the function of `protein.ts` of the same name. */
export interface ProteinProperties {
  /** Molecular weight in g/mol. */
  readonly weight: number;
  readonly isoelectricPoint: number;
  /** Net charge at pH 7.4. */
  readonly charge: number;
  readonly extinction: ExtinctionCoefficient;
  readonly instabilityIndex: number;
  readonly gravy: number;
  /** Fraction of Phe, Trp and Tyr, 0..1. */
  readonly aromaticity: number;
}

/** Everything the Summary view's cards and tables show about one whole sequence. */
export interface SequenceSummary {
  readonly length: number;
  /** Count of each letter, upper case. */
  readonly counts: Readonly<Record<string, number>>;
  /** GC fraction, 0..1. Nucleotide sequences only. */
  readonly gc?: number;
  /** `(G - C) / (G + C)` over the whole sequence. Nucleotide sequences only. */
  readonly gcSkew?: number;
  /** g/mol: one strand of a nucleotide sequence (with the circular water correction), or the protein. */
  readonly weight: number;
  /** g/mol of the molecule with its complementary strand. Nucleotide sequences only. */
  readonly weightDoubleStranded?: number;
  /** Protein sequences only. */
  readonly protein?: ProteinProperties;
}

/** Properties of one protein sequence. */
export function proteinProperties(protein: string): ProteinProperties {
  return {
    weight: proteinWeight(protein),
    isoelectricPoint: isoelectricPoint(protein),
    charge: netCharge(protein),
    extinction: extinctionCoefficient(protein),
    instabilityIndex: instabilityIndex(protein),
    gravy: gravy(protein),
    aromaticity: aromaticity(protein),
  };
}

/** Counts, composition fractions, weight and (for a protein) bulk properties of a whole sequence, in one pass of work. */
export function summarizeSequence(seq: string, alphabet: Alphabet, topology: Topology): SequenceSummary {
  const counts = countLetters(seq);
  if (alphabet === 'protein') {
    const protein = proteinProperties(seq);
    return { length: seq.length, counts, weight: protein.weight, protein };
  }
  const circular = topology === 'circular';
  return {
    length: seq.length,
    counts,
    gc: gcContent(seq),
    gcSkew: gcSkew(seq),
    weight: nucleotideWeight(seq, { alphabet, circular }),
    weightDoubleStranded: nucleotideWeight(seq, { alphabet, circular, doubleStranded: true }),
  };
}
