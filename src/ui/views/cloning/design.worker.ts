import type { CloningRequest } from '../../../engine/cloning';
import { executeDesign } from './execute';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<CloningRequest>) => {
  scope.postMessage(executeDesign(event.data));
};
