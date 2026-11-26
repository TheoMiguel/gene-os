import { type AlignJob, type AlignOutcome, executeAlignment } from './execute';
import { startWorkerJob } from './workerJob';

/** Starts an alignment off the main thread and returns a function that cancels it. */
export function startAlignment(job: AlignJob, done: (outcome: AlignOutcome) => void): () => void {
  return startWorkerJob(
    {
      spawn: () => new Worker(new URL('./align.worker.ts', import.meta.url), { type: 'module' }),
      runInline: executeAlignment,
      crashed: (message) => ({ kind: 'error' as const, message }),
    },
    job,
    done,
  );
}
