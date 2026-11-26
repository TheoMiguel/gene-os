import { useEffect, useState } from 'preact/hooks';
import type { SearchResult } from '../../../engine/search';
import { type AnalysisBackend, createDefaultBackend } from '../../../workers/client';
import type { SearchJob } from './model';

export type JobsState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | {
      readonly status: 'done';
      /** The jobs these results answer. */
      readonly jobs: readonly SearchJob[];
      readonly results: readonly { readonly job: SearchJob; readonly result: SearchResult }[];
      /** The engine's message for each scan that failed. */
      readonly errors: readonly string[];
    };

const IDLE: JobsState = { status: 'idle' };
const PENDING: JobsState = { status: 'pending' };

let backend: AnalysisBackend | null = null;

/**
 * Runs the scans that the shared analysis cache does not hold (a selection, a translation) off the main thread.
 * A new list of jobs cancels the scans still running, so a slow expression never blocks the next query.
 */
export function useSearchJobs(jobs: readonly SearchJob[]): JobsState {
  const [state, setState] = useState<JobsState>(IDLE);

  useEffect(() => {
    if (jobs.length === 0) {
      setState(IDLE);
      return;
    }
    setState(PENDING);
    backend ??= createDefaultBackend();
    const worker = backend;
    const results: { job: SearchJob; result: SearchResult }[] = [];
    const errors: string[] = [];
    let waiting = jobs.length;
    const cancels = jobs.map((job) =>
      worker.start({ kind: 'search', input: job.input, params: job.params }, (outcome) => {
        if (outcome.ok) results.push({ job, result: outcome.value as SearchResult });
        else errors.push(outcome.reason);
        waiting--;
        if (waiting === 0) setState({ status: 'done', jobs, results, errors });
      }),
    );
    return () => {
      for (const cancel of cancels) cancel();
    };
  }, [jobs]);

  if (jobs.length === 0) return IDLE;
  return state.status === 'done' && state.jobs !== jobs ? PENDING : state;
}
