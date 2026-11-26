// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { SeqRecord } from '../../../engine/types';
import { workspace } from '../../../state/documents';
import { updateSettings } from '../../../state/settings';
import { viewOf } from '../../../state/view';
import { Panel } from '../alignment';

const record = (name: string, seq: string, alphabet: SeqRecord['alphabet'] = 'dna'): SeqRecord => ({
  id: name,
  name,
  description: '',
  alphabet,
  topology: 'linear',
  seq,
  features: [],
  metadata: {},
});

const randomDna = (n: number, seed: number) => {
  let x = seed;
  let out = '';
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'[x % 4];
  }
  return out;
};

const REFERENCE = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTT';
const VARIANT = `${REFERENCE.slice(0, 20)}T${REFERENCE.slice(21, 40)}${REFERENCE.slice(43)}`;

function openPanel(...records: SeqRecord[]) {
  const ids = records.map((r) => workspace.open(r));
  const doc = workspace.documents.value.find((d) => d.id === ids[0]);
  if (!doc) throw new Error('document missing');
  render(<Panel doc={doc} />);
  return ids;
}

beforeEach(() => updateSettings({ language: 'en', mode: 'default' }));
afterEach(() => {
  cleanup();
  workspace.documents.value = [];
  workspace.activeId.value = null;
});

describe('alignment view', () => {
  it('asks for a second sequence while only one is chosen', () => {
    openPanel(record('ref', REFERENCE));
    expect(screen.getByText(/Choose at least two sequences/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Align' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('aligns the open sequence against a pasted one and shows statistics, columns and differences', async () => {
    openPanel(record('ref', REFERENCE));
    fireEvent.input(screen.getByLabelText(/paste a sequence to compare/i), { target: { value: VARIANT } });
    expect(screen.getByText(/Two sequences chosen/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));

    await waitFor(() => expect(screen.getByText('Identity')).toBeTruthy());
    expect(screen.getByText('Aligned length')).toBeTruthy();
    expect(screen.getByText(/Differences \(\d+\)/)).toBeTruthy();
    const grid = screen.getByRole('region', { name: /Alignment: 2 rows/ });
    expect(grid.textContent).toContain('ATGGCTAGCAAAGGAGAAGA');
    expect(
      screen.getAllByRole('row').some((row) => /Substitution|Deletion/.test(row.textContent ?? '')),
    ).toBe(true);
  });

  it('aligns three open sequences as a multiple alignment with a consensus and a guide tree', async () => {
    openPanel(
      record('one', REFERENCE),
      record('two', VARIANT),
      record('three', REFERENCE.replace('GGAGAAGAA', 'GGCGAAGAA')),
    );
    for (const name of ['two', 'three']) fireEvent.click(screen.getByLabelText(new RegExp(`^${name}`)));
    expect(screen.getByText(/3 sequences chosen/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));

    await waitFor(() => expect(screen.getByText('Mean identity')).toBeTruthy());
    expect(screen.getAllByText('Consensus').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'Guide tree' })).toBeTruthy();
    expect(screen.getByText(/^\(.*\);$/s).textContent).toMatch(/one:/);
  });

  it('presents a pair that is over the size limit as a limit with advice, not as a failure', async () => {
    openPanel(record('big', randomDna(12_000, 1)), record('bigger', randomDna(12_000, 2)));
    fireEvent.click(screen.getByLabelText(/^bigger/));
    fireEvent.click(screen.getByLabelText(/^Local/));
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));

    await waitFor(() => expect(screen.getByText('This alignment is over the size limit')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Try the Global method/)).toBeTruthy();
  });

  it('cuts a document to its selected region when asked', async () => {
    const [id] = openPanel(record('ref', REFERENCE), record('other', REFERENCE));
    viewOf(id as string).select(10, 30);
    fireEvent.click(screen.getByLabelText(/^other/));
    const region = await screen.findByLabelText(/Only the region selected in the Sequence view \(11-30\)/);
    fireEvent.click(region);
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => expect(screen.getByText('Identity')).toBeTruthy());
    expect(screen.getAllByText('ref:11-30').length).toBeGreaterThan(0);
  });

  it('pages through a long alignment and jumps to a column', async () => {
    openPanel(record('ref', randomDna(3000, 4)), record('other', randomDna(3000, 4)));
    fireEvent.click(screen.getByLabelText(/^other/));
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => expect(screen.getByText('Identity')).toBeTruthy());
    const goTo = screen.getByLabelText('Go to column') as HTMLInputElement;
    expect(goTo.placeholder).toBe('1');
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(Number(goTo.placeholder)).toBeGreaterThan(50));
    fireEvent.input(goTo, { target: { value: '2500' } });
    fireEvent.keyDown(goTo, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/^Column 2,500/)).toBeTruthy());
    expect(Number(goTo.placeholder)).toBeGreaterThan(2400);
  });

  it('refuses to mix protein and DNA', () => {
    openPanel(record('dna', REFERENCE), record('prot', 'MKVLAAGIVGLLLAQWERTYIPASDFGHKLCVNM', 'protein'));
    fireEvent.click(screen.getByLabelText(/^prot/));
    expect(screen.getByRole('alert').textContent).toMatch(/mix protein and DNA/);
    expect((screen.getByRole('button', { name: 'Align' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('stops a run when Cancel is pressed and shows no result', async () => {
    openPanel(record('ref', REFERENCE), record('other', VARIANT));
    fireEvent.click(screen.getByLabelText(/^other/));
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    fireEvent.click(
      within(screen.getByText(/Aligning 2 sequences/).closest('div') as HTMLElement).getByRole('button', {
        name: 'Cancel',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Identity')).toBeNull();
    expect(screen.getByText(/Choose the sequences and a method/)).toBeTruthy();
  });

  it('shows the scoring fields in advanced mode only', () => {
    openPanel(record('ref', REFERENCE));
    expect(screen.queryByLabelText('Gap open penalty')).toBeNull();
    cleanup();
    updateSettings({ mode: 'advanced' });
    openPanel(record('ref', REFERENCE));
    expect(screen.getByLabelText('Gap open penalty')).toBeTruthy();
  });
});
