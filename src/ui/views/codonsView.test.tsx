// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { codonUsage } from '../../engine/composition';
import type { SeqRecord } from '../../engine/types';
import { clearAnalysisCache } from '../../state/analysis';
import { type SeqDocument, workspace } from '../../state/documents';
import { updateSettings } from '../../state/settings';
import { viewOf } from '../../state/view';
import { Panel as Codons } from './codons';
import { orfSessionOf } from './proteins/orfSession';

const ORF = `ATG${'GCT'.repeat(11)}TAA`;
const SEQ = `CC${ORF}TTCCCCC`;

const record = (seq: string, alphabet: SeqRecord['alphabet'] = 'dna'): SeqRecord => ({
  id: 'demo',
  name: 'demo',
  description: '',
  alphabet,
  topology: 'linear',
  seq,
  features: [],
  metadata: {},
});

const open = (rec: SeqRecord): SeqDocument => {
  const id = workspace.open(rec);
  const doc = workspace.documents.value.find((candidate) => candidate.id === id) as SeqDocument;
  orfSessionOf(id).settings.value = { ...orfSessionOf(id).settings.value, minCodons: 10 };
  return doc;
};

const kpi = (title: string) => {
  const heading = screen.getByText(title);
  return heading.parentElement?.textContent ?? '';
};

beforeEach(() => updateSettings({ language: 'en', mode: 'default' }));

afterEach(() => {
  cleanup();
  clearAnalysisCache();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
});

describe('Codons view', () => {
  it('asks for an ORF when none is selected, then counts the codons of the selected one', async () => {
    const doc = open(record(SEQ));
    render(<Codons doc={doc} />);
    expect(await screen.findByText(/No ORF is selected/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the Proteins view' })).toBeTruthy();

    viewOf(doc.id).select(2, 2 + ORF.length, 1);
    await waitFor(() => expect(kpi('Codons counted')).toContain('13'));
    fireEvent.input(screen.getByLabelText('Filter rows'), { target: { value: 'GCT' } });
    const grid = screen.getByRole('grid', { name: 'Codon usage' });
    const gct = within(grid)
      .getAllByRole('row')
      .find((row) => row.classList.contains('table-row'));
    const cells = within(gct as HTMLElement)
      .getAllByRole('gridcell')
      .map((cell) => cell.textContent);
    expect(cells.slice(0, 4)).toEqual(['GCT', 'A', '11', '100.0%']);
  });

  it('counts the whole sequence in a chosen frame through the analysis worker path', async () => {
    const doc = open(record(SEQ));
    render(<Codons doc={doc} />);
    fireEvent.click(screen.getByLabelText('Whole sequence'));
    await waitFor(() => expect(kpi('Codons counted')).toContain(String(codonUsage(SEQ).total)));

    fireEvent.change(screen.getByLabelText('Reading frame'), { target: { value: '-2' } });
    expect(await screen.findByText(/Whole sequence, frame -2/)).toBeTruthy();
  });

  it('compares with a reference organism: adaptation index and per-codon difference', async () => {
    const doc = open(record(SEQ));
    viewOf(doc.id).select(2, 2 + ORF.length, 1);
    render(<Codons doc={doc} />);
    await waitFor(() => expect(kpi('Codons counted')).toContain('13'));
    expect(screen.queryByText('Codon adaptation index')).toBeNull();

    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'ecoli-k12' } });
    await waitFor(() => expect(kpi('Codon adaptation index')).toContain('against E. coli K-12'));
    expect(screen.getByRole('columnheader', { name: /Difference/ })).toBeTruthy();
    expect(screen.getByText(/Codon Usage Database \(Kazusa\)/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Source page' }).getAttribute('href')).toContain('kazusa.or.jp');
  });

  it('says a protein record has no codons', () => {
    const doc = open(record('MKTAYIAKQR', 'protein'));
    render(<Codons doc={doc} />);
    expect(screen.getByText(/needs a DNA or RNA sequence/)).toBeTruthy();
  });
});
