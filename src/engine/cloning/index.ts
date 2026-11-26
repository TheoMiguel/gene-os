import { designGateway, type GatewayRequest } from './gateway';
import { designGoldenGate, type GoldenGateRequest } from './golden-gate';
import { designHomologyCloning, type HomologyRequest } from './homology';
import { designLic, type LicRequest } from './lic';
import type { CloningResult } from './model';
import { designRestrictionCloning, type RestrictionRequest } from './restriction';
import { designTopo, type TopoRequest } from './topo';

export { assemble } from './assemble';
export { ATT_SITES, designGateway, type GatewayInsert, type GatewayRequest } from './gateway';
export {
  checkOverhangs,
  designGoldenGate,
  designOverhangs,
  GOLDEN_GATE_ENZYMES,
  type GoldenGateRequest,
} from './golden-gate';
export { designHomologyCloning, type HomologyRequest } from './homology';
export { chewBack, type Dntp, designLic, type LicRequest } from './lic';
export * from './model';
export { designRestrictionCloning, type RestrictionRequest } from './restriction';
export { designTopo, type TopoRequest } from './topo';
export type { VectorOpening } from './vector-opening';

/** One request per cloning method; `method` picks the designer. */
export type CloningRequest =
  | RestrictionRequest
  | HomologyRequest
  | GoldenGateRequest
  | GatewayRequest
  | TopoRequest
  | LicRequest;

/**
 * Designs a cloning strategy and simulates its construct: the primers to order, the fragments to prepare, the
 * construct(s) as sequence records with carried features, marked junctions and primer sites, and the warnings.
 * Failures come back as typed problems, never as exceptions.
 */
export function designCloning(request: CloningRequest): CloningResult {
  switch (request.method) {
    case 'restriction':
      return designRestrictionCloning(request);
    case 'gibson':
    case 'in_fusion':
      return designHomologyCloning(request);
    case 'golden_gate':
      return designGoldenGate(request);
    case 'gateway':
      return designGateway(request);
    case 'topo':
      return designTopo(request);
    case 'lic':
      return designLic(request);
  }
}
