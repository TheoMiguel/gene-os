import { countLetters, proteinWeight } from '../../../engine/composition';
import {
  aromaticity,
  extinctionCoefficient,
  gravy,
  instabilityIndex,
  isoelectricPoint,
  netCharge,
  standardResidues,
} from '../../../engine/protein';

/** Above this instability index a protein is predicted to be unstable (Guruprasad et al. 1990). */
export const UNSTABLE_ABOVE = 40;

/** The properties of spec 4.8 for one chain. */
export interface ProteinProperties {
  /** Standard residues counted. A stop `*` or an `X` is not one. */
  readonly residues: number;
  /** Molecular weight in daltons. */
  readonly weight: number;
  readonly pI: number;
  /** Net charge at pH 7.4. */
  readonly charge: number;
  /** Molar extinction coefficient at 280 nm, cysteines reduced and as cystines. */
  readonly extinction: { readonly reduced: number; readonly cystine: number };
  readonly instability: number;
  readonly gravy: number;
  readonly aromaticity: number;
  /** Count of each letter in the chain. */
  readonly composition: Readonly<Record<string, number>>;
}

/** Computes every property of `protein` with the protein engine. */
export function proteinProperties(protein: string): ProteinProperties {
  return {
    residues: standardResidues(protein).length,
    weight: proteinWeight(protein),
    pI: isoelectricPoint(protein),
    charge: netCharge(protein),
    extinction: extinctionCoefficient(protein),
    instability: instabilityIndex(protein),
    gravy: gravy(protein),
    aromaticity: aromaticity(protein),
    composition: countLetters(protein),
  };
}
