// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { EGFP, PUC19_RECORD, templateWith } from '../../../../tests/fixtures/cloning/records';
import { workspace } from '../../../state/documents';
import { updateSettings } from '../../../state/settings';
import { viewOf } from '../../../state/view';
import { Panel } from '../cloning';

const insertRecord = templateWith('egfpT', EGFP, 'EGFP', 11);

/** The vector first, then the insert with its core selected, as a student would have them open. */
function openPanel() {
  const vectorId = workspace.open(PUC19_RECORD);
  const insertId = workspace.open(insertRecord);
  viewOf(insertId).select(120, 120 + EGFP.length);
  const doc = workspace.documents.value.find((d) => d.id === vectorId);
  if (!doc) throw new Error('document missing');
  render(<Panel doc={doc} />);
  return { vectorId, insertId };
}

const method = (name: RegExp) => fireEvent.click(screen.getByLabelText(name));
/** Presses Design and waits for the designer, which runs off the main thread, to put its answer on screen. */
async function design() {
  fireEvent.click(screen.getByRole('button', { name: 'Design the cloning' }));
  await waitFor(() => {
    expect(screen.queryByText(/Designing\.\.\./)).toBeNull();
    expect(document.querySelector('.clone-result, .clone-standalone')).not.toBeNull();
  });
}

beforeEach(() => updateSettings({ language: 'en', mode: 'default' }));
afterEach(() => {
  cleanup();
  workspace.documents.value = [];
  workspace.activeId.value = null;
});

describe('cloning view', () => {
  it('names the selected region as the insert and the open plasmid as the vector', async () => {
    openPanel();
    expect(screen.getByText(`Using egfpT:121-${120 + EGFP.length}, ${EGFP.length} bp.`)).toBeTruthy();
    expect(screen.getByText('Using pUC19, 2,686 bp.')).toBeTruthy();
  });

  it('lists the seven methods, each with a sentence about what it is for', async () => {
    openPanel();
    const names = [
      'Restriction and ligation',
      'Gibson assembly',
      'Golden Gate',
      'Gateway',
      'TOPO',
      'In-Fusion',
      'Ligation-independent',
    ];
    for (const name of names) expect(screen.getByText(new RegExp(`^${name}`))).toBeTruthy();
    expect(screen.getByText(/pick it for simple, cheap cloning/)).toBeTruthy();
  });

  it('designs a restriction cloning: primers with melting temperatures, fragments, a map and the junctions', async () => {
    openPanel();
    await design();
    const primers = screen.getByRole('grid', { name: 'Primers' });
    expect(
      within(primers)
        .getAllByRole('row')
        .filter((r) => r.classList.contains('table-row')),
    ).toHaveLength(2);
    expect(screen.getByText(/Primers to order \(2\)/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /Circular map of/ })).toBeTruthy();
    expect(screen.getByText(/Junctions \(2\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy order list' })).toBeTruthy();
  });

  it('opens the simulated construct as a new document', async () => {
    openPanel();
    await design();
    const before = workspace.documents.value.length;
    fireEvent.click(screen.getByRole('button', { name: 'Open construct as a new document' }));
    expect(workspace.documents.value).toHaveLength(before + 1);
    expect(workspace.documents.value.at(-1)?.record.topology).toBe('circular');
  });

  it('designs a Gibson assembly once the vector is opened with an enzyme', async () => {
    openPanel();
    method(/^Gibson assembly/);
    await design();
    expect(screen.getByRole('alert').textContent).toMatch(
      /Name at least one enzyme that cuts the vector once/,
    );
    fireEvent.input(screen.getByLabelText('First enzyme'), { target: { value: 'EcoRI' } });
    await design();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Primers to order \(2\)/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /Circular map of/ })).toBeTruthy();
  });

  it('says what a Gateway vector must look like when the vector is not one', async () => {
    openPanel();
    method(/^Gateway/);
    expect(screen.getByText(/exactly two att sites, and carry a feature named ccdB/)).toBeTruthy();
    await design();
    expect(screen.getByRole('alert').textContent).toMatch(/exactly two att sites, and pUC19 has 0/);
  });

  it('asks for the TOPO insertion point instead of failing silently', async () => {
    openPanel();
    method(/^TOPO/);
    await design();
    expect(screen.getByRole('alert').textContent).toMatch(/Enter the insertion point in the vector/);
  });

  it('tells a student which sentence to act on when the insert is cut by the enzyme', async () => {
    openPanel();
    updateSettings({ mode: 'advanced' });
    cleanup();
    openPanel();
    fireEvent.input(screen.getByLabelText('First enzyme'), { target: { value: 'NotAnEnzyme' } });
    await design();
    expect(screen.getByRole('alert').textContent).toMatch(/The enzyme NotAnEnzyme is not in the enzyme list/);
  });

  it('warns when no region is selected but the insert is set to the selection', async () => {
    const vectorId = workspace.open(PUC19_RECORD);
    const insertId = workspace.open(insertRecord);
    viewOf(insertId).select(120, 400);
    const doc = workspace.documents.value.find((d) => d.id === vectorId);
    if (!doc) throw new Error('document missing');
    render(<Panel doc={doc} />);
    viewOf(insertId).clearSelection();
    await screen.findByText(/nothing is selected/);
    await design();
    expect(screen.getByRole('alert').textContent).toMatch(/nothing is selected/);
  });
});
