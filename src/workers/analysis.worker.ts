import { runAnalysis } from './analyses';
import {
  type AnalysisKind,
  type AnalysisRequestMessage,
  type AnalysisResponseMessage,
  transferablesOf,
} from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<AnalysisRequestMessage>) => {
  const { id, kind, input, params } = event.data;
  try {
    const value = runAnalysis(kind as AnalysisKind, input, params as never);
    const message: AnalysisResponseMessage = { id, ok: true, value };
    scope.postMessage(message, transferablesOf(value));
  } catch (error) {
    const message: AnalysisResponseMessage = {
      id,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(message);
  }
};
