import { buildReport, type ReportRequest, type ReportWorkerMessage } from './generate';

const post = (message: ReportWorkerMessage, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (event: MessageEvent<ReportRequest>) => {
  try {
    const bytes = buildReport(event.data, (stage) => post({ type: 'stage', stage }));
    post({ type: 'done', bytes }, [bytes.buffer]);
  } catch (error) {
    post({ type: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
};
