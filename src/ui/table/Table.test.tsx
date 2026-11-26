// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { updateSettings } from '../../state/settings';
import { notice } from '../actions';
import type { TableColumn } from './model';
import { ROW_HEIGHT, Table } from './Table';

interface Site {
  enzyme: string;
  position: number;
}

const columns: TableColumn<Site>[] = [
  { id: 'enzyme', header: 'Enzyme', value: (r) => r.enzyme },
  { id: 'position', header: 'Position', type: 'number', value: (r) => r.position },
];

const sites = (n: number): Site[] =>
  Array.from({ length: n }, (_, i) => ({ enzyme: `Enz${i}`, position: (i * 389) % 1000 }));

const shownRows = () => screen.queryAllByRole('row').filter((row) => row.classList.contains('table-row'));
const names = () => shownRows().map((row) => within(row).getAllByRole('gridcell')[0]?.textContent);
const grid = () => screen.getByRole('grid', { name: 'Sites' });

beforeEach(() => updateSettings({ language: 'en' }));
afterEach(() => {
  cleanup();
  notice.value = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Table', () => {
  it('shows headers, the row count and the first rows', () => {
    render(<Table label="Sites" columns={columns} rows={sites(5)} />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual([
      'Enzyme',
      'Position',
    ]);
    expect(screen.getByText('5 of 5 rows')).toBeTruthy();
    expect(names()).toEqual(['Enz0', 'Enz1', 'Enz2', 'Enz3', 'Enz4']);
  });

  it('draws only the rows in view for 300 000 rows and reaches the end by scrolling', () => {
    const { container } = render(<Table label="Sites" columns={columns} rows={sites(300_000)} />);
    expect(screen.getByText('300,000 of 300,000 rows')).toBeTruthy();
    expect(shownRows().length).toBeLessThan(25);
    expect(container.querySelector('.table-body')?.getAttribute('style')).toContain(
      `height: ${Math.min(300_000 * ROW_HEIGHT, 8_000_000)}px`,
    );

    fireEvent.keyDown(grid(), { key: 'End' });
    expect(names().at(-1)).toBe('Enz299999');
    fireEvent.keyDown(grid(), { key: 'Home' });
    expect(names()[0]).toBe('Enz0');
  });

  it('puts the header outside the virtual rows, so it stays when rows scroll', () => {
    render(<Table label="Sites" columns={columns} rows={sites(1000)} />);
    fireEvent.keyDown(grid(), { key: 'End' });
    const header = screen.getAllByRole('row')[0] as HTMLElement;
    expect(header.classList.contains('table-header')).toBe(true);
    expect(header.style.height).toBe('32px');
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
  });

  it('sorts by a header: ascending, descending, then back to the original order', () => {
    render(<Table label="Sites" columns={columns} rows={sites(6)} />);
    const sortByPosition = () => fireEvent.click(screen.getByRole('button', { name: /Position/ }));
    const header = () => screen.getByRole('columnheader', { name: /Position/ });

    sortByPosition();
    expect(header().getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toEqual(['Enz0', 'Enz3', 'Enz1', 'Enz4', 'Enz2', 'Enz5']);
    sortByPosition();
    expect(header().getAttribute('aria-sort')).toBe('descending');
    expect(names()).toEqual(['Enz5', 'Enz2', 'Enz4', 'Enz1', 'Enz3', 'Enz0']);
    sortByPosition();
    expect(header().getAttribute('aria-sort')).toBe('none');
    expect(names()).toEqual(['Enz0', 'Enz1', 'Enz2', 'Enz3', 'Enz4', 'Enz5']);
  });

  it('filters by text and says how many rows are left', () => {
    render(<Table label="Sites" columns={columns} rows={sites(50)} />);
    fireEvent.input(screen.getByRole('searchbox', { name: 'Filter rows' }), { target: { value: 'enz4' } });
    expect(names().sort()).toEqual(
      [
        'Enz4',
        'Enz40',
        'Enz41',
        'Enz42',
        'Enz43',
        'Enz44',
        'Enz45',
        'Enz46',
        'Enz47',
        'Enz48',
        'Enz49',
      ].sort(),
    );
    expect(screen.getByText('11 of 50 rows')).toBeTruthy();
    fireEvent.input(screen.getByRole('searchbox', { name: 'Filter rows' }), { target: { value: 'nothing' } });
    expect(screen.getByText('No rows to show.')).toBeTruthy();
  });

  it('calls back on a row click with the row and its index in the source, whatever the sort', () => {
    const onRowClick = vi.fn();
    render(
      <Table
        label="Sites"
        columns={columns}
        rows={sites(6)}
        onRowClick={onRowClick}
        initialSort={{ column: 'position', direction: 'desc' }}
      />,
    );
    fireEvent.click(shownRows()[0] as HTMLElement);
    expect(onRowClick).toHaveBeenCalledWith({ enzyme: 'Enz5', position: 945 }, 5);
  });

  describe('selection', () => {
    const open = (n = 10) => {
      const onSelectionChange = vi.fn();
      render(<Table label="Sites" columns={columns} rows={sites(n)} onSelectionChange={onSelectionChange} />);
      return onSelectionChange;
    };
    const selectedNames = () =>
      shownRows()
        .filter((r) => r.getAttribute('aria-selected') === 'true')
        .map((r) => within(r).getAllByRole('gridcell')[0]?.textContent);

    it('selects one row on click, adds with Ctrl-click and spans with Shift-click', () => {
      const onChange = open();
      fireEvent.click(shownRows()[2] as HTMLElement);
      expect(selectedNames()).toEqual(['Enz2']);
      fireEvent.click(shownRows()[5] as HTMLElement, { ctrlKey: true });
      expect(selectedNames()).toEqual(['Enz2', 'Enz5']);
      fireEvent.click(shownRows()[5] as HTMLElement, { ctrlKey: true });
      expect(selectedNames()).toEqual(['Enz2']);
      fireEvent.click(shownRows()[2] as HTMLElement);
      fireEvent.click(shownRows()[6] as HTMLElement, { shiftKey: true });
      expect(selectedNames()).toEqual(['Enz2', 'Enz3', 'Enz4', 'Enz5', 'Enz6']);
      expect(onChange).toHaveBeenLastCalledWith([2, 3, 4, 5, 6]);
      expect(screen.getByText(/5 selected/)).toBeTruthy();
    });

    it('moves with the arrow keys, extends with Shift and selects all with Ctrl+A', () => {
      const onChange = open();
      fireEvent.keyDown(grid(), { key: 'ArrowDown' });
      fireEvent.keyDown(grid(), { key: 'ArrowDown' });
      expect(selectedNames()).toEqual(['Enz2']);
      fireEvent.keyDown(grid(), { key: 'ArrowDown', shiftKey: true });
      expect(selectedNames()).toEqual(['Enz2', 'Enz3']);
      fireEvent.keyDown(grid(), { key: 'ArrowUp' });
      expect(selectedNames()).toEqual(['Enz2']);
      fireEvent.keyDown(grid(), { key: 'a', ctrlKey: true });
      expect(onChange).toHaveBeenLastCalledWith([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      fireEvent.keyDown(grid(), { key: ' ' });
      expect(onChange).toHaveBeenLastCalledWith([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((i) => i !== 2));
    });

    it('activates the active row with Enter and exposes it to assistive technology', () => {
      const onRowClick = vi.fn();
      render(<Table label="Sites" columns={columns} rows={sites(4)} onRowClick={onRowClick} />);
      fireEvent.keyDown(grid(), { key: 'ArrowDown' });
      fireEvent.keyDown(grid(), { key: 'Enter' });
      expect(onRowClick).toHaveBeenCalledWith({ enzyme: 'Enz1', position: 389 }, 1);
      expect(grid().getAttribute('aria-activedescendant')).toBe(shownRows()[1]?.id);
      expect(grid().tabIndex).toBe(0);
    });
  });

  describe('copy and export', () => {
    const copied = () => (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

    it('copies all the rows the filter leaves as TSV, with raw values', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      render(<Table label="Sites" columns={columns} rows={sites(3)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy TSV' }));
      await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(copied()).toBe('Enzyme\tPosition\nEnz0\t0\nEnz1\t389\nEnz2\t778\n');
      await vi.waitFor(() => expect(notice.value?.key).toBe('export.copied'));
    });

    it('copies only the selected rows, in display order', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      render(
        <Table
          label="Sites"
          columns={columns}
          rows={sites(5)}
          initialSort={{ column: 'position', direction: 'desc' }}
        />,
      );
      fireEvent.click(shownRows()[0] as HTMLElement);
      fireEvent.click(shownRows()[2] as HTMLElement, { ctrlKey: true });
      fireEvent.click(screen.getByRole('button', { name: 'Copy TSV' }));
      await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(copied()).toBe('Enzyme\tPosition\nEnz2\t778\nEnz1\t389\n');
    });

    it('copies the selection on Ctrl+C', () => {
      render(<Table label="Sites" columns={columns} rows={sites(5)} />);
      fireEvent.click(shownRows()[1] as HTMLElement);
      const store: Record<string, string> = {};
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.assign(event, {
        clipboardData: { setData: (type: string, value: string) => (store[type] = value) },
      });
      fireEvent(grid(), event);
      expect(store['text/plain']).toBe('Enzyme\tPosition\nEnz1\t389\n');
    });

    it.each([
      ['Export CSV', 'sites.csv', 'Enzyme,Position\r\nEnz0,0\r\nEnz1,389\r\n'],
      ['Export TSV', 'sites.tsv', 'Enzyme\tPosition\nEnz0\t0\nEnz1\t389\n'],
    ])('%s saves the filtered rows as %s', async (button, fileName, content) => {
      let saved: { name: string; blob: Blob } | undefined;
      URL.createObjectURL = vi.fn((blob: Blob) => {
        saved = { name: '', blob };
        return 'blob:x';
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        if (saved) saved.name = this.download;
      });
      render(<Table label="Sites" columns={columns} rows={sites(2)} exportName="sites" />);
      fireEvent.click(screen.getByRole('button', { name: button }));
      await vi.waitFor(() => expect(saved?.name).toBe(fileName));
      expect(await saved?.blob.text()).toBe(content);
    });

    it('exports JSON with raw typed values', async () => {
      let blob: Blob | undefined;
      URL.createObjectURL = vi.fn((b: Blob) => {
        blob = b;
        return 'blob:x';
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      render(<Table label="Sites" columns={columns} rows={sites(2)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
      await vi.waitFor(() => expect(blob).toBeDefined());
      expect(JSON.parse((await blob?.text()) ?? '')).toEqual([
        { enzyme: 'Enz0', position: 0 },
        { enzyme: 'Enz1', position: 389 },
      ]);
    });
  });
});
