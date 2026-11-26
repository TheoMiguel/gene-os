// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { resetRateLimits } from '../../../net/http';
import { workspace } from '../../../state/documents';
import { updateSettings } from '../../../state/settings';
import { NewSequenceView } from '../../NewSequenceView';
import { DatabaseSearch } from './DatabaseSearch';
import { ExamplePresets } from './ExamplePresets';
import { preferredService } from './lookup';

const GENBANK = `LOCUS       TEST1                     12 bp    DNA     linear   SYN 01-JAN-2000
DEFINITION  test.
ORIGIN
        1 acgtacgtac gt
//
`;

const text = (body: string, status = 200) => new Response(body, { status });
const json = (body: unknown) => text(JSON.stringify(body));

beforeEach(() => {
  updateSettings({ language: 'en' });
  resetRateLimits();
  preferredService.value = 'ncbi';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
});

describe('example sequences', () => {
  it('opens pUC19 with its features and no network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<ExamplePresets variant="chips" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open pUC19' }));
    await waitFor(() => expect(workspace.documents.value).toHaveLength(1));
    const doc = workspace.documents.value[0];
    expect(doc?.record.name).toBe('pUC19');
    expect(doc?.record.seq).toHaveLength(2686);
    expect(doc?.record.topology).toBe('circular');
    expect(doc?.record.features.length).toBeGreaterThan(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens the Sanger read with its chromatogram', async () => {
    render(<ExamplePresets variant="cards" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Sanger read (16S rRNA)' }));
    await waitFor(() => expect(workspace.documents.value).toHaveLength(1), { timeout: 5000 });
    expect(workspace.documents.value[0]?.record.trace?.peakPositions.length).toBe(795);
  });

  it('shows the record each example came from', () => {
    render(<ExamplePresets variant="cards" />);
    expect(screen.getByText('Record M77789.2')).toBeTruthy();
  });
});

describe('database panel', () => {
  const fetchRecord = () => {
    fireEvent.input(screen.getByRole('searchbox', { name: 'Accession or identifier' }), {
      target: { value: 'TEST12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch and open' }));
  };

  it('fetches by identifier and opens the record as a document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => text(GENBANK)),
    );
    render(<DatabaseSearch />);
    fetchRecord();
    expect(await screen.findByText('Opened TEST12345 from NCBI.')).toBeTruthy();
    expect(workspace.documents.value[0]?.record.seq).toBe('ACGTACGTACGT');
  });

  it('searches by keyword, lists rows in a table and opens the selected one', async () => {
    const fetchStub = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith('esearch.fcgi')) return json({ esearchresult: { idlist: ['1'] } });
      if (url.pathname.endsWith('esummary.fcgi'))
        return json({
          result: {
            uids: ['1'],
            '1': {
              accessionversion: 'M77789.2',
              caption: 'M77789',
              title: 'Cloning vector pUC19, complete sequence',
              organism: 'Cloning vector pUC19',
              slen: 2686,
              extra: 'gi|1|gb|M77789.2|SYNPUC19V',
            },
          },
        });
      return text(GENBANK);
    });
    vi.stubGlobal('fetch', fetchStub);
    render(<DatabaseSearch />);
    fireEvent.click(screen.getByRole('radio', { name: 'Keywords' }));
    fireEvent.input(screen.getByRole('searchbox', { name: 'Keywords' }), { target: { value: 'pUC19' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const grid = await screen.findByRole('grid', { name: 'Search results from NCBI' });
    expect(within(grid).getByText('M77789.2')).toBeTruthy();
    expect(within(grid).getByText('Cloning vector pUC19, complete sequence')).toBeTruthy();
    fireEvent.click(within(grid).getByText('M77789.2'));
    fireEvent.click(screen.getByRole('button', { name: 'Open selected (1)' }));
    await waitFor(() => expect(workspace.documents.value).toHaveLength(1));
    expect(fetchStub).toHaveBeenLastCalledWith(
      expect.objectContaining({ href: expect.stringContaining('efetch.fcgi') }),
      expect.anything(),
    );
  });

  it('says a search found nothing, which is not a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ esearchresult: { idlist: [] } })),
    );
    render(<DatabaseSearch />);
    fireEvent.click(screen.getByRole('radio', { name: 'Keywords' }));
    fireEvent.input(screen.getByRole('searchbox', { name: 'Keywords' }), { target: { value: 'zzzqqq' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/NCBI found no record for this search/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['a refused request', () => Promise.reject(new TypeError('Failed to fetch')), /could not reach NCBI/],
    ['a rate limit', async () => text('', 429), /NCBI reports too many requests/],
    [
      'an unknown id',
      async () => text('Error: Failed to understand id'),
      /NCBI has no record with this identifier/,
    ],
  ])('names the service when %s happens', async (_name, respond, message) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    render(<DatabaseSearch />);
    fetchRecord();
    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(workspace.documents.value).toHaveLength(0);
  });

  it('says so when the browser is offline and sends nothing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<DatabaseSearch />);
    fetchRecord();
    expect((await screen.findByRole('alert')).textContent).toMatch(/You are offline/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends only what the user typed, to the chosen service', async () => {
    const fetchStub = vi.fn(async () =>
      text('>sp|P42212|GFP_AEQVI\nMSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTL\n'),
    );
    vi.stubGlobal('fetch', fetchStub);
    render(<DatabaseSearch />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Database' }), { target: { value: 'uniprot' } });
    fireEvent.input(screen.getByRole('searchbox', { name: 'Accession or identifier' }), {
      target: { value: 'P42212' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch and open' }));
    await waitFor(() => expect(workspace.documents.value).toHaveLength(1));
    const [url, init] = fetchStub.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe('https://rest.uniprot.org/uniprotkb/P42212.fasta');
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(workspace.documents.value[0]?.record.alphabet).toBe('protein');
  });
});

describe('new-sequence view', () => {
  it('fetches a pasted accession instead of refusing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => text(GENBANK)),
    );
    render(<NewSequenceView />);
    fireEvent.input(screen.getByRole('textbox', { name: 'Sequence or accession' }), {
      target: { value: 'L09137.2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load sequence' }));
    await waitFor(() => expect(workspace.documents.value).toHaveLength(1));
  });

  it('tells the user which service failed when a pasted accession cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => text('', 503)),
    );
    render(<NewSequenceView />);
    fireEvent.input(screen.getByRole('textbox', { name: 'Sequence or accession' }), {
      target: { value: 'L09137.2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load sequence' }));
    expect(await screen.findByText(/NCBI reported an error/)).toBeTruthy();
  });

  it('keeps pasted DNA on the offline path', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<NewSequenceView />);
    fireEvent.input(screen.getByRole('textbox', { name: 'Sequence or accession' }), {
      target: { value: '>x\nACGTACGTACGT' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load sequence' }));
    await waitFor(() => expect(workspace.documents.value).toHaveLength(1));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
