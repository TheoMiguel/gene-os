import type { SeqRecord } from '../../../engine/types';

/** A protein record for exporting a translation as FASTA. */
export function proteinRecord(name: string, description: string, seq: string): SeqRecord {
  return {
    id: name,
    name,
    description,
    alphabet: 'protein',
    topology: 'linear',
    seq,
    features: [],
    metadata: {},
  };
}
