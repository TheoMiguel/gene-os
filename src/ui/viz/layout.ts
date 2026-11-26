/** Geometry of a sequence laid out in rows of `lineLength` bases, split in blocks of `blockSize` (0 = no blocks). */
export interface RowLayout {
  readonly length: number;
  readonly lineLength: number;
  readonly blockSize: number;
}

export function rowCount(layout: RowLayout): number {
  return Math.ceil(layout.length / layout.lineLength);
}

/** Row that holds base `position`. A caret at the very end belongs to the last row. */
export function rowOfPosition(position: number, layout: RowLayout): number {
  return Math.min(Math.floor(position / layout.lineLength), Math.max(0, rowCount(layout) - 1));
}

/** Text column of the base `offset` bases into a row: one extra column per block boundary before it. */
export function columnOfOffset(offset: number, blockSize: number): number {
  return blockSize > 0 ? offset + Math.floor(offset / blockSize) : offset;
}

/** Text columns a full row takes. */
export function rowColumns(lineLength: number, blockSize: number): number {
  return columnOfOffset(lineLength - 1, blockSize) + 1;
}

/**
 * Offset in a row of the base boundary nearest text column `column`: the inverse of `columnOfOffset`. A column
 * in the gap between two blocks maps to the start of the next block.
 */
export function offsetOfColumn(column: number, blockSize: number): number {
  const col = Math.max(0, Math.round(column));
  if (blockSize <= 0) return col;
  const block = Math.floor(col / (blockSize + 1));
  const within = col % (blockSize + 1);
  return within === blockSize ? (block + 1) * blockSize : block * blockSize + within;
}

/** Sequence position (a base boundary, `0..length`) under a point of the row layer. */
export function positionAtPoint(row: number, column: number, layout: RowLayout): number {
  const offset = Math.min(offsetOfColumn(column, layout.blockSize), layout.lineLength);
  return Math.min(Math.max(0, row) * layout.lineLength + offset, layout.length);
}

/** `text` with a space after every `blockSize` characters. */
export function blockify(text: string, blockSize: number): string {
  if (blockSize <= 0 || text.length <= blockSize) return text;
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += blockSize) parts.push(text.slice(i, i + blockSize));
  return parts.join(' ');
}

/** Digits needed to write the largest 1-based row start of the layout, for the number gutter. */
export function gutterDigits(layout: RowLayout): number {
  return String(Math.max(1, layout.length)).length;
}
