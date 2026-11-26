import { runAnalysis } from './analyses';
import type {
  AnalysisInput,
  AnalysisKind,
  AnalysisRequestMessage,
  AnalysisResponseMessage,
} from './protocol';

/** One scan to run. */
export interface AnalysisJob {
  readonly kind: AnalysisKind;
  readonly input: AnalysisInput;
  readonly params: unknown;
}

export type AnalysisOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/** Where scans run. `start` returns a function that cancels the job; `done` is not called after a cancel. */
export interface AnalysisBackend {
  start(job: AnalysisJob, done: (outcome: AnalysisOutcome) => void): () => void;
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Runs each scan at once on the calling thread. Tests and browsers without workers use it. */
export function createInlineBackend(): AnalysisBackend {
  return {
    start(job, done) {
      try {
        done({ ok: true, value: runAnalysis(job.kind, job.input, job.params as never) });
      } catch (error) {
        done({ ok: false, reason: reasonOf(error) });
      }
      return () => {};
    },
  };
}

const spawnAnalysisWorker = () =>
  new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });

/**
 * Runs scans one after another in a dedicated Web Worker, started on the first job. A running scan cannot be
 * interrupted, so cancelling a job restarts the worker and sends the jobs that remain again.
 */
export function createWorkerBackend(spawn: () => Worker = spawnAnalysisWorker): AnalysisBackend {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { job: AnalysisJob; done: (outcome: AnalysisOutcome) => void }>();

  const send = (id: number, job: AnalysisJob) => {
    worker ??= open();
    const message: AnalysisRequestMessage = { id, ...job };
    worker.postMessage(message);
  };

  const stop = () => {
    worker?.terminate();
    worker = null;
  };

  const failAll = (reason: string) => {
    stop();
    const jobs = [...pending.values()];
    pending.clear();
    for (const { done } of jobs) done({ ok: false, reason });
  };

  const open = () => {
    const created = spawn();
    created.onmessage = (event: MessageEvent<AnalysisResponseMessage>) => {
      const response = event.data;
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      entry.done(response.ok ? { ok: true, value: response.value } : { ok: false, reason: response.reason });
    };
    created.onerror = (event) => failAll(event.message || 'worker failed');
    return created;
  };

  return {
    start(job, done) {
      const id = nextId++;
      pending.set(id, { job, done });
      send(id, job);
      return () => {
        if (!pending.delete(id)) return;
        stop();
        for (const [otherId, entry] of pending) send(otherId, entry.job);
      };
    },
  };
}

/** A worker when the environment has one, else the inline backend. */
export function createDefaultBackend(): AnalysisBackend {
  return typeof Worker === 'undefined' ? createInlineBackend() : createWorkerBackend();
}
