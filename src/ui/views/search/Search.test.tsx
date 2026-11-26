// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { PUC19 } from '../../../../tests/fixtures/restriction/fixtures';
import type { SeqRecord } from '../../../engine/types';
import { type SeqDocument, workspace } from '../../../state/documents';
import { updateSettings } from '../../../state/settings';
import { viewOf } from '../../../state/view';
import { shortcuts } from '../../shortcuts';
import { Panel } from '../search';
import { focusSearchBox } from './findShortcut';

const record = (patch: Partial<SeqRecord> = {}): SeqRecord => ({
  id: 'r',
  name: 'pUC19',
  description: '',
  alphabet: 'dna',
  topology: 'circular',
  seq: PUC19,
  features: [],
  metadata: {},
  ...patch,
});

function Harness({ id }: { readonly id: string }) {
  const doc = workspace.documents.value.find((candidate) => candidate.id === id) as SeqDocument;
  return <Panel doc={doc} />;
}

const open = (rec: SeqRecord = record()) => {
  const id = workspace.open(rec);
  render(<Harness id={id} />);
  return id;
};
const box = () => screen.getByLabelText('Search', { selector: 'input' }) as HTMLInputElement;
const type = (text: string) => fireEvent.input(box(), { target: { value: text } });
const enter = (shiftKey = false) => fireEvent.keyDown(box(), { key: 'Enter', shiftKey });

beforeEach(() => updateSettings({ language: 'en', mode: 'default' }));
afterEach(() => {
  cleanup();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
});

describe('search view', () => {
  it('finds an IUPAC motif on pUC19 and feeds the shared hits', async () => {
    const id = open();
    type('CCWGG');
    enter();
    await waitFor(() => expect(screen.getByText(/^Hits: \d+/)).toBeTruthy());
    const hits = viewOf(id).hits.value;
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits)
      expect(['CCAGG', 'CCTGG']).toContain(PUC19.slice(hit.start, hit.start + hit.length));
  });

  it('walks through the hits with Enter and Shift+Enter, and selects each one', async () => {
    const id = open();
    type('GCGC');
    enter();
    await waitFor(() => expect(viewOf(id).hits.value.length).toBeGreaterThan(1));
    const starts = viewOf(id)
      .hits.value.map((hit) => hit.start)
      .sort((a, b) => a - b);
    await waitFor(() => expect(viewOf(id).selection.value?.start).toBe(starts[0]));

    enter();
    expect(viewOf(id).selection.value?.start).toBe(starts[1]);
    enter(true);
    expect(viewOf(id).selection.value?.start).toBe(starts[0]);
  });

  it('jumps to the Sequence view when a row is clicked', async () => {
    const id = open();
    type('GAATTC');
    enter();
    const cell = await screen.findByRole('gridcell', { name: '396' });
    fireEvent.click(cell);
    expect(workspace.documents.value.find((d) => d.id === id)?.activeTab).toBe('sequence');
    expect(viewOf(id).selection.value).toMatchObject({ start: 395, end: 401 });
  });

  it('shows the engine error next to the field for a bad expression, and keeps working', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Regular expression' }));
    type('(');
    enter();
    const alert = await screen.findByText(/The search failed: .*[Rr]egular expression|The search failed/);
    expect(alert.getAttribute('role')).toBe('alert');
    type('GAATTC');
    enter();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect((await screen.findAllByRole('gridcell', { name: '396' })).length).toBeGreaterThan(0);
  });

  it('answers an expression that matches everywhere with a capped list and the real total', async () => {
    updateSettings({ mode: 'advanced' });
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Regular expression' }));
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Most hits to keep' }), {
      target: { value: '50' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Most hits to keep' }), {
      target: { value: '50' },
    });
    type('.');
    enter();
    expect(await screen.findByText(/Showing the first 50 of 5,372 hits/)).toBeTruthy();
  });

  it('finds a restriction enzyme by name and says what it recognizes', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Restriction enzyme' }));
    type('EcoRI');
    enter();
    expect(await screen.findByText('EcoRI recognizes GAATTC')).toBeTruthy();
    expect(await screen.findByRole('gridcell', { name: '396' })).toBeTruthy();
  });

  it('searches the six-frame translation of a DNA record', async () => {
    const dna = `CC${'ATGAAAGAATTCGGT'}CC`;
    open(record({ seq: dna, topology: 'linear' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search in' }), {
      target: { value: 'translation' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
    type('KEF');
    enter();
    expect(await screen.findByRole('gridcell', { name: '+3' })).toBeTruthy();
    expect(screen.getAllByRole('gridcell', { name: 'KEF' }).length).toBeGreaterThan(0);
  });

  it('opens with the box focused on Ctrl+F from any tab', () => {
    const id = workspace.open(record());
    const handled = shortcuts.handle({
      key: 'f',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target: null,
      preventDefault: () => {},
    });
    expect(handled).toBe(true);
    expect(workspace.documents.value.find((d) => d.id === id)?.activeTab).toBe('search');
    render(<Harness id={id} />);
    expect(document.activeElement).toBe(box());
    expect(focusSearchBox.value).toBe(false);
  });
});
