import {
  type AlignAlphabet,
  type AlignMode,
  ColumnClass,
  consensus,
  type Difference,
  type GuideTree,
  type MatrixName,
  type MsaOptions,
  type MultipleAlignment,
  type PairwiseAlignment,
  type PairwiseOptions,
} from '../../../engine/align';
import { cleanSequence, detectAlphabet } from '../../../engine/alphabet';
import type { SelectionRange } from '../../../state/view';

/** One sequence offered to the aligner: a label and its residues, gaps and stops removed. */
export interface AlignItem {
  readonly key: string;
  readonly label: string;
  readonly seq: string;
}

/** What the user typed into the scoring fields. An empty field means "use the engine's default". */
export interface AlignSetup {
  /** Ids of the open documents that take part. */
  readonly picked: readonly string[];
  /** Ids of the documents that contribute only the region selected in the Sequence view. */
  readonly regionOnly: readonly string[];
  readonly pasted: string;
  readonly mode: AlignMode;
  readonly matrix: MatrixName;
  readonly match: string;
  readonly mismatch: string;
  readonly gapOpen: string;
  readonly gapExtend: string;
  readonly distance: NonNullable<MsaOptions['distance']>;
}

export const DEFAULT_SETUP: Omit<AlignSetup, 'picked'> = {
  regionOnly: [],
  pasted: '',
  mode: 'global',
  matrix: 'BLOSUM62',
  match: '',
  mismatch: '',
  gapOpen: '',
  gapExtend: '',
  distance: 'auto',
};

/** The scores the engine uses when a field is empty, shown as the field's placeholder. */
export const DEFAULT_SCORES = {
  dna: { match: 2, mismatch: -3, gapOpen: 5, gapExtend: 2 },
  protein: { gapOpen: 10, gapExtend: 0.5 },
} as const;

export const ALIGN_MODES: readonly AlignMode[] = ['global', 'local', 'overlap'];

/** A document as the aligner needs it. */
export interface AlignSource {
  readonly id: string;
  readonly name: string;
  readonly seq: string;
  readonly selection: SelectionRange | null;
}

const PASTED_LABEL = 'Pasted';

/** Residues of a pasted block: the first FASTA header names it, every other character that is not a letter is dropped. */
export function parsePasted(raw: string): { label: string; seq: string } | null {
  const lines = raw.split(/\r?\n/);
  const header = lines.find((line) => line.startsWith('>'));
  const body = lines.filter((line) => !line.startsWith('>')).join('\n');
  const seq = cleanSequence(body).replace(/[-*]/g, '');
  if (seq === '') return null;
  const label = header?.slice(1).trim().split(/\s+/)[0];
  return { label: label || PASTED_LABEL, seq };
}

/** The sequences to align, in the order the user picked them, pasted text last. */
export function buildItems(setup: AlignSetup, sources: readonly AlignSource[]): AlignItem[] {
  const items: AlignItem[] = [];
  for (const id of setup.picked) {
    const source = sources.find((s) => s.id === id);
    if (!source) continue;
    const region = setup.regionOnly.includes(id) ? source.selection : null;
    const text = region ? source.seq.slice(region.start, region.end) : source.seq;
    const seq = text.replace(/[-*]/g, '');
    if (seq === '') continue;
    items.push({
      key: id,
      label: region ? `${source.name}:${region.start + 1}-${region.end}` : source.name,
      seq,
    });
  }
  const pasted = parsePasted(setup.pasted);
  if (pasted) items.push({ key: 'pasted', label: pasted.label, seq: pasted.seq });
  return items;
}

/** DNA when every sequence reads as nucleotides, protein when all are protein, `mixed` otherwise. */
export function alphabetOf(items: readonly AlignItem[]): AlignAlphabet | 'mixed' {
  const kinds = new Set(items.map((item) => (detectAlphabet(item.seq) === 'protein' ? 'protein' : 'dna')));
  if (kinds.size > 1) return 'mixed';
  return kinds.has('protein') ? 'protein' : 'dna';
}

export type ScoreField = 'match' | 'mismatch' | 'gapOpen' | 'gapExtend';

export type ParsedScores =
  | { readonly ok: true; readonly options: PairwiseOptions & MsaOptions }
  | { readonly ok: false; readonly invalid: readonly ScoreField[] };

const parseNumber = (text: string): number | null | undefined => {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/** Turns the typed scoring fields into engine options. A gap penalty must be at least 0. */
export function parseScores(setup: AlignSetup, alphabet: AlignAlphabet): ParsedScores {
  const invalid: ScoreField[] = [];
  const read = (field: ScoreField, nonNegative: boolean) => {
    const value = parseNumber(setup[field]);
    if (value === null || (value !== undefined && nonNegative && value < 0)) invalid.push(field);
    return value ?? undefined;
  };
  const gapOpen = read('gapOpen', true);
  const gapExtend = read('gapExtend', true);
  const match = alphabet === 'dna' ? read('match', false) : undefined;
  const mismatch = alphabet === 'dna' ? read('mismatch', false) : undefined;
  if (invalid.length > 0) return { ok: false, invalid };
  const options: PairwiseOptions & MsaOptions = {
    alphabet,
    ...(alphabet === 'protein' ? { matrix: setup.matrix } : {}),
    ...(gapOpen === undefined ? {} : { gapOpen }),
    ...(gapExtend === undefined ? {} : { gapExtend }),
    ...(match === undefined ? {} : { match }),
    ...(mismatch === undefined ? {} : { mismatch }),
  };
  return { ok: true, options };
}

// ---------------------------------------------------------------------------
// The display model
// ---------------------------------------------------------------------------

/** Everything the grid and the exports draw: aligned rows, one class per column, and the multiple-alignment extras. */
export interface AlignmentDisplay {
  readonly kind: 'pair' | 'msa';
  readonly labels: readonly string[];
  readonly rows: readonly string[];
  readonly classes: Uint8Array;
  readonly length: number;
  /** Position in its own sequence of the first residue each row covers: a local alignment starts inside a sequence. */
  readonly starts: readonly number[];
  /** One letter per column. Multiple alignments only. */
  readonly consensus?: string;
  /** Share of rows holding the commonest residue of each column. Multiple alignments only. */
  readonly conservation?: Float64Array;
}

/** Display of a pairwise alignment. */
export function pairDisplay(alignment: PairwiseAlignment, labels: readonly string[]): AlignmentDisplay {
  return {
    kind: 'pair',
    labels,
    rows: [alignment.alignedA, alignment.alignedB],
    classes: alignment.classes,
    length: alignment.classes.length,
    starts: [alignment.startA, alignment.startB],
  };
}

/** Display of a multiple alignment, with its consensus row and conservation. */
export function msaDisplay(alignment: MultipleAlignment, labels: readonly string[]): AlignmentDisplay {
  return {
    kind: 'msa',
    labels,
    rows: alignment.rows,
    classes: alignment.classes,
    length: alignment.length,
    starts: alignment.rows.map(() => 0),
    consensus: consensus(alignment.rows, alignment.alphabet, { keepGapColumns: true }),
    conservation: alignment.conservation,
  };
}

/** Count of columns that hold a gap. */
export function gapColumnCount(classes: Uint8Array): number {
  let count = 0;
  for (const cls of classes) if (cls === ColumnClass.Gap) count++;
  return count;
}

const MATCH_CHARS = ['|', ':', '.', ' '] as const;

/** Match line of columns `[from, to)`: `|` identical, `:` similar, `.` mismatch, blank for a gap. */
export function matchLine(classes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let c = from; c < to; c++) out += MATCH_CHARS[classes[c] as number] ?? ' ';
  return out;
}

export interface ClassRun {
  readonly from: number;
  readonly to: number;
  readonly cls: number;
}

/** Runs of equal class inside columns `[from, to)`, so a window draws a few spans instead of one per column. */
export function classRuns(classes: Uint8Array, from: number, to: number): ClassRun[] {
  const runs: ClassRun[] = [];
  let start = from;
  for (let c = from + 1; c <= to; c++) {
    if (c === to || classes[c] !== classes[start]) {
      if (to > start) runs.push({ from: start, to: c, cls: classes[start] as number });
      start = c;
    }
  }
  return runs;
}

/** 0-based columns in `[from, to)` that carry a ruler label: the 10th, 20th, ... column. */
export function rulerTicks(from: number, to: number, step = 10): number[] {
  const ticks: number[] = [];
  for (let c = Math.ceil((from + 1) / step) * step - 1; c < to; c += step) ticks.push(c);
  return ticks;
}

/** Alignment column of every residue of a gapped row. */
export function residueColumns(row: string): Int32Array {
  let count = 0;
  for (let c = 0; c < row.length; c++) if (row[c] !== '-') count++;
  const columns = new Int32Array(count);
  let next = 0;
  for (let c = 0; c < row.length; c++) if (row[c] !== '-') columns[next++] = c;
  return columns;
}

/** 1-based residue number a column holds in its row, or null where the row has a gap. */
export function residueNumber(row: string, column: number, start = 0): number | null {
  if (row[column] === '-') return null;
  let count = 0;
  for (let c = 0; c < column; c++) if (row[c] !== '-') count++;
  return start + count + 1;
}

/** Columns a difference covers, as `[from, to)`. `colsA` and `colsB` come from `residueColumns`. */
export function differenceColumns(
  difference: Difference,
  colsA: Int32Array,
  colsB: Int32Array,
  startA: number,
  startB: number,
): { from: number; to: number } {
  if (difference.kind === 'insertion') {
    const from = colsB[difference.altStart - startB] ?? 0;
    return { from, to: from + difference.altEnd - difference.altStart };
  }
  const from = colsA[difference.refStart - startA] ?? 0;
  return { from, to: from + Math.max(1, difference.refEnd - difference.refStart) };
}

/** A fixed-point percentage such as `98.4`. */
export const percent = (value: number) => value.toFixed(1);

/** Cell counts as `2.5 G`, `100 M`, `4 k`. */
export function formatCells(cells: number): string {
  if (cells >= 1e9) return `${+(cells / 1e9).toPrecision(3)} G`;
  if (cells >= 1e6) return `${+(cells / 1e6).toPrecision(3)} M`;
  if (cells >= 1e3) return `${+(cells / 1e3).toPrecision(3)} k`;
  return String(Math.round(cells));
}

// ---------------------------------------------------------------------------
// Text exports
// ---------------------------------------------------------------------------

const FASTA_LINE = 60;

/** Names safe for FASTA and Clustal: no spaces, at most 30 characters, unique. */
export function uniqueNames(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const base = (label.replace(/\s+/g, '_').slice(0, 30) || 'seq').replace(/[(),:;]/g, '_');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base.slice(0, 27)}_${count + 1}`;
  });
}

/** The aligned rows as FASTA, gaps kept as `-`. */
export function toFasta(labels: readonly string[], rows: readonly string[]): string {
  const names = uniqueNames(labels);
  return rows
    .map((row, i) => {
      const lines: string[] = [`>${names[i]}`];
      for (let c = 0; c < row.length; c += FASTA_LINE) lines.push(row.slice(c, c + FASTA_LINE));
      return lines.join('\n');
    })
    .join('\n')
    .concat('\n');
}

const CLUSTAL_BLOCK = 60;
const CLUSTAL_MARKS = ['*', ':', ' ', ' '] as const;

/** The aligned rows as Clustal-style text: blocks of 60 columns, with `*` under identical and `:` under similar columns. */
export function toClustal(labels: readonly string[], rows: readonly string[], classes: Uint8Array): string {
  const names = uniqueNames(labels);
  const width = Math.max(16, ...names.map((n) => n.length)) + 1;
  const length = rows[0]?.length ?? 0;
  const out = ['CLUSTAL multiple sequence alignment by GENE_OS', ''];
  for (let from = 0; from < length; from += CLUSTAL_BLOCK) {
    const to = Math.min(length, from + CLUSTAL_BLOCK);
    for (const [i, row] of rows.entries())
      out.push(`${(names[i] as string).padEnd(width)}${row.slice(from, to)}`);
    let marks = '';
    for (let c = from; c < to; c++) marks += CLUSTAL_MARKS[classes[c] as number] ?? ' ';
    out.push(`${' '.repeat(width)}${marks}`, '');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Guide tree drawing
// ---------------------------------------------------------------------------

export interface TreeLayout {
  readonly width: number;
  readonly height: number;
  /** One SVG path per internal node: the vertical bar and the two horizontal arms. */
  readonly paths: readonly string[];
  readonly leaves: readonly { readonly index: number; readonly x: number; readonly y: number }[];
}

const TREE_ROW = 24;
const TREE_PAD = 12;

/** Lays a guide tree out as a left-to-right dendrogram: the root at the left, leaves at the right. */
export function layoutTree(tree: GuideTree, plotWidth = 280, labelChars = 12): TreeLayout {
  const heightOf = (node: GuideTree): number => ('leaf' in node ? 0 : node.height);
  const top = heightOf(tree);
  const x = (h: number) => TREE_PAD + (top === 0 ? plotWidth : ((top - h) / top) * plotWidth);
  const paths: string[] = [];
  const leaves: { index: number; x: number; y: number }[] = [];
  const walk = (node: GuideTree): number => {
    if ('leaf' in node) {
      const y = TREE_PAD + leaves.length * TREE_ROW + TREE_ROW / 2;
      leaves.push({ index: node.leaf, x: x(0), y });
      return y;
    }
    const upper = walk(node.left);
    const lower = walk(node.right);
    const here = x(node.height);
    const at = (value: number) => +value.toFixed(1);
    paths.push(
      `M${at(x(heightOf(node.left)))} ${at(upper)}H${at(here)}V${at(lower)}H${at(x(heightOf(node.right)))}`,
    );
    return (upper + lower) / 2;
  };
  walk(tree);
  return {
    width: TREE_PAD * 2 + plotWidth + 8 + labelChars * 7.2,
    height: TREE_PAD * 2 + leaves.length * TREE_ROW,
    paths,
    leaves,
  };
}
