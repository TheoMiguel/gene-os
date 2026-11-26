/** A value a table cell can hold. */
export type Cell = string | number | boolean | null | undefined;

/** A column of an exported table. The table component's columns fit this shape. */
export interface ExportColumn<Row> {
  readonly id: string;
  readonly header: string;
  /** The raw value, not the display text: numbers keep their full precision. */
  readonly value: (row: Row) => Cell;
}

const NUMBER_LIKE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Text of a cell. A string that a spreadsheet would run as a formula (it starts with `=`, `@`, a tab or a
 * carriage return, or with `+` or `-` and is not a number) gets a leading apostrophe, so opening an export
 * cannot execute anything.
 */
function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell !== 'string') return String(cell);
  const first = cell[0];
  const formula =
    first === '=' ||
    first === '@' ||
    first === '\t' ||
    first === '\r' ||
    ((first === '+' || first === '-') && !NUMBER_LIKE.test(cell));
  return formula ? `'${cell}` : cell;
}

function csvField(cell: Cell): string {
  const text = cellText(cell);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const tsvField = (cell: Cell) => cellText(cell).replace(/[\t\r\n]+/g, ' ');

function delimited<Row>(
  columns: readonly ExportColumn<Row>[],
  rows: readonly Row[],
  field: (cell: Cell) => string,
  separator: string,
  lineEnd: string,
): string {
  const lines = new Array<string>(rows.length + 1);
  lines[0] = columns.map((column) => field(column.header)).join(separator);
  rows.forEach((row, index) => {
    lines[index + 1] = columns.map((column) => field(column.value(row))).join(separator);
  });
  return lines.join(lineEnd) + lineEnd;
}

/** Comma-separated values with a header row, quoted as RFC 4180 asks and ended with CRLF. */
export function toCsv<Row>(columns: readonly ExportColumn<Row>[], rows: readonly Row[]): string {
  return delimited(columns, rows, csvField, ',', '\r\n');
}

/** Tab-separated values with a header row. A tab or a line break inside a cell becomes a space. */
export function toTsv<Row>(columns: readonly ExportColumn<Row>[], rows: readonly Row[]): string {
  return delimited(columns, rows, tsvField, '\t', '\n');
}

/** A JSON array with one object per row, keyed by column id, holding the raw values. */
export function toJson<Row>(columns: readonly ExportColumn<Row>[], rows: readonly Row[]): string {
  const objects = rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column.id, column.value(row) ?? null])),
  );
  return `${JSON.stringify(objects, null, 2)}\n`;
}

export type TableFormat = 'csv' | 'tsv' | 'json';

export const TABLE_FORMATS: Readonly<
  Record<TableFormat, { readonly extension: string; readonly mimeType: string }>
> = {
  csv: { extension: 'csv', mimeType: 'text/csv' },
  tsv: { extension: 'tsv', mimeType: 'text/tab-separated-values' },
  json: { extension: 'json', mimeType: 'application/json' },
};

/** The table in one of the export formats. */
export function serializeTable<Row>(
  format: TableFormat,
  columns: readonly ExportColumn<Row>[],
  rows: readonly Row[],
): string {
  return { csv: toCsv, tsv: toTsv, json: toJson }[format](columns, rows);
}
