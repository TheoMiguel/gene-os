import { type AlignJob, type AlignOutcome, executeAlignment } from './execute';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** The typed-array columns of a result, so the worker moves them to the page instead of copying them. */
function transferablesOf(outcome: AlignOutcome): ArrayBuffer[] {
  if (outcome.kind === 'error' || outcome.result.status !== 'ok') return [];
  const alignment = outcome.result.alignment;
  const buffers: ArrayBufferLike[] = [alignment.classes.buffer];
  if ('conservation' in alignment) buffers.push(alignment.conservation.buffer);
  return buffers.filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
}

scope.onmessage = (event: MessageEvent<AlignJob>) => {
  const outcome = executeAlignment(event.data);
  scope.postMessage(outcome, transferablesOf(outcome));
};
