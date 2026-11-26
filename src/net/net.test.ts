// @vitest-environment jsdom
import { resetRateLimits } from './http';
import { guessService, isSafeIdentifier, looksLikeIdentifier } from './identifiers';
import { fetchSequence } from './open';
import {
  enaQueryOf,
  fetchEna,
  fetchNcbi,
  fetchUniprot,
  searchEna,
  searchNcbi,
  searchUniprot,
} from './services';
import { NetError } from './types';

const GENBANK = `LOCUS       TEST1                     12 bp    DNA     linear   SYN 01-JAN-2000
DEFINITION  test.
ORIGIN
        1 acgtacgtac gt
//
`;

interface Call {
  readonly url: URL;
  readonly init: RequestInit | undefined;
}

function stubFetch(respond: (url: URL) => Response | Promise<Response> | Error): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, init?: RequestInit) => {
      calls.push({ url: input, init });
      const result = await respond(input);
      if (result instanceof Error) throw result;
      return result;
    }),
  );
  return calls;
}

/** A fetch that never answers and rejects when its signal aborts, as the browser's does. */
function stubHangingFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise((_, reject) => {
          const abort = () => reject(new DOMException('aborted', 'AbortError'));
          if (init.signal?.aborted) abort();
          else init.signal?.addEventListener('abort', abort);
        }),
    ),
  );
}

const text = (body: string, status = 200) => new Response(body, { status });
const json = (body: unknown) => text(JSON.stringify(body));

async function failureOf(promise: Promise<unknown>): Promise<NetError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof NetError) return error;
    throw error;
  }
  throw new Error('expected a NetError');
}

beforeEach(() => {
  resetRateLimits();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('identifiers', () => {
  it('tells accessions apart from other text', () => {
    for (const id of [
      'U55762',
      'U55762.1',
      'NC_001416.1',
      'NP_000537.3',
      'P0DTC2',
      'A0A6G9RUW5',
      'MN996867.1',
    ])
      expect(looksLikeIdentifier(id), id).toBe(true);
    for (const text of ['ACGTACGT', 'hello world', 'pUC19', ''])
      expect(looksLikeIdentifier(text), text).toBe(false);
  });

  it('sends the unmistakable UniProt shapes to UniProt and the rest to NCBI', () => {
    expect(guessService('P0DTC2')).toBe('uniprot');
    expect(guessService('A0A6G9RUW5')).toBe('uniprot');
    expect(guessService('NC_001416.1')).toBe('ncbi');
    expect(guessService('U55762.1')).toBe('ncbi');
    expect(guessService('P42212')).toBe('ncbi');
  });

  it('refuses text that could change a request URL', () => {
    expect(isSafeIdentifier('L09137.2')).toBe(true);
    for (const bad of ['a/../b', 'x?y=1', 'id&db=protein', 'a b c', '', 'ab'])
      expect(isSafeIdentifier(bad)).toBe(false);
  });
});

describe('fetching by identifier', () => {
  it('asks NCBI efetch for GenBank text and names the client with the generic tool name only', async () => {
    const calls = stubFetch(() => text(GENBANK));
    const record = await fetchNcbi('M77789.2');
    expect(record.text).toBe(GENBANK);
    const url = calls[0]?.url as URL;
    expect(url.origin + url.pathname).toBe('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      db: 'nuccore',
      id: 'M77789.2',
      rettype: 'gb',
      retmode: 'text',
      tool: 'gene-os',
    });
    expect(calls[0]?.init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(calls[0]?.init?.headers).toBeUndefined();
  });

  it('uses the protein database for protein accessions', async () => {
    const calls = stubFetch(() => text(GENBANK));
    await fetchNcbi('NP_000537.3');
    expect(calls[0]?.url.searchParams.get('db')).toBe('protein');
  });

  it('reads the text NCBI sends for an unknown id as not found', async () => {
    stubFetch(() => text('Error: Failed to understand id: ZZ999999.1'));
    expect((await failureOf(fetchNcbi('ZZ999999.1'))).kind).toBe('notFound');
  });

  it('fetches ENA EMBL text and UniProt FASTA from their own hosts', async () => {
    const calls = stubFetch((url) =>
      url.host.startsWith('rest') ? text('>sp|P1|X\nMKV\n') : text('ID   X; SV 1;\n'),
    );
    expect((await fetchEna('J01749.1')).fileName).toBe('J01749.1.embl');
    expect((await fetchUniprot('P42212')).fileName).toBe('P42212.fasta');
    expect(calls.map((c) => c.url.href)).toEqual([
      'https://www.ebi.ac.uk/ena/browser/api/embl/J01749.1',
      'https://rest.uniprot.org/uniprotkb/P42212.fasta',
    ]);
  });

  it('never builds a request from an unsafe identifier', async () => {
    const calls = stubFetch(() => text(GENBANK));
    expect((await failureOf(fetchNcbi('x&db=protein'))).kind).toBe('invalidIdentifier');
    expect(calls).toHaveLength(0);
  });

  it('opens a fetched record through the format readers', async () => {
    stubFetch(() => text(GENBANK));
    const record = await fetchSequence('ncbi', 'TEST12345');
    expect(record.seq).toBe('ACGTACGTACGT');
  });

  it('reports text it cannot read as a bad response from the service', async () => {
    stubFetch(() => text('LOCUS       BROKEN\nno sequence here\n//\n'));
    expect(await failureOf(fetchSequence('ncbi', 'TEST12345'))).toMatchObject({
      service: 'ncbi',
      kind: 'badResponse',
    });
  });
});

describe('failures name the service and never look like an empty result', () => {
  it('maps HTTP statuses', async () => {
    stubFetch(() => text('', 429));
    expect(await failureOf(fetchNcbi('U55762.1'))).toMatchObject({
      service: 'ncbi',
      kind: 'rateLimited',
      status: 429,
    });
    stubFetch(() => text('', 404));
    expect(await failureOf(fetchEna('ZZ999999.1'))).toMatchObject({ service: 'ena', kind: 'notFound' });
    stubFetch(() => text('', 400));
    expect(await failureOf(fetchUniprot('ZZZZZZ'))).toMatchObject({
      service: 'uniprot',
      kind: 'invalidIdentifier',
    });
    stubFetch(() => text('', 503));
    expect(await failureOf(fetchEna('J01749.1'))).toMatchObject({ kind: 'serverError', status: 503 });
  });

  it('reports a refused or unreachable service when fetch throws a TypeError', async () => {
    stubFetch(() => new TypeError('Failed to fetch'));
    expect(await failureOf(fetchUniprot('P42212'))).toMatchObject({
      service: 'uniprot',
      kind: 'unreachable',
    });
  });

  it('reports offline without sending a request', async () => {
    const calls = stubFetch(() => text(GENBANK));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await failureOf(fetchNcbi('U55762.1'))).toMatchObject({ kind: 'offline' });
    expect(calls).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('times out a request that never answers', async () => {
    stubHangingFetch();
    const pending = failureOf(fetchEna('J01749.1'));
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await pending).toMatchObject({ service: 'ena', kind: 'timeout' });
  });

  it('cancels a call when the caller aborts', async () => {
    stubHangingFetch();
    const controller = new AbortController();
    const pending = failureOf(fetchEna('J01749.1', { signal: controller.signal }));
    controller.abort();
    expect(await pending).toMatchObject({ kind: 'cancelled' });
  });

  it('spaces NCBI calls at least 340 ms apart and leaves other services alone', async () => {
    const stamps: number[] = [];
    stubFetch(() => {
      stamps.push(Date.now());
      return text(GENBANK);
    });
    await Promise.all([fetchNcbi('U55762.1'), fetchNcbi('U55763.1'), fetchNcbi('U55764.1')]);
    const gaps = stamps.slice(1).map((stamp, i) => stamp - (stamps[i] ?? 0));
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(335);
  });
});

describe('keyword search', () => {
  it('NCBI: finds ids with esearch, then describes them with esummary', async () => {
    const calls = stubFetch((url) =>
      url.pathname.endsWith('esearch.fcgi')
        ? json({ esearchresult: { idlist: ['6691170'] } })
        : json({
            result: {
              uids: ['6691170'],
              '6691170': {
                accessionversion: 'M77789.2',
                caption: 'M77789',
                title: 'Cloning vector pUC19, complete sequence',
                organism: 'Cloning vector pUC19',
                slen: 2686,
                extra: 'gi|6691170|gb|M77789.2|SYNPUC19V',
              },
            },
          }),
    );
    expect(await searchNcbi('pUC19[Title]')).toEqual([
      {
        service: 'ncbi',
        id: 'M77789.2',
        name: 'SYNPUC19V',
        description: 'Cloning vector pUC19, complete sequence',
        organism: 'Cloning vector pUC19',
        length: 2686,
      },
    ]);
    expect(calls[0]?.url.searchParams.get('term')).toBe('pUC19[Title]');
    expect(calls[1]?.url.searchParams.get('id')).toBe('6691170');
  });

  it('NCBI: no ids is an empty result, a rate-limit body is a failure', async () => {
    stubFetch(() => json({ esearchresult: { idlist: [] } }));
    expect(await searchNcbi('zzzqqq')).toEqual([]);
    stubFetch(() => json({ error: 'API rate limit exceeded', count: '4' }));
    expect(await failureOf(searchNcbi('pUC19'))).toMatchObject({ service: 'ncbi', kind: 'rateLimited' });
  });

  it('ENA: requires every word in the description and drops quotes and wildcards', async () => {
    expect(enaQueryOf('pUC19 "vector" *')).toBe('description="*pUC19*" AND description="*vector*"');
    const calls = stubFetch(() =>
      json([
        {
          accession: 'A28342',
          description: 'Polylinker',
          scientific_name: 'synthetic construct',
          base_count: '24',
        },
      ]),
    );
    const hits = await searchEna('pUC19');
    expect(hits[0]).toMatchObject({
      service: 'ena',
      id: 'A28342',
      organism: 'synthetic construct',
      length: 24,
    });
    expect(calls[0]?.url.searchParams.get('query')).toBe('description="*pUC19*"');
  });

  it('UniProt: reads the recommended name, falls back to the submitted one, and rejects a body without results', async () => {
    stubFetch(() =>
      json({
        results: [
          {
            primaryAccession: 'P42212',
            uniProtkbId: 'GFP_AEQVI',
            organism: { scientificName: 'Aequorea victoria' },
            proteinDescription: { recommendedName: { fullName: { value: 'Green fluorescent protein' } } },
            sequence: { length: 238 },
          },
          {
            primaryAccession: 'A0A6G9RUW5',
            uniProtkbId: 'A0A6G9RUW5_9CNID',
            organism: { scientificName: 'Montipora grisea' },
            proteinDescription: { submissionNames: [{ fullName: { value: 'GFP-like chromoprotein' } }] },
            sequence: { length: 89 },
          },
        ],
      }),
    );
    const hits = await searchUniprot('gfp');
    expect(hits.map((h) => h.description)).toEqual(['Green fluorescent protein', 'GFP-like chromoprotein']);
    expect(hits[0]).toMatchObject({ id: 'P42212', name: 'GFP_AEQVI', length: 238 });
    stubFetch(() => json({ messages: ['bad query'] }));
    expect(await failureOf(searchUniprot('((('))).toMatchObject({ kind: 'badResponse' });
  });
});
