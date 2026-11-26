// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { translate } from '../../../engine/translate';
import type { SeqRecord } from '../../../engine/types';
import { clearAnalysisCache } from '../../../state/analysis';
import { type SeqDocument, workspace } from '../../../state/documents';
import { updateSettings } from '../../../state/settings';
import { viewOf } from '../../../state/view';
import { Panel as Proteins } from '../proteins';

const codingSequence = (codons: number, filler: string) => `ATG${filler.repeat(codons - 1)}TAA`;
const ORF_A = codingSequence(12, 'GCT');
const ORF_B = codingSequence(15, 'AAAGAG');
const SEQ = `CC${ORF_A}TT${ORF_B}GG`;

const record = (seq: string, alphabet: SeqRecord['alphabet'] = 'dna', name = 'demo'): SeqRecord => ({
  id: name,
  name,
  description: '',
  alphabet,
  topology: 'linear',
  seq,
  features: [],
  metadata: {},
});

const open = (rec: SeqRecord): SeqDocument => {
  const id = workspace.open(rec);
  return workspace.documents.value.find((doc) => doc.id === id) as SeqDocument;
};

const setMinimumCodons = (value: string) => {
  const field = screen.getByLabelText('Minimum length (codons)');
  fireEvent.input(field, { target: { value } });
  fireEvent.blur(field);
};

const grid = () => screen.findByRole('grid', { name: 'Open reading frames' });
const bodyRows = () => screen.queryAllByRole('row').filter((row) => row.classList.contains('table-row'));

beforeEach(() => {
  updateSettings({ language: 'en', mode: 'default' });
});

afterEach(() => {
  cleanup();
  clearAnalysisCache();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
  vi.restoreAllMocks();
});

describe('Proteins view of a DNA record', () => {
  it('lists the ORFs the search finds with their properties', async () => {
    const doc = open(record(SEQ));
    render(<Proteins doc={doc} />);
    setMinimumCodons('10');
    await grid();
    await waitFor(() => expect(bodyRows().length).toBe(2));
    const first = within(bodyRows()[0] as HTMLElement)
      .getAllByRole('gridcell')
      .map((cell) => cell.textContent);
    expect(first.slice(0, 5)).toEqual(['ORF1', '+3', '3', '41', '12']);
    expect(first[8]).toBe('ATG');
    expect(first[9]).toBe('TAA');
    expect(first[10]).toBe(translate(ORF_A, { toStop: true }));
  });

  it('selecting an ORF selects its bases for every view and fills the inspector', async () => {
    const doc = open(record(SEQ));
    render(<Proteins doc={doc} />);
    setMinimumCodons('10');
    await waitFor(() => expect(bodyRows().length).toBe(2));
    fireEvent.click(bodyRows()[1] as HTMLElement);

    const selection = viewOf(doc.id).selection.value;
    expect(selection).toEqual({
      start: 2 + ORF_A.length + 2,
      end: 2 + ORF_A.length + 2 + ORF_B.length,
      strand: 1,
    });
    expect(viewOf(doc.id).frames.value).toContain(2);
    expect(await screen.findByRole('heading', { name: 'ORF2' })).toBeTruthy();
    expect(screen.getByText('Isoelectric point')).toBeTruthy();
    expect(screen.getByText('Instability index')).toBeTruthy();
    expect(screen.getByText('Net charge')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Hydrophobic .*Polar .*Basic .*Acidic/ })).toBeTruthy();

    const blast = screen.getByRole('link', { name: 'NCBI BLASTp' }) as HTMLAnchorElement;
    const peptide = translate(ORF_B, { toStop: true });
    expect(new URL(blast.href).searchParams.get('QUERY')).toBe(peptide);
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('follows the shared selection when another view selects an ORF', async () => {
    const doc = open(record(SEQ));
    render(<Proteins doc={doc} />);
    setMinimumCodons('10');
    await waitFor(() => expect(bodyRows().length).toBe(2));
    viewOf(doc.id).select(2, 2 + ORF_A.length, 1);
    expect(await screen.findByRole('heading', { name: 'ORF1' })).toBeTruthy();
  });

  it('tells the user what to change when no ORF is long enough', async () => {
    const doc = open(record(SEQ));
    render(<Proteins doc={doc} />);
    expect(await screen.findByText(/No ORF of 100 codons or more was found/)).toBeTruthy();
  });

  it('shows the advanced parameters only in advanced mode', async () => {
    const doc = open(record(SEQ));
    render(<Proteins doc={doc} />);
    expect(screen.queryByLabelText('Genetic code table')).toBeNull();
    expect(screen.getByRole('group', { name: 'Start codons' })).toBeTruthy();
    cleanup();
    updateSettings({ mode: 'advanced' });
    render(<Proteins doc={doc} />);
    expect(screen.getByLabelText('Genetic code table')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Strands and frames' })).toBeTruthy();
  });

  it('offers the plain six-frame translation with a copy and an export action per frame', async () => {
    const doc = open(record(SEQ));
    render(<Proteins doc={doc} />);
    fireEvent.click(screen.getByLabelText('Six-frame translation'));
    for (const frame of ['+1', '+2', '+3', '-1', '-2', '-3']) {
      expect(screen.getByRole('button', { name: `Copy frame ${frame}` })).toBeTruthy();
      expect(screen.getByRole('button', { name: `Export frame ${frame} FASTA` })).toBeTruthy();
    }
    const frame3 = screen.getByRole('region', { name: 'Translation in frame +3' });
    expect(frame3.textContent).toBe(translate(SEQ.slice(2)));

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Copy frame +3' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(translate(SEQ.slice(2))));
  });
});

describe('Proteins view of a protein record', () => {
  it('skips the ORF search and inspects the whole chain', async () => {
    const chain = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVV';
    const doc = open(record(`${chain}*`, 'protein', 'P69905'));
    render(<Proteins doc={doc} />);
    expect(screen.queryByRole('grid')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'P69905' })).toBeTruthy();
    expect(screen.getByText(`${chain.length} aa`)).toBeTruthy();
    const uniprot = screen.getByRole('link', { name: 'UniProt' }) as HTMLAnchorElement;
    expect(new URL(uniprot.href).searchParams.get('query')).toBe('P69905');
  });
});
