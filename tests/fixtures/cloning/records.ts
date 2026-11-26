import { detectFeatures, FEATURE_CATALOG } from '../../../src/engine/features';
import type { Feature, SeqRecord, Topology } from '../../../src/engine/types';
import { PUC19, randomDna } from '../restriction/fixtures';

/** Builds a DNA record. */
export function makeRecord(
  id: string,
  seq: string,
  topology: Topology,
  features: readonly Feature[] = [],
): SeqRecord {
  return {
    id,
    name: id,
    description: id,
    alphabet: 'dna',
    topology,
    seq,
    features,
    metadata: {},
  };
}

/** pUC19 (GenBank L09137) with the engine's detected features (lacZ alpha, AmpR, ori, ...). */
export const PUC19_RECORD: SeqRecord = makeRecord(
  'pUC19',
  PUC19,
  'circular',
  detectFeatures(PUC19, { topology: 'circular' }),
);

/** The EGFP coding sequence from the feature catalog (720 bp). */
export const EGFP: string = FEATURE_CATALOG.find((s) => s.name === 'EGFP')?.seq.toUpperCase() ?? '';

/** A linear template: random flanks around `core`, with the core annotated as a CDS called `name`. */
export function templateWith(id: string, core: string, name: string, seed: number): SeqRecord {
  const left = randomDna(120, seed);
  const right = randomDna(120, seed + 1);
  const seq = left + core + right;
  const feature: Feature = {
    id: `${id}-cds`,
    type: 'CDS',
    name,
    location: { segments: [{ start: left.length, end: left.length + core.length }], strand: 1 },
    origin: 'user',
  };
  return makeRecord(id, seq, 'linear', [feature]);
}

export { PUC19, randomDna };
