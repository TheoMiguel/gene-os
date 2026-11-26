/** How one kind of job runs: in a Web Worker when the browser has them, else inline on the next tick. */
export interface WorkerJobKind<Job, Outcome> {
  /** Creates the worker. The `new Worker(new URL(...))` call must sit in the module that owns the worker file. */
  readonly spawn: () => Worker;
  /** Runs the job on the calling thread. Used without Web Workers, such as in a test DOM. */
  readonly runInline: (job: Job) => Outcome;
  /** The outcome for a worker that crashed. */
  readonly crashed: (message: string) => Outcome;
}

/**
 * Starts a job off the main thread and returns a function that cancels it. A cancelled job never calls `done`,
 * and its worker is terminated, so a long computation stops at once.
 */
export function startWorkerJob<Job, Outcome>(
  kind: WorkerJobKind<Job, Outcome>,
  job: Job,
  done: (outcome: Outcome) => void,
): () => void {
  if (typeof Worker === 'undefined') {
    const timer = setTimeout(() => done(kind.runInline(job)), 0);
    return () => clearTimeout(timer);
  }
  const worker = kind.spawn();
  let open = true;
  const finish = (outcome: Outcome) => {
    if (!open) return;
    open = false;
    worker.terminate();
    done(outcome);
  };
  worker.onmessage = (event: MessageEvent<Outcome>) => finish(event.data);
  worker.onerror = (event) => finish(kind.crashed(event.message || 'The worker failed.'));
  worker.postMessage(job);
  return () => {
    open = false;
    worker.terminate();
  };
}
