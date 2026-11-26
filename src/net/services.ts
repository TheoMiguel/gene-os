import { getText, parseJson } from './http';
import { isSafeIdentifier, ncbiDatabaseOf } from './identifiers';
import {
  type DatabaseHit,
  type FetchedRecord,
  NetError,
  type RequestContext,
  SEARCH_LIMIT,
  type ServiceId,
} from './types';

/** The application name the services see. It is generic on purpose: no user, machine or document detail. */
export const CLIENT_NAME = 'gene-os';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const ENA_BROWSER = 'https://www.ebi.ac.uk/ena/browser/api/';
const ENA_PORTAL = 'https://www.ebi.ac.uk/ena/portal/api/search';
const UNIPROT = 'https://rest.uniprot.org/uniprotkb/';

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown): number | null => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

function requireIdentifier(service: ServiceId, id: string): string {
  const trimmed = id.trim();
  if (!isSafeIdentifier(trimmed)) throw new NetError(service, 'invalidIdentifier');
  return trimmed;
}

function eutils(tool: string, params: Record<string, string>): URL {
  const url = new URL(`${EUTILS}${tool}.fcgi`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('tool', CLIENT_NAME);
  return url;
}

/** Fetches a GenBank or RefSeq record through E-utilities `efetch`. NCBI answers an unknown id with text, not a status. */
export async function fetchNcbi(id: string, context?: RequestContext): Promise<FetchedRecord> {
  const accession = requireIdentifier('ncbi', id);
  const url = eutils('efetch', {
    db: ncbiDatabaseOf(accession),
    id: accession,
    rettype: 'gb',
    retmode: 'text',
  });
  const text = await getText('ncbi', url, context);
  if (!text.trimStart().startsWith('LOCUS')) throw new NetError('ncbi', 'notFound');
  return { text, fileName: `${accession}.gb` };
}

/** Fetches an ENA record as EMBL flat file text. */
export async function fetchEna(id: string, context?: RequestContext): Promise<FetchedRecord> {
  const accession = requireIdentifier('ena', id);
  const url = new URL(`${ENA_BROWSER}embl/${encodeURIComponent(accession)}`);
  const text = await getText('ena', url, context);
  if (!text.trimStart().startsWith('ID')) throw new NetError('ena', 'notFound');
  return { text, fileName: `${accession}.embl` };
}

/** Fetches a UniProtKB entry as FASTA. */
export async function fetchUniprot(id: string, context?: RequestContext): Promise<FetchedRecord> {
  const accession = requireIdentifier('uniprot', id);
  const url = new URL(`${UNIPROT}${encodeURIComponent(accession)}.fasta`);
  const text = await getText('uniprot', url, context);
  if (!text.trimStart().startsWith('>')) throw new NetError('uniprot', 'notFound');
  return { text, fileName: `${accession}.fasta` };
}

/** Fetches one record by identifier from `service`. */
export function fetchRecord(
  service: ServiceId,
  id: string,
  context?: RequestContext,
): Promise<FetchedRecord> {
  return { ncbi: fetchNcbi, ena: fetchEna, uniprot: fetchUniprot }[service](id, context);
}

/** Last field of the `extra` summary string `gi|6691170|gb|M77789.2|SYNPUC19V`: the locus name. */
const locusOf = (extra: string) => extra.split('|').filter(Boolean).at(-1) ?? '';

/** E-utilities can answer 200 with an `error` field, notably "API rate limit exceeded". */
function rejectEutilsError(body: Json): void {
  const message = asText(body.error);
  if (message === '') return;
  throw new NetError('ncbi', /rate limit/i.test(message) ? 'rateLimited' : 'badResponse');
}

/** Keyword search of NCBI Nucleotide: `esearch` finds the ids, `esummary` describes them. */
export async function searchNcbi(query: string, context?: RequestContext): Promise<DatabaseHit[]> {
  const search = asObject(
    parseJson(
      'ncbi',
      await getText(
        'ncbi',
        eutils('esearch', { db: 'nuccore', term: query, retmax: String(SEARCH_LIMIT), retmode: 'json' }),
        context,
      ),
    ),
  );
  rejectEutilsError(search);
  const result = asObject(search.esearchresult);
  const ids = Array.isArray(result.idlist) ? result.idlist.filter((id) => typeof id === 'string') : [];
  if (ids.length === 0) {
    if (result.ERROR !== undefined) throw new NetError('ncbi', 'badResponse');
    return [];
  }
  const summary = asObject(
    parseJson(
      'ncbi',
      await getText(
        'ncbi',
        eutils('esummary', { db: 'nuccore', id: ids.join(','), retmode: 'json' }),
        context,
      ),
    ),
  );
  rejectEutilsError(summary);
  const rows = asObject(summary.result);
  return ids.flatMap((uid): DatabaseHit[] => {
    const row = asObject(rows[uid]);
    const id = asText(row.accessionversion) || asText(row.caption);
    if (id === '') return [];
    return [
      {
        service: 'ncbi',
        id,
        name: locusOf(asText(row.extra)) || asText(row.caption),
        description: asText(row.title),
        organism: asText(row.organism),
        length: asNumber(row.slen),
      },
    ];
  });
}

/** Builds an ENA portal query that needs every word in the description. Quotes and wildcards the user typed are dropped. */
export function enaQueryOf(text: string): string {
  const words = text
    .replace(/["*\\()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return words.map((word) => `description="*${word}*"`).join(' AND ');
}

/** Keyword search of ENA sequence records by description. */
export async function searchEna(query: string, context?: RequestContext): Promise<DatabaseHit[]> {
  const q = enaQueryOf(query);
  if (q === '') return [];
  const url = new URL(ENA_PORTAL);
  url.searchParams.set('result', 'sequence');
  url.searchParams.set('query', q);
  url.searchParams.set('fields', 'accession,description,scientific_name,base_count');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(SEARCH_LIMIT));
  const rows = parseJson('ena', await getText('ena', url, context));
  if (!Array.isArray(rows)) throw new NetError('ena', 'badResponse');
  return rows.map((row): DatabaseHit => {
    const item = asObject(row);
    return {
      service: 'ena',
      id: asText(item.accession),
      name: '',
      description: asText(item.description),
      organism: asText(item.scientific_name),
      length: asNumber(item.base_count),
    };
  });
}

/** Keyword search of UniProtKB. The text goes to UniProt as typed, so its field syntax (`gene:GFP`) works. */
export async function searchUniprot(query: string, context?: RequestContext): Promise<DatabaseHit[]> {
  const url = new URL(`${UNIPROT}search`);
  url.searchParams.set('query', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('size', String(SEARCH_LIMIT));
  url.searchParams.set('fields', 'accession,id,protein_name,organism_name,length');
  const body = asObject(parseJson('uniprot', await getText('uniprot', url, context)));
  if (!Array.isArray(body.results)) throw new NetError('uniprot', 'badResponse');
  return body.results.map((row): DatabaseHit => {
    const item = asObject(row);
    const description = asObject(item.proteinDescription);
    const recommended = asObject(asObject(description.recommendedName).fullName);
    const submitted = asObject(
      asObject(Array.isArray(description.submissionNames) ? description.submissionNames[0] : {}).fullName,
    );
    return {
      service: 'uniprot',
      id: asText(item.primaryAccession),
      name: asText(item.uniProtkbId),
      description: asText(recommended.value) || asText(submitted.value),
      organism: asText(asObject(item.organism).scientificName),
      length: asNumber(asObject(item.sequence).length),
    };
  });
}

/** Searches `service` by keyword. An empty array means the service answered and found nothing. */
export function searchService(
  service: ServiceId,
  query: string,
  context?: RequestContext,
): Promise<DatabaseHit[]> {
  return { ncbi: searchNcbi, ena: searchEna, uniprot: searchUniprot }[service](query, context);
}
