// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { PUC19 } from '../../../tests/fixtures/restriction/fixtures';
import { circularLocation, linearLocation } from '../../engine/location';
import type { Feature, SeqRecord } from '../../engine/types';
import { setAnalysisBackend } from '../../state/analysis';
import { type SeqDocument, workspace } from '../../state/documents';
import { updateSettings } from '../../state/settings';
import { viewOf } from '../../state/view';
import { Panel } from './sequence';
import { prefsOf } from './sequence/state';

const feature = (
  id: string,
  name: string,
  start: number,
  end: number,
  strand: 1 | -1,
  type: Feature['type'] = 'CDS',
): Feature => ({ id, type, name, origin: 'file', location: linearLocation(start, end, strand) });

const FEATURES: Feature[] = [
  feature('amp', 'AmpR', 1625, 2486, -1, 'resistance'),
  feature('mcs', 'MCS', 395, 452, 1, 'misc_feature'),
  {
    id: 'wrap',
    type: 'promoter',
    name: 'wrapProm',
    origin: 'file',
    location: circularLocation(2600, 186, PUC19.length, 1),
  },
  feature('m13', 'M13 fwd', 2480, 2497, 1, 'primer_bind'),
];

const record = (overrides: Partial<SeqRecord> = {}): SeqRecord => ({
  id: 'puc19',
  name: 'pUC19',
  description: '',
  alphabet: 'dna',
  topology: 'circular',
  seq: PUC19,
  features: FEATURES,
  metadata: {},
  ...overrides,
});

function open(rec: SeqRecord = record()): SeqDocument {
  const id = workspace.open(rec);
  return workspace.documents.value.find((doc) => doc.id === id) as SeqDocument;
}

const size = { width: 1200, height: 800 };
let clipboard: string[] = [];

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => size.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => size.height,
  });
});

beforeEach(() => {
  updateSettings({ language: 'en', mode: 'default' });
  size.width = 1200;
  size.height = 800;
  clipboard = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        clipboard.push(text);
      },
    },
  });
});

afterEach(() => {
  cleanup();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
  setAnalysisBackend(null);
});

const settle = () => act(async () => undefined);
const rowsWith = (className: string) => [...document.querySelectorAll(`.table-row.${className}`)];
const enzymesOf = (rows: Element[]) => rows.map((row) => row.querySelector('.table-cell')?.textContent);
const element = (id: string) => document.querySelector(`[data-id="${id}"]`) as Element;
const rowCount = () =>
  Number(
    /^([\d,]+) of/.exec(document.querySelector('.table-count')?.textContent ?? '')?.[1]?.replace(',', ''),
  );

describe('the sequence view layout', () => {
  it('shows the map, the text and the list together in a wide window', async () => {
    render(<Panel doc={open()} />);
    expect(screen.getByRole('heading', { name: '01 // Map' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '02 // Sequence' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '03 // Restriction sites' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Sequence of pUC19' })).toBeTruthy();
    expect(await screen.findByRole('grid', { name: 'Restriction sites' })).toBeTruthy();
    expect(document.querySelector('.map-center-name')?.textContent).toBe('pUC19');
    expect(document.querySelector('.map-center-length')?.textContent).toBe('2,686 bp');
    expect(screen.getByRole('separator', { name: 'Resize map and panes' })).toBeTruthy();
  });

  it('shows one pane at a time in a narrow window, with a switch between them', async () => {
    size.width = 390;
    render(<Panel doc={open()} />);
    expect(screen.getByRole('heading', { name: '01 // Map' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '02 // Sequence' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'All' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Sites' }));
    expect(await screen.findByRole('grid', { name: 'Restriction sites' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '01 // Map' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Sequence' }));
    expect(screen.getByRole('textbox', { name: 'Sequence of pUC19' })).toBeTruthy();
  });

  it('moves a splitter with the arrow keys', () => {
    const doc = open();
    render(<Panel doc={doc} />);
    const bar = screen.getByRole('separator', { name: 'Resize map and panes' });
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(prefsOf(doc.id).split.value.col).toBeCloseTo(0.47, 9);
    for (let i = 0; i < 30; i++) fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(prefsOf(doc.id).split.value.col).toBeCloseTo(0.22, 9);
  });
});

describe('one selection across the panes', () => {
  it('selects a feature clicked on the map: the shared selection, the readout, the scroll request and the list', async () => {
    const doc = open();
    render(<Panel doc={doc} />);
    await screen.findByRole('grid', { name: 'Restriction sites' });
    fireEvent.click(element('f:amp'));
    const view = viewOf(doc.id);
    expect(view.selection.value).toEqual({ start: 1625, end: 2486, strand: -1 });
    expect(view.revealRequest.value?.position).toBe(1625);
    expect(screen.getByText('1,626–2,486')).toBeTruthy();
    expect(screen.getByText('861 bp')).toBeTruthy();
    expect(document.querySelector('.map-selection')).not.toBeNull();
    const marked = enzymesOf(rowsWith('highlighted'));
    expect(marked).toContain('AhdI');
    expect(marked).not.toContain('EcoRI');
  });

  it('selects a feature that crosses the origin as its longest part', async () => {
    const doc = open();
    render(<Panel doc={doc} />);
    fireEvent.click(element('f:wrap'));
    expect(viewOf(doc.id).selection.value).toMatchObject({ start: 0, end: 100 });
    expect(viewOf(doc.id).revealRequest.value?.position).toBe(2600);
  });

  it('picks the enzyme of a restriction tick: its site is selected and its row in the list is marked', async () => {
    const doc = open();
    render(<Panel doc={doc} />);
    await screen.findByRole('grid', { name: 'Restriction sites' });
    fireEvent.click(element('s:EcoRI:395'));
    expect(viewOf(doc.id).selection.value).toMatchObject({ start: 395, end: 401 });
    expect([...prefsOf(doc.id).picked.value]).toEqual(['EcoRI']);
    expect(enzymesOf(rowsWith('highlighted'))).toContain('EcoRI');
    expect(document.querySelector('.map-tick.picked')).not.toBeNull();
  });

  it('selects the site and marks it on the map when a list row is clicked', async () => {
    const doc = open();
    render(<Panel doc={doc} />);
    const grid = await screen.findByRole('grid', { name: 'Restriction sites' });
    const row = within(grid)
      .getAllByRole('row')
      .find((r) => r.textContent?.startsWith('EcoRI')) as HTMLElement;
    fireEvent.click(row);
    expect(viewOf(doc.id).selection.value).toMatchObject({ start: 395, end: 401 });
    expect([...prefsOf(doc.id).picked.value]).toEqual(['EcoRI']);
    expect(document.querySelector('.map-tick.picked')).not.toBeNull();
    expect(document.querySelector('.map-selection')).not.toBeNull();
  });

  it('marks the sites that the text selection covers', async () => {
    const doc = open();
    render(<Panel doc={doc} />);
    await screen.findByRole('grid', { name: 'Restriction sites' });
    act(() => viewOf(doc.id).select(390, 410));
    expect(enzymesOf(rowsWith('highlighted'))).toContain('EcoRI');
    act(() => viewOf(doc.id).clearSelection());
    expect(rowsWith('highlighted')).toHaveLength(0);
  });

  it('steps through the elements with the arrow keys and selects the focused one with Enter', () => {
    const doc = open();
    render(<Panel doc={doc} />);
    const stage = document.querySelector('.map-stage') as HTMLElement;
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    fireEvent.keyDown(stage, { key: 'Enter' });
    expect(viewOf(doc.id).selection.value).not.toBeNull();
    expect(document.querySelector('.map-stage [role="status"]')?.textContent).not.toBe('');
  });
});

describe('the restriction list', () => {
  it('lists cut position, strand, end type, overhang and cut count for the single cutters', async () => {
    render(<Panel doc={open()} />);
    const grid = await screen.findByRole('grid', { name: 'Restriction sites' });
    const row = within(grid)
      .getAllByRole('row')
      .find((r) => r.textContent?.startsWith('EcoRI')) as HTMLElement;
    expect([...row.querySelectorAll('[role="gridcell"]')].map((cell) => cell.textContent)).toEqual([
      'EcoRI',
      'GAATTC',
      '396',
      '+',
      "5' overhang",
      'AATT',
      '1',
    ]);
  });

  it('filters by end type, cut count and supplier, and shows the non-cutters on request', async () => {
    render(<Panel doc={open()} />);
    await screen.findByRole('grid', { name: 'Restriction sites' });
    expect(rowCount()).toBe(99);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blunt' }));
    expect(rowCount()).toBeGreaterThan(5);
    expect(rowCount()).toBeLessThan(99);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blunt' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Supplier' }), { target: { value: 'N' } });
    expect(rowCount()).toBeLessThan(99);
    fireEvent.change(screen.getByRole('combobox', { name: 'Supplier' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '1 (unique)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '0 (non-cutters)' }));
    expect(rowCount()).toBeGreaterThan(100);
    expect(screen.getByRole('grid', { name: 'Restriction sites' }).textContent).not.toContain('EcoRI');
  });

  it('opens its filters in a tall view and folds them in a short one', () => {
    size.height = 500;
    const doc = open();
    const short = render(<Panel doc={doc} />);
    expect((document.querySelector('.filter-box') as HTMLDetailsElement).open).toBe(false);
    short.unmount();
    size.height = 900;
    render(<Panel doc={doc} />);
    expect((document.querySelector('.filter-box') as HTMLDetailsElement).open).toBe(true);
  });
});

describe('the map', () => {
  it('draws the circular map for a circular molecule and the linear map for a linear one, with a manual override', () => {
    const { unmount } = render(<Panel doc={open()} />);
    expect(document.querySelector('.map-center-name')).not.toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Shape' }), { target: { value: 'linear' } });
    expect(document.querySelector('.map-center-name')).toBeNull();
    expect(document.querySelectorAll('.map-scale text').length).toBeGreaterThan(1);
    unmount();
    render(<Panel doc={open(record({ topology: 'linear', name: 'lin' }))} />);
    expect(document.querySelector('.map-center-name')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Shape' }), { target: { value: 'circular' } });
    expect(document.querySelector('.map-center-name')).not.toBeNull();
  });

  it('shows a tooltip with name, type, span and strand when the pointer is over an element', () => {
    render(<Panel doc={open()} />);
    fireEvent.pointerMove(element('f:amp'));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('AmpR');
    expect(tip.textContent).toContain('resistance');
    expect(tip.textContent).toContain('1,626–2,486');
    expect(tip.textContent).toContain('Reverse strand');
  });

  it('draws primer bindings as their own arrows, separate from the features', () => {
    render(<Panel doc={open()} />);
    expect(document.querySelectorAll('.map-arc.primer')).toHaveLength(1);
    expect(element('p:m13').getAttribute('class')).toContain('primer');
    expect(document.querySelector('[data-id="f:m13"]')).toBeNull();
  });

  it('draws only single cutters by default and more when asked', () => {
    render(<Panel doc={open()} />);
    const unique = document.querySelectorAll('.map-tick').length;
    expect(unique).toBeGreaterThan(20);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sites' }), { target: { value: 'all' } });
    expect(document.querySelectorAll('.map-tick').length).toBeGreaterThan(unique);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sites' }), { target: { value: 'none' } });
    expect(document.querySelectorAll('.map-tick')).toHaveLength(0);
  });

  it('zooms with the buttons and fits again', () => {
    render(<Panel doc={open()} />);
    const svg = document.querySelector('svg.map-svg') as SVGSVGElement;
    const fit = screen.getByRole('button', { name: 'Fit' }) as HTMLButtonElement;
    expect(fit.disabled).toBe(true);
    const before = svg.getAttribute('viewBox');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(svg.getAttribute('viewBox')).not.toBe(before);
    expect(fit.disabled).toBe(false);
    fireEvent.click(fit);
    expect(svg.getAttribute('viewBox')).toBe(before);
    expect(fit.disabled).toBe(true);
  });

  it('offers SVG and PNG export', () => {
    render(<Panel doc={open()} />);
    const map = screen.getByRole('heading', { name: '01 // Map' }).closest('section') as HTMLElement;
    expect(within(map).getByRole('button', { name: 'Save SVG' })).toBeTruthy();
    expect(within(map).getByRole('button', { name: 'Save PNG' })).toBeTruthy();
  });
});

describe('the sequence text controls', () => {
  it('switches between text, blocks, six frames and one frame', () => {
    const doc = open();
    render(<Panel doc={doc} />);
    const view = viewOf(doc.id);
    expect(view.frames.value).toEqual([]);
    fireEvent.click(screen.getByRole('radio', { name: 'Six frames' }));
    expect(view.frames.value).toEqual([1, 2, 3, -1, -2, -3]);
    fireEvent.click(screen.getByRole('radio', { name: 'One frame' }));
    expect(view.frames.value).toEqual([1]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Frame' }), { target: { value: '-2' } });
    expect(view.frames.value).toEqual([-2]);
    fireEvent.click(screen.getByRole('radio', { name: 'Blocks of 10' }));
    expect(view.frames.value).toEqual([]);
    expect(view.lineLength.value % 10).toBe(0);
    expect(document.querySelector('.seq-line')?.textContent).toMatch(/^\S{10} \S{10}/);
  });

  it('sets the line length by the width of the pane, or by a number the user picks', () => {
    const doc = open();
    render(<Panel doc={doc} />);
    const view = viewOf(doc.id);
    expect(view.lineLength.value % 10).toBe(0);
    fireEvent.click(screen.getByText('Options'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Bases per line' }), { target: { value: '90' } });
    expect(view.lineLength.value).toBe(90);
  });

  it('turns the layers on and off', () => {
    const doc = open();
    render(<Panel doc={doc} />);
    fireEvent.click(screen.getByText('Options'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Features' }));
    expect(viewOf(doc.id).overlays.value.feature).toBe(false);
    expect(viewOf(doc.id).overlays.value.restriction).toBe(true);
  });

  it('highlights search hits and steps through them', () => {
    const doc = open();
    render(<Panel doc={doc} />);
    fireEvent.input(screen.getByRole('searchbox', { name: 'Find' }), { target: { value: 'GAATTC' } });
    expect(viewOf(doc.id).hits.value.length).toBe(1);
    expect(screen.getByText('1 hits')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next hit' }));
    expect(viewOf(doc.id).selection.value).toMatchObject({ start: 395, end: 401 });
    fireEvent.input(screen.getByRole('searchbox', { name: 'Find' }), { target: { value: '' } });
    expect(viewOf(doc.id).hits.value).toEqual([]);
  });

  it('offers the genetic code only in advanced mode, and translates the selection with it', async () => {
    const doc = open(record({ seq: 'ATGTGAATAAGAAAACCC', features: [], topology: 'linear' }));
    render(<Panel doc={doc} />);
    fireEvent.click(screen.getByText('Options'));
    expect(screen.queryByRole('combobox', { name: 'Genetic code' })).toBeNull();
    act(() => updateSettings({ mode: 'advanced' }));
    const select = screen.getByRole('combobox', { name: 'Genetic code' });
    act(() => viewOf(doc.id).select(0, 12));
    fireEvent.click(screen.getByRole('button', { name: 'Copy translation' }));
    await settle();
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy translation' }));
    await settle();
    expect(clipboard[0]).toBe('M*IR');
    expect(clipboard[1]).toBe('MWM*');
  });

  it('shows two more columns in the list in advanced mode', async () => {
    render(<Panel doc={open()} />);
    await screen.findByRole('grid', { name: 'Restriction sites' });
    expect(screen.queryByRole('columnheader', { name: /Suppliers/ })).toBeNull();
    act(() => updateSettings({ mode: 'advanced' }));
    expect(screen.getByRole('columnheader', { name: /Suppliers/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Site start/ })).toBeTruthy();
  });

  it('jumps to a position the user types', () => {
    const doc = open();
    render(<Panel doc={doc} />);
    const input = screen.getByRole('textbox', { name: 'Go to' });
    fireEvent.input(input, { target: { value: '1,200' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(viewOf(doc.id).caret.value).toBe(1199);
    expect(viewOf(doc.id).revealRequest.value?.position).toBe(1199);
  });

  it('reads out length, GC content and melting temperature of the selection, and copies and translates it', async () => {
    const doc = open();
    render(<Panel doc={doc} />);
    act(() => viewOf(doc.id).select(395, 401));
    expect(screen.getByText('396–401')).toBeTruthy();
    expect(screen.getByText('6 bp')).toBeTruthy();
    expect(screen.getByText('GC 33.3%')).toBeTruthy();
    expect(screen.queryByText(/^Tm /)).toBeNull();
    act(() => viewOf(doc.id).select(395, 425));
    expect(screen.getByText(/^Tm \d+\.\d °C$/)).toBeTruthy();
    for (const name of ['Copy sequence', 'Copy reverse complement', 'Copy translation']) {
      fireEvent.click(screen.getByRole('button', { name }));
      await settle();
    }
    const slice = PUC19.slice(395, 425);
    expect(clipboard[0]).toBe(slice);
    expect(clipboard[1]).toMatch(/^[ACGT]{30}$/);
    expect(clipboard[1]).not.toBe(slice);
    expect(clipboard[2]).toMatch(/^[A-Z*]{10}$/);
  });

  it('disables the selection actions until something is selected', () => {
    render(<Panel doc={open()} />);
    for (const name of ['Copy sequence', 'Copy reverse complement', 'Copy translation', 'Save FASTA'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers no frames and no reverse complement for a protein', () => {
    render(
      <Panel
        doc={open(
          record({ alphabet: 'protein', seq: 'MKTAYIAKQRQISFVKSHFSRQ', topology: 'linear', features: [] }),
        )}
      />,
    );
    expect(screen.queryByRole('radio', { name: 'Six frames' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy reverse complement' })).toBeNull();
  });
});

describe('states and languages', () => {
  it('is translated', () => {
    updateSettings({ language: 'es' });
    render(<Panel doc={open()} />);
    expect(screen.getByRole('heading', { name: '03 // Sitios de restricción' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Seis marcos' })).toBeTruthy();
    act(() => updateSettings({ language: 'pt' }));
    expect(screen.getByRole('heading', { name: '03 // Sítios de restrição' })).toBeTruthy();
  });

  it('says what to do when the scan fails', async () => {
    setAnalysisBackend({
      start(job, done) {
        done(
          job.kind === 'restriction'
            ? { ok: false, reason: 'boom' }
            : { ok: true, value: { hits: [], total: 0 } },
        );
        return () => undefined;
      },
    });
    render(<Panel doc={open()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
  });

  it('says when no enzyme matches the filters', async () => {
    render(<Panel doc={open(record({ seq: 'ACGT'.repeat(40), features: [], topology: 'linear' }))} />);
    expect(await screen.findByText(/No enzyme matches these filters/)).toBeTruthy();
  });

  it('says there is nothing to draw for an empty sequence', () => {
    render(<Panel doc={open(record({ seq: '', features: [] }))} />);
    expect(screen.getByText('There is no sequence to draw.')).toBeTruthy();
  });

  it('keeps its settings when the tab is left and visited again', () => {
    const doc = open();
    const first = render(<Panel doc={doc} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Six frames' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Sites' }), { target: { value: 'few' } });
    first.unmount();
    render(<Panel doc={doc} />);
    expect((screen.getByRole('radio', { name: 'Six frames' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Sites' }) as HTMLSelectElement).value).toBe('few');
  });
});
