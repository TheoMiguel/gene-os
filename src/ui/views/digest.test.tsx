// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { PUC19 } from '../../../tests/fixtures/restriction/fixtures';
import { setAnalysisBackend } from '../../state/analysis';
import { type SeqDocument, workspace } from '../../state/documents';
import { updateSettings } from '../../state/settings';
import { viewOf } from '../../state/view';
import { createInlineBackend } from '../../workers/client';
import { Panel } from './digest';

const openPuc19 = (): SeqDocument => {
  const id = workspace.open({
    id: 'puc19',
    name: 'pUC19',
    description: '',
    alphabet: 'dna',
    topology: 'circular',
    seq: PUC19,
    features: [],
    metadata: {},
  });
  return workspace.documents.value.find((doc) => doc.id === id) as SeqDocument;
};

const choose = async (name: string) => {
  const grid = await screen.findByRole('grid', { name: 'Restriction enzymes' });
  fireEvent.input(screen.getAllByLabelText('Filter rows')[0] as HTMLElement, { target: { value: name } });
  const cell = await within(grid).findByText(name, { selector: '[role="gridcell"]' });
  fireEvent.click(cell);
};

beforeEach(() => {
  updateSettings({ language: 'en' });
  setAnalysisBackend(createInlineBackend());
});
afterEach(() => {
  cleanup();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
  setAnalysisBackend(null);
});

describe('Digest & Gel view', () => {
  it('asks for an enzyme before it shows a gel', async () => {
    render(<Panel doc={openPuc19()} />);
    expect(await screen.findByText('The gel appears when you choose an enzyme.')).toBeTruthy();
    expect(screen.getByText(/Choose an enzyme in step 01/)).toBeTruthy();
  });

  it('shows the cut count of an enzyme before it is chosen', async () => {
    render(<Panel doc={openPuc19()} />);
    const grid = await screen.findByRole('grid', { name: 'Restriction enzymes' });
    fireEvent.input(screen.getAllByLabelText('Filter rows')[0] as HTMLElement, {
      target: { value: 'PvuII' },
    });
    const row = (await within(grid).findByText('PvuII', { selector: '[role="gridcell"]' })).closest(
      '[role="row"]',
    );
    const cells = [...(row?.querySelectorAll('[role="gridcell"]') ?? [])].map((c) => c.textContent);
    expect(cells).toContain('2');
  });

  it('digests pUC19 with EcoRI and HindIII into 51 and 2,635 bp, in the table and on the gel', async () => {
    const doc = openPuc19();
    render(<Panel doc={doc} />);
    await choose('EcoRI');
    await choose('HindIII');
    const fragments = await screen.findByRole('grid', { name: 'Digest fragments' });
    await waitFor(() => {
      const text = fragments.textContent ?? '';
      expect(text).toContain('51');
      expect(text).toContain('2,635');
      expect(text).toContain("EcoRI · 5' overhang AATT");
    });
    expect(screen.getByRole('img', { name: /Virtual agarose gel with 4 lanes/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'EcoRI+HindIII: 51 bp' })).toBeTruthy();
  });

  it('selecting a band selects the fragment in the shared selection and shows its sequence', async () => {
    const doc = openPuc19();
    render(<Panel doc={doc} />);
    await choose('EcoRI');
    await choose('HindIII');
    fireEvent.click(await screen.findByRole('button', { name: 'EcoRI+HindIII: 51 bp' }));
    const selection = viewOf(doc.id).selection.value;
    expect(selection && selection.end - selection.start).toBe(51);
    const box = (await screen.findByLabelText('Fragment sequence')) as HTMLTextAreaElement;
    expect(box.value).toHaveLength(51);
    expect(box.value).toBe(PUC19.slice(selection?.start, selection?.end));
  });

  it('keeps the chosen enzymes when the view is shown again', async () => {
    const doc = openPuc19();
    const first = render(<Panel doc={doc} />);
    await choose('EcoRI');
    first.unmount();
    render(<Panel doc={doc} />);
    expect(await screen.findByRole('button', { name: 'Remove EcoRI' })).toBeTruthy();
  });
});
