import type { CloningRequest } from '../../../engine/cloning';
import { startWorkerJob } from '../alignment/workerJob';
import { type DesignOutcome, executeDesign } from './execute';

/** Starts a design off the main thread and returns a function that cancels it. A 5 Mb vector must not freeze the tab. */
export function startDesign(request: CloningRequest, done: (outcome: DesignOutcome) => void): () => void {
  return startWorkerJob(
    {
      spawn: () => new Worker(new URL('./design.worker.ts', import.meta.url), { type: 'module' }),
      runInline: executeDesign,
      crashed: (message) => ({ kind: 'failed' as const, message }),
    },
    request,
    done,
  );
}
