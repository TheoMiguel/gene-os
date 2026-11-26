// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { makeRecord, randomDna } from '../../../../tests/fixtures/cloning/records';
import { workspace } from '../../../state/documents';
import { updateSettings } from '../../../state/settings';
import { viewOf } from '../../../state/view';
import { Panel } from '../cloning';
import { singleCutters } from './model';

// The form reads a document through its record and a region, never by copying or scanning the whole sequence.
describe('cloning view on a 5 Mb vector', { timeout: 60_000 }, () => {
  const size = 5_000_000;
  const clean = randomDna(size, 2026).replaceAll('GAATTC', 'GAATCC').replaceAll('GGATCC', 'GGAGCC');
  const seq = `${clean.slice(0, 2_500_000)}GAATTCACGTACGGATCC${clean.slice(2_500_000)}`;
  const vector = makeRecord('genome', seq, 'circular');

  afterEach(() => {
    cleanup();
    workspace.documents.value = [];
  });

  it('skips the enzyme scan of a vector too long to suggest cutters for', () => {
    const started = performance.now();
    expect(singleCutters(vector)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('designs a Gibson assembly into it and shows the result', async () => {
    updateSettings({ language: 'en', mode: 'default' });
    const vectorId = workspace.open(vector);
    const insertId = workspace.open(makeRecord('gene', randomDna(1500, 7), 'linear'));
    viewOf(insertId).select(100, 1100);
    const doc = workspace.documents.value.find((d) => d.id === vectorId);
    if (!doc) throw new Error('document missing');
    render(<Panel doc={doc} />);
    fireEvent.click(screen.getByLabelText(/^Gibson assembly/));
    fireEvent.input(screen.getByLabelText('First enzyme'), { target: { value: 'EcoRI' } });
    fireEvent.input(screen.getByLabelText('Second enzyme (optional)'), { target: { value: 'BamHI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Design the cloning' }));
    await waitFor(() => expect(screen.getByText(/Primers to order \(2\)/)).toBeTruthy(), { timeout: 50_000 });
    expect(screen.getByText(/Junctions \(/)).toBeTruthy();
  });
});
