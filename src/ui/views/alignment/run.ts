import { type AlignJob, type AlignOutcome, executeAlignment } from './execute';

/**
 * Starts an alignment off the main thread and returns a function that cancels it. A cancelled job never calls
 * `done`. Without Web Workers (a test DOM) the job runs on the next tick.
 */
export function startAlignment(job: AlignJob, done: (outcome: AlignOutcome) => void): () => void {
  if (typeof Worker === 'undefined') {
    const timer = setTimeout(() => done(executeAlignment(job)), 0);
    return () => clearTimeout(timer);
  }
  const worker = new Worker(new URL('./align.worker.ts', import.meta.url), { type: 'module' });
  let open = true;
  const finish = (outcome: AlignOutcome) => {
    if (!open) return;
    open = false;
    worker.terminate();
    done(outcome);
  };
  worker.onmessage = (event: MessageEvent<AlignOutcome>) => finish(event.data);
  worker.onerror = (event) => finish({ kind: 'error', message: event.message || 'The worker failed.' });
  worker.postMessage(job);
  return () => {
    open = false;
    worker.terminate();
  };
}
