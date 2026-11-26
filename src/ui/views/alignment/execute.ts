import {
  alignMultiple,
  alignPair,
  type MsaOptions,
  type MsaResult,
  type PairwiseOptions,
  type PairwiseResult,
} from '../../../engine/align';

/** One alignment to compute: a pair with a mode, or three or more sequences. */
export type AlignJob =
  | { readonly kind: 'pair'; readonly a: string; readonly b: string; readonly options: PairwiseOptions }
  | { readonly kind: 'msa'; readonly seqs: readonly string[]; readonly options: MsaOptions };

export type AlignOutcome =
  | { readonly kind: 'pair'; readonly result: PairwiseResult }
  | { readonly kind: 'msa'; readonly result: MsaResult }
  | { readonly kind: 'error'; readonly message: string };

/** Runs a job. An invalid option that the engine rejects comes back as an `error` outcome, not an exception. */
export function executeAlignment(job: AlignJob): AlignOutcome {
  try {
    return job.kind === 'pair'
      ? { kind: 'pair', result: alignPair(job.a, job.b, job.options) }
      : { kind: 'msa', result: alignMultiple(job.seqs, job.options) };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
