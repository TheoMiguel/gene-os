// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { PUC19 } from '../../../../tests/fixtures/restriction/fixtures';
import { linearLocation } from '../../../engine/location';
import type { Feature, SeqRecord } from '../../../engine/types';
import { type SeqDocument, workspace } from '../../../state/documents';
import { updateSettings } from '../../../state/settings';
import { redo, undo, viewOf } from '../../../state/view';
import { Panel } from '../features';

const record = (patch: Partial<SeqRecord> = {}): SeqRecord => ({
  id: 'r',
  name: 'demo',
  description: '',
  alphabet: 'dna',
  topology: 'circular',
  seq: 'ACGT'.repeat(10),
  features: [],
  metadata: {},
  ...patch,
});

function Harness({ id }: { readonly id: string }) {
  const doc = workspace.documents.value.find((candidate) => candidate.id === id) as SeqDocument;
  return <Panel doc={doc} />;
}

const open = (rec: SeqRecord) => {
  const id = workspace.open(rec);
  render(<Harness id={id} />);
  return id;
};
const featuresOf = (id: string) => workspace.documents.peek().find((d) => d.id === id)?.record.features ?? [];
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

beforeEach(() => updateSettings({ language: 'en', mode: 'default' }));
afterEach(() => {
  cleanup();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
});

describe('annotation editor', () => {
  it('adds a feature across the origin of a circular molecule, and undo and redo follow', () => {
    const id = open(record());
    fireEvent.click(screen.getByRole('button', { name: 'Add feature' }));
    fireEvent.input(field('Name'), { target: { value: 'wrapper' } });
    fireEvent.input(field('From'), { target: { value: '38' } });
    fireEvent.input(field('To'), { target: { value: '3' } });
    expect(screen.getByText(/join\(38\.\.40,1\.\.3\), 6 bp\. Crosses the origin\./)).toBeTruthy();

    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    expect(featuresOf(id)).toHaveLength(1);
    expect(featuresOf(id)[0]).toMatchObject({
      name: 'wrapper',
      origin: 'user',
      location: {
        segments: [
          { start: 37, end: 40 },
          { start: 0, end: 3 },
        ],
        strand: 1,
      },
    });

    undo();
    expect(featuresOf(id)).toHaveLength(0);
    redo();
    expect(featuresOf(id)).toHaveLength(1);
  });

  it('starts a new feature from the shared selection', () => {
    const id = workspace.open(record());
    viewOf(id).select(4, 12);
    render(<Harness id={id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add feature' }));
    expect(field('From').value).toBe('5');
    expect(field('To').value).toBe('12');
  });

  it('shows why a coordinate is wrong and adds nothing', () => {
    const id = open(record({ topology: 'linear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add feature' }));
    fireEvent.input(field('Name'), { target: { value: 'x' } });
    fireEvent.input(field('From'), { target: { value: '9' } });
    fireEvent.input(field('To'), { target: { value: '2' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    expect(screen.getByRole('alert').textContent).toMatch(/cannot come after the end/);
    expect(featuresOf(id)).toHaveLength(0);
  });

  it('edits a feature of the file in place and keeps its origin', () => {
    const stored: Feature = {
      id: 'f1',
      type: 'promoter',
      name: 'lac',
      location: linearLocation(0, 10, 1),
      origin: 'file',
    };
    const id = open(record({ features: [stored] }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'lac' }));
    fireEvent.input(field('Name'), { target: { value: 'lacZ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(featuresOf(id)).toEqual([{ ...stored, name: 'lacZ' }]);
    undo();
    expect(featuresOf(id)[0]?.name).toBe('lac');
  });

  it('asks before it deletes, and undo brings the feature back', () => {
    const stored: Feature = {
      id: 'f1',
      type: 'tag',
      name: 'His',
      location: linearLocation(0, 10, 1),
      origin: 'user',
    };
    const id = open(record({ features: [stored] }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'His' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(featuresOf(id)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(featuresOf(id)).toHaveLength(0);
    undo();
    expect(featuresOf(id)).toHaveLength(1);
  });

  it('selects the feature in the shared selection when its row is clicked', () => {
    const stored: Feature = {
      id: 'f1',
      type: 'tag',
      name: 'His',
      location: linearLocation(4, 10, -1),
      origin: 'user',
    };
    const id = open(record({ features: [stored] }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'His' }));
    expect(viewOf(id).selection.value).toEqual({ start: 4, end: 10, strand: -1 });
  });

  it('keeps a custom type in the source key', () => {
    const id = open(record());
    fireEvent.click(screen.getByRole('button', { name: 'Add feature' }));
    fireEvent.input(field('Name'), { target: { value: 'odd' } });
    fireEvent.change(
      within(document.querySelector('form') as HTMLFormElement).getByRole('combobox', { name: 'Type' }),
      { target: { value: 'custom' } },
    );
    fireEvent.input(field('Custom type'), { target: { value: 'my_kind' } });
    fireEvent.input(field('From'), { target: { value: '1' } });
    fireEvent.input(field('To'), { target: { value: '4' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    expect(featuresOf(id)[0]).toMatchObject({ type: 'custom', sourceKey: 'my_kind' });
  });
});

describe('detected features', () => {
  it('cannot be edited, and can be kept as the user own annotation', async () => {
    const id = open(record({ name: 'pUC19', seq: PUC19 }));
    const detectedRows = await waitFor(() => {
      const rows = screen
        .getAllByRole('row')
        .filter((row) => within(row).queryByRole('gridcell', { name: 'Detected' }));
      expect(rows.length).toBeGreaterThan(0);
      return rows;
    });
    const name = within(detectedRows[0] as HTMLElement).getAllByRole('gridcell')[0]?.textContent as string;
    fireEvent.click(detectedRows[0] as HTMLElement);

    expect(screen.getAllByText(/cannot be edited in place/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(featuresOf(id)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Keep as my own annotation' }));
    expect(featuresOf(id)).toHaveLength(1);
    expect(featuresOf(id)[0]).toMatchObject({ name, origin: 'user' });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });
});
