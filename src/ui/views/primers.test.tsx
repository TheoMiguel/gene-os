// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { PUC19 } from '../../../tests/fixtures/restriction/fixtures';
import { type SeqDocument, workspace } from '../../state/documents';
import { updateSettings } from '../../state/settings';
import { historyOf, viewOf } from '../../state/view';
import { Panel } from './primers';

const openPuc19 = (topology: 'linear' | 'circular' = 'circular'): SeqDocument => {
  const id = workspace.open({
    id: 'puc19',
    name: 'pUC19',
    description: '',
    alphabet: 'dna',
    topology,
    seq: PUC19,
    features: [],
    metadata: {},
  });
  return workspace.documents.value.find((doc) => doc.id === id) as SeqDocument;
};
const current = (doc: SeqDocument) => workspace.documents.value.find((d) => d.id === doc.id) as SeqDocument;
const sequenceBoxes = () => screen.getAllByLabelText("Sequence, 5' to 3'") as HTMLInputElement[];

beforeEach(() => updateSettings({ language: 'en', mode: 'default' }));
afterEach(() => {
  cleanup();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
});

describe('Primers & PCR view', () => {
  it('asks for primers before it analyzes', () => {
    render(<Panel doc={openPuc19()} />);
    expect(screen.getByText(/Type a forward and a reverse primer/)).toBeTruthy();
    expect(screen.getByText(/Enter primers in step 01 to see the products/)).toBeTruthy();
  });

  it('analyzes a typed primer live and tells a student what to do about a hairpin', async () => {
    render(<Panel doc={openPuc19()} />);
    const [forward] = sequenceBoxes();
    fireEvent.input(forward as HTMLElement, { target: { value: 'GCGGATCCGCAAAAGCGGATCCGC' } });
    expect((await screen.findAllByText('Redesign')).length).toBeGreaterThan(0);
    expect(screen.getByText(/folds on itself \(hairpin/)).toBeTruthy();
    expect(screen.getAllByText(/Move the primer a few bases, or change the bases/).length).toBeGreaterThan(0);
    const drawing = screen.getAllByRole('img', { name: 'The structure drawn as text' });
    expect(drawing.some((el) => el.textContent?.includes('((((((((((....))))))))))'))).toBe(true);
  });

  it('shows no problem for a well designed primer', async () => {
    render(<Panel doc={openPuc19()} />);
    fireEvent.input(sequenceBoxes()[0] as HTMLElement, { target: { value: 'CAGCTCACTCAAAGGCGGTA' } });
    expect(await screen.findByText('No problem found.')).toBeTruthy();
  });

  it('rejects characters that are not bases and says which', () => {
    render(<Panel doc={openPuc19()} />);
    fireEvent.input(sequenceBoxes()[0] as HTMLElement, { target: { value: 'ACGT1Z' } });
    expect(screen.getByText(/Not a base: 1 Z/)).toBeTruthy();
  });

  it('runs the colony PCR example on pUC19: the 149 bp product is listed and drawn on the gel', async () => {
    const doc = openPuc19();
    render(<Panel doc={doc} />);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Colony PCR: load M13 vector primers' })[0] as HTMLElement,
    );
    const products = await screen.findByRole('grid', { name: 'PCR products' }, { timeout: 3000 });
    await waitFor(() => expect(products.textContent).toContain('149'));
    expect(screen.getByRole('button', { name: 'PCR: 149 bp' })).toBeTruthy();
    expect(await screen.findByRole('grid', { name: 'Primer binding sites' })).toBeTruthy();
  });

  it('selecting a binding site sets the shared selection', async () => {
    const doc = openPuc19();
    render(<Panel doc={doc} />);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Colony PCR: load M13 vector primers' })[0] as HTMLElement,
    );
    const grid = await screen.findByRole('grid', { name: 'Primer binding sites' }, { timeout: 3000 });
    const cell = await within(grid).findByText('M13F(-47)', { selector: '[role="gridcell"]' });
    fireEvent.click(cell);
    const selection = viewOf(doc.id).selection.value;
    expect(selection).toMatchObject({ start: 351, end: 375, strand: 1 });
    expect(screen.getByText(/M13F\(-47\): 0 mismatches/)).toBeTruthy();
  });

  it('adds the primers to the document as primer_bind features and Ctrl+Z takes them out', async () => {
    const doc = openPuc19();
    render(<Panel doc={doc} />);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Colony PCR: load M13 vector primers' })[0] as HTMLElement,
    );
    const add = screen.getByRole('button', { name: 'Add primers to the sequence' }) as HTMLButtonElement;
    await waitFor(() => expect(add.disabled).toBe(false), { timeout: 3000 });
    fireEvent.click(add);
    const features = current(doc).record.features;
    expect(features.map((f) => [f.type, f.name, f.location.strand])).toEqual([
      ['primer_bind', 'M13F(-47)', 1],
      ['primer_bind', 'M13R(-48)', -1],
    ]);
    act(() => {
      historyOf(doc.id).undo();
    });
    expect(current(doc).record.features).toEqual([]);
  });

  it('designs ranked pairs for a typed region and explains the score of each', async () => {
    render(<Panel doc={openPuc19()} />);
    const [start, end] = [screen.getByLabelText('Region start'), screen.getByLabelText('Region end')];
    fireEvent.input(start, { target: { value: '1001' } });
    fireEvent.input(end, { target: { value: '1400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    const grid = await screen.findByRole('grid', { name: 'Designed primer pairs' }, { timeout: 5000 });
    expect(within(grid).getAllByRole('row').length).toBeGreaterThan(2);
    expect(screen.getByText(/The penalty is a sum, and lower is better/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use in the fields above' }));
    expect(sequenceBoxes()[0]?.value).toHaveLength(20);
    expect(sequenceBoxes()[1]?.value).toHaveLength(20);
  });

  it('shows the reaction conditions only in advanced mode', () => {
    render(<Panel doc={openPuc19()} />);
    expect(screen.queryByText(/Reaction conditions/)).toBeNull();
    cleanup();
    updateSettings({ mode: 'advanced' });
    render(<Panel doc={openPuc19()} />);
    expect(screen.getByText(/Reaction conditions/)).toBeTruthy();
    expect((screen.getByLabelText('Mg²⁺ (mM)') as HTMLInputElement).value).toBe('1.5');
  });
});
