import { cellText, nextSort, positionRange, type TableColumn, visibleRowIndexes } from './model';

interface Site {
  enzyme: string;
  position: number | null;
  cuts: number;
}

const columns: TableColumn<Site>[] = [
  { id: 'enzyme', header: 'Enzyme', value: (r) => r.enzyme },
  { id: 'position', header: 'Position', type: 'number', value: (r) => r.position },
  { id: 'cuts', header: 'Cuts', type: 'number', value: (r) => r.cuts, format: (v) => `${v}x` },
];

const rows: Site[] = [
  { enzyme: 'EcoRI', position: 396, cuts: 1 },
  { enzyme: 'bamHI', position: 417, cuts: 1 },
  { enzyme: 'HindIII', position: null, cuts: 1 },
  { enzyme: 'AluI', position: 10, cuts: 12 },
  { enzyme: 'Acc65I', position: 2, cuts: 2 },
];

describe('visibleRowIndexes', () => {
  it('lists every row, unfiltered and unsorted', () => {
    expect(visibleRowIndexes(rows, columns, '', null)).toEqual([0, 1, 2, 3, 4]);
    expect(visibleRowIndexes(rows, columns, '   ', null)).toEqual([0, 1, 2, 3, 4]);
  });

  it('filters on the shown text of any column, ignoring case', () => {
    expect(visibleRowIndexes(rows, columns, 'ECO', null)).toEqual([0]);
    expect(visibleRowIndexes(rows, columns, '12x', null)).toEqual([3]);
    expect(visibleRowIndexes(rows, columns, '41', null)).toEqual([1]);
    expect(visibleRowIndexes(rows, columns, 'zzz', null)).toEqual([]);
  });

  it('sorts numbers by value and text without regard to case', () => {
    expect(visibleRowIndexes(rows, columns, '', { column: 'position', direction: 'asc' })).toEqual([
      4, 3, 0, 1, 2,
    ]);
    expect(visibleRowIndexes(rows, columns, '', { column: 'enzyme', direction: 'asc' })).toEqual([
      4, 3, 1, 0, 2,
    ]);
    expect(visibleRowIndexes(rows, columns, '', { column: 'enzyme', direction: 'desc' })).toEqual([
      2, 0, 1, 3, 4,
    ]);
  });

  it('puts a missing value last whichever way the column sorts', () => {
    expect(visibleRowIndexes(rows, columns, '', { column: 'position', direction: 'desc' })).toEqual([
      1, 0, 3, 4, 2,
    ]);
  });

  it('is stable: equal values keep their original order', () => {
    expect(visibleRowIndexes(rows, columns, '', { column: 'cuts', direction: 'asc' })).toEqual([
      0, 1, 2, 4, 3,
    ]);
    expect(visibleRowIndexes(rows, columns, '', { column: 'cuts', direction: 'desc' })).toEqual([
      3, 4, 0, 1, 2,
    ]);
  });

  it('filters first, then sorts what is left, and ignores an unknown sort column', () => {
    expect(visibleRowIndexes(rows, columns, 'i', { column: 'position', direction: 'asc' })).toEqual([
      4, 3, 0, 1, 2,
    ]);
    expect(visibleRowIndexes(rows, columns, 'alu', { column: 'position', direction: 'desc' })).toEqual([3]);
    expect(visibleRowIndexes(rows, columns, '', { column: 'nope', direction: 'asc' })).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it('sorts numeric text of a number column as numbers', () => {
    const text: TableColumn<{ n: string }>[] = [{ id: 'n', header: 'n', type: 'number', value: (r) => r.n }];
    const data = [{ n: '10' }, { n: '9' }, { n: '100' }];
    expect(visibleRowIndexes(data, text, '', { column: 'n', direction: 'asc' })).toEqual([1, 0, 2]);
  });
});

describe('table helpers', () => {
  it('cycles the sort of a column ascending, descending, off, and restarts on another column', () => {
    const asc = nextSort(null, 'a');
    expect(asc).toEqual({ column: 'a', direction: 'asc' });
    const desc = nextSort(asc, 'a');
    expect(desc).toEqual({ column: 'a', direction: 'desc' });
    expect(nextSort(desc, 'a')).toBeNull();
    expect(nextSort(desc, 'b')).toEqual({ column: 'b', direction: 'asc' });
  });

  it('formats a cell with the column format, else as plain text', () => {
    expect(cellText(columns[2] as TableColumn<Site>, rows[3] as Site)).toBe('12x');
    expect(cellText(columns[1] as TableColumn<Site>, rows[2] as Site)).toBe('');
    expect(cellText(columns[1] as TableColumn<Site>, rows[0] as Site)).toBe('396');
  });

  it('lists the positions between two rows in either order', () => {
    expect(positionRange(2, 5)).toEqual([2, 3, 4, 5]);
    expect(positionRange(5, 3)).toEqual([3, 4, 5]);
    expect(positionRange(4, 4)).toEqual([4]);
  });
});

describe('performance', { timeout: 60_000 }, () => {
  it('filters and sorts 300 000 rows', () => {
    const many = Array.from({ length: 300_000 }, (_, i) => ({
      enzyme: `E${(i * 7919) % 1000}`,
      position: (i * 104_729) % 5_000_000,
      cuts: i % 5,
    }));
    const started = performance.now();
    const sorted = visibleRowIndexes(many, columns, '', { column: 'position', direction: 'asc' });
    const filtered = visibleRowIndexes(many, columns, 'e99', { column: 'enzyme', direction: 'desc' });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(sorted).toHaveLength(300_000);
    expect(many[sorted[0] as number]?.position).toBe(0);
    expect(many[sorted[299_999] as number]?.position).toBeGreaterThan(4_990_000);
    expect(filtered.length).toBeGreaterThan(0);
  });
});
