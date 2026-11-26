import type { SeqRecord } from '../engine/types';
import { FormatError, plainRecord } from './internal';

/** Characters raw sequence text may hold besides letters: line numbers, spacing, gap and stop. */
const RAW_TEXT = /^[A-Za-z\d\s*-]*$/;

/** True when the text is plain sequence: letters, digits, whitespace, `*` and `-` only, with some letters. */
export function looksLikeRawSequence(text: string): boolean {
  return RAW_TEXT.test(text) && /[A-Za-z]/.test(text);
}

/**
 * Reads plain sequence text, as pasted from a page or a sequencing report: digits (positions) and whitespace
 * are dropped. Any other character makes the input malformed.
 */
export function readRaw(text: string, name: string): SeqRecord[] {
  if (!looksLikeRawSequence(text)) {
    const bad = /[^A-Za-z\d\s*-]/.exec(text);
    throw new FormatError('malformed', `"${bad?.[0] ?? ''}" is not a sequence letter`);
  }
  const seq = text.replace(/[\s\d]+/g, '').toUpperCase();
  return [plainRecord({ id: name, name, description: '', seq }, 'raw')];
}

/** Writes the bare sequence on one line. */
export function writeRaw(record: SeqRecord): string {
  return `${record.seq}\n`;
}
