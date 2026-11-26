import type { AlignMode } from '../engine/align';
import type { SeqRecord } from '../engine/types';
import { compareSequences } from './compare';
import { buildReportPdf } from './document';
import { type ReportLabels, reportText } from './labels';

/** Everything the report needs. Plain data, so it crosses into a Web Worker. */
export interface ReportRequest {
  readonly a: SeqRecord;
  readonly b: SeqRecord;
  readonly mode: AlignMode;
  readonly projectName: string;
  /** ISO 8601 date and time. */
  readonly generated: string;
  /** BCP 47 tag for number grouping. */
  readonly locale: string;
  readonly labels: ReportLabels;
}

export type ReportStage = 'summary' | 'alignment' | 'restriction' | 'gc' | 'pdf';

/** Builds the report on the calling thread. The worker and the inline path both run this. */
export function buildReport(request: ReportRequest, onStage?: (stage: ReportStage) => void): Uint8Array {
  const data = compareSequences(request.a, request.b, {
    mode: request.mode,
    ...(onStage ? { onStage } : {}),
  });
  onStage?.('pdf');
  return buildReportPdf(
    data,
    {
      projectName: request.projectName,
      generated: request.generated,
      locale: request.locale,
      mode: request.mode,
    },
    reportText(request.labels),
  );
}

/** Messages from the report worker. */
export type ReportWorkerMessage =
  | { readonly type: 'stage'; readonly stage: ReportStage }
  | { readonly type: 'done'; readonly bytes: Uint8Array }
  | { readonly type: 'failed'; readonly reason: string };

export interface ReportJob {
  readonly result: Promise<Uint8Array>;
  /** Stops the work. `result` rejects with an `AbortError`. */
  cancel(): void;
}

const abortError = () => new DOMException('The report was cancelled.', 'AbortError');

/**
 * Starts a report in a Web Worker, so a long alignment never freezes the page, and reports each stage. Without
 * workers (tests, old browsers) it runs on the calling thread after one turn of the event loop.
 */
export function startReport(
  request: ReportRequest,
  onStage: (stage: ReportStage) => void = () => {},
): ReportJob {
  if (typeof Worker === 'undefined') {
    let cancelled = false;
    const result = new Promise<Uint8Array>((resolve, reject) => {
      setTimeout(() => {
        if (cancelled) return reject(abortError());
        try {
          resolve(buildReport(request, onStage));
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
    return {
      result,
      cancel() {
        cancelled = true;
      },
    };
  }

  const worker = new Worker(new URL('./report.worker.ts', import.meta.url), { type: 'module' });
  let fail: (reason: unknown) => void = () => {};
  const result = new Promise<Uint8Array>((resolve, reject) => {
    fail = reject;
    worker.onmessage = (event: MessageEvent<ReportWorkerMessage>) => {
      const message = event.data;
      if (message.type === 'stage') onStage(message.stage);
      else if (message.type === 'done') resolve(message.bytes);
      else reject(new Error(message.reason));
    };
    worker.onerror = (event) => reject(new Error(event.message || 'the report worker failed'));
    worker.postMessage(request);
  }).finally(() => worker.terminate());
  return {
    result,
    cancel() {
      fail(abortError());
      worker.terminate();
    },
  };
}
