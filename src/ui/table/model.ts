import type { Cell, ExportColumn } from '../export/tabular';

/** A column of the result table. It also serves as an export column: exports carry the raw `value`. */
export interface TableColumn<Row> extends ExportColumn<Row> {
  /** Already translated by the caller. */
  readonly header: string;
  /** How the column sorts. Default `text`. */
  readonly type?: 'text' | 'number';
  /** Text shown in the cell. Default: the value as text, nothing for a missing value. */
  readonly format?: (value: Cell, row: Row) => string;
  /** Width in px. Default 120. */
  readonly width?: number;
  /** Default: `end` for numbers, `start` for text. */
  readonly align?: 'start' | 'end';
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  /** Id of the sorted column. */
  readonly column: string;
  readonly direction: SortDirection;
}

export const DEFAULT_COLUMN_WIDTH = 120;

/** The text a cell shows. */
export function cellText<Row>(column: TableColumn<Row>, row: Row): string {
  const value = column.value(row);
  if (column.format) return column.format(value, row);
  return value === null || value === undefined ? '' : String(value);
}

/** Next sort state when the header of `column` is activated: ascending, then descending, then unsorted. */
export function nextSort(current: SortState | null, column: string): SortState | null {
  if (current?.column !== column) return { column, direction: 'asc' };
  return current.direction === 'asc' ? { column, direction: 'desc' } : null;
}

function sortKey<Row>(column: TableColumn<Row>, row: Row): number | string | null {
  const value = column.value(row);
  if (value === null || value === undefined || value === '') return null;
  if (column.type === 'number') {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(number) ? null : number;
  }
  return String(value).toLowerCase();
}

/**
 * Indexes into `rows` of the rows to show, in display order: those where any column's text contains `filter`
 * (ignoring case), sorted by `sort` with a stable sort. A missing value sorts last whichever way the column sorts.
 * Rows are never copied, so a restriction scan of hundreds of thousands of rows costs only the index array.
 */
export function visibleRowIndexes<Row>(
  rows: readonly Row[],
  columns: readonly TableColumn<Row>[],
  filter: string,
  sort: SortState | null,
): number[] {
  const needle = filter.trim().toLowerCase();
  let indexes: number[] = [];
  if (needle === '') indexes = Array.from({ length: rows.length }, (_, i) => i);
  else
    rows.forEach((row, i) => {
      if (columns.some((column) => cellText(column, row).toLowerCase().includes(needle))) indexes.push(i);
    });

  const column = sort && columns.find((candidate) => candidate.id === sort.column);
  if (!sort || !column) return indexes;

  const keys = indexes.map((i) => sortKey(column, rows[i] as Row));
  const sign = sort.direction === 'asc' ? 1 : -1;
  const order = Array.from(keys.keys()).sort((a, b) => {
    const left = keys[a] as number | string | null;
    const right = keys[b] as number | string | null;
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left < right ? -sign : sign;
  });
  indexes = order.map((position) => indexes[position] as number);
  return indexes;
}

/** Rows between two display positions, both included, in either order. */
export function positionRange(from: number, to: number): number[] {
  const low = Math.min(from, to);
  return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => low + i);
}
