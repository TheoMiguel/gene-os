import type { Alphabet, SeqRecord, SequenceFormat } from '../engine/types';
import type { ReadErrorCode, ReadWarning, ReadWarningCode } from './types';

/**
 * Raised by a reader when the input breaks its format. Only the entry points catch it and turn it into a
 * typed error result, so readers stay simple sequential code.
 */
export class FormatError extends Error {
  constructor(
    readonly code: ReadErrorCode,
    message: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = 'FormatError';
  }
}

/** Collects the warnings of one read. */
export class Warnings {
  readonly list: ReadWarning[] = [];

  add(code: ReadWarningCode, message: string, line?: number): void {
    this.list.push(line === undefined ? { code, message } : { code, message, line });
  }
}

const utf8 = new TextDecoder('utf-8');

/** Decodes file bytes as UTF-8 (invalid bytes become U+FFFD) without a byte-order mark. */
export function decodeText(bytes: Uint8Array): string {
  const text = utf8.decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Splits text into lines on LF, CRLF or CR. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** The file name without folders and without its last extension. */
export function fileStem(fileName: string | undefined): string {
  if (!fileName) return '';
  const base = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

// Letters that a nucleotide sequence may hold: bases, IUPAC ambiguity codes, gap and stop.
const NUCLEOTIDE = new Set('ACGTURYKMSWBDHVN-*');

/**
 * The alphabet of an upper-case sequence. A molecule type stated by the file wins for proteins; otherwise
 * any letter outside the IUPAC nucleotide codes means protein, and U without T means RNA.
 */
export function detectAlphabet(seq: string, molType?: string): Alphabet {
  if (molType?.toLowerCase().includes('protein')) return 'protein';
  let hasT = false;
  let hasU = false;
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i] as string;
    if (c === 'T') hasT = true;
    else if (c === 'U') hasU = true;
    else if (molType === undefined && !NUCLEOTIDE.has(c)) return 'protein';
  }
  return hasU && !hasT ? 'rna' : 'dna';
}

/**
 * Joins sequence text into one upper-case sequence. Whitespace and digits (line numbers) are dropped
 * silently; any other character that is not a letter, `*` or `-` is dropped with one warning.
 */
export function cleanSequence(parts: readonly string[], warnings: Warnings, line?: number): string {
  const joined = parts.join('');
  const cleaned = joined.replace(/[\s\d]+/g, '');
  const letters = cleaned.replace(/[^A-Za-z*-]+/g, '');
  if (letters.length !== cleaned.length) {
    warnings.add(
      'characters_removed',
      `${cleaned.length - letters.length} characters that are not sequence letters were removed`,
      line,
    );
  }
  return letters.toUpperCase();
}

/** Splits `text` into pieces of at most `size` characters. */
export function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/**
 * Wraps text into lines of at most `width` characters, breaking after one of `breakAfter` when possible
 * and hard-breaking a run with no break character.
 */
export function wrap(text: string, width: number, breakAfter = ' '): string[] {
  const lines: string[] = [];
  let rest = text;
  while (rest.length > width) {
    let cut = -1;
    for (let i = width; i > 0; i--) {
      if (breakAfter.includes(rest[i - 1] as string)) {
        cut = i;
        break;
      }
    }
    if (cut <= 0) cut = width;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  lines.push(rest);
  return lines;
}

/** The record name for a file without one: the file name, else "Untitled". */
export function fallbackName(fileName: string | undefined): string {
  return fileStem(fileName) || 'Untitled';
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Formats a calendar date as GenBank does: `07-JUL-2021`. */
export function insdcDate(year: number, month: number, day: number): string {
  return `${String(day).padStart(2, '0')}-${MONTHS[month - 1] ?? 'JAN'}-${year}`;
}

/** True for a GenBank/EMBL style date (`07-JUL-2021`). */
export function isInsdcDate(text: string): boolean {
  return /^\d{2}-[A-Z]{3}-\d{4}$/.test(text);
}

/** A record that holds only a sequence and its names (FASTA, raw text): linear, no features. */
export function plainRecord(
  fields: { readonly id: string; readonly name: string; readonly description: string; readonly seq: string },
  sourceFormat: SequenceFormat,
): SeqRecord {
  return {
    ...fields,
    alphabet: detectAlphabet(fields.seq),
    topology: 'linear',
    features: [],
    metadata: { sourceFormat },
  };
}

/** Bytes as a string with one character per byte (ASCII/Latin-1), built in slices to stay off the stack. */
export function latin1(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return parts.join('');
}
