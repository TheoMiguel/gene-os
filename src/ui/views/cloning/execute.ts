import { type CloningRequest, type CloningResult, designCloning } from '../../../engine/cloning';

export type DesignOutcome =
  | { readonly kind: 'designed'; readonly result: CloningResult }
  | { readonly kind: 'failed'; readonly message: string };

/** Runs the designer. The engine reports problems as data; an unexpected exception becomes a `failed` outcome. */
export function executeDesign(request: CloningRequest): DesignOutcome {
  try {
    return { kind: 'designed', result: designCloning(request) };
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
