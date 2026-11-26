/** The remote databases GENE_OS can query (spec 6.1). They are the only network use of the app. */
export const SERVICES = ['ncbi', 'ena', 'uniprot'] as const;
export type ServiceId = (typeof SERVICES)[number];

/** Names as the services call themselves; they are proper names, so no translation applies. */
export const SERVICE_NAMES: Readonly<Record<ServiceId, string>> = {
  ncbi: 'NCBI',
  ena: 'ENA',
  uniprot: 'UniProt',
};

/**
 * Why a request failed. `unreachable` covers a refused connection, a DNS failure and a cross-origin refusal:
 * the browser reports all three the same way, so GENE_OS cannot tell them apart.
 */
export type NetFailureKind =
  | 'offline'
  | 'timeout'
  | 'rateLimited'
  | 'unreachable'
  | 'notFound'
  | 'invalidIdentifier'
  | 'serverError'
  | 'badResponse'
  | 'cancelled';

/** A failed request. Always names the service, so the user never reads a failure as an empty result. */
export class NetError extends Error {
  constructor(
    readonly service: ServiceId,
    readonly kind: NetFailureKind,
    readonly status?: number,
  ) {
    super(`${SERVICE_NAMES[service]}: ${kind}${status === undefined ? '' : ` (HTTP ${status})`}`);
    this.name = 'NetError';
  }
}

/** One row of a keyword search. */
export interface DatabaseHit {
  readonly service: ServiceId;
  /** What the user pastes to fetch the record: an accession with version, or a UniProt accession. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly organism: string;
  /** Bases or residues, or null when the service does not say. */
  readonly length: number | null;
}

/** A record fetched by identifier, as the service wrote it. */
export interface FetchedRecord {
  readonly text: string;
  readonly fileName: string;
}

/** What a service call needs from its caller. */
export interface RequestContext {
  readonly signal?: AbortSignal;
}

/** Most rows one keyword search returns. */
export const SEARCH_LIMIT = 25;
