import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SeqRecord } from '../engine/types';
import { readSequenceFile } from '../formats';
import { en } from '../ui/i18n/en';
import { pickReportLabels, reportText } from './labels';

/** Vitest runs from the repository root, in the node and the jsdom environment alike. */
const FIXTURES = `${resolve(process.cwd(), 'tests/fixtures')}/`;

/** A record from a fixture file. */
export function fixtureRecord(file: string): SeqRecord {
  const read = readSequenceFile(new Uint8Array(readFileSync(`${FIXTURES}${file}`)), file);
  const record = read.ok ? read.records[0] : undefined;
  if (!record) throw new Error(`fixture ${file} did not read`);
  return record;
}

/** English report text, as the interface would build it. */
export const englishText = reportText(pickReportLabels(en));

/** `record` with its sequence replaced, features dropped and a new name. */
export function withSequence(record: SeqRecord, name: string, seq: string): SeqRecord {
  return { ...record, name, seq, features: [] };
}

export interface PdfCheck {
  readonly pages: number;
  readonly objects: number;
}

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

/**
 * Checks the structure of a PDF the way a strict viewer does: header, trailer, a cross-reference table whose
 * every offset lands on its object, stream lengths that match, and a page tree that counts its pages.
 * Throws with the first problem found.
 */
export function checkPdfStructure(bytes: Uint8Array): PdfCheck {
  const text = latin1(bytes);
  if (!text.startsWith('%PDF-1.')) throw new Error('missing %PDF header');
  if (!text.trimEnd().endsWith('%%EOF')) throw new Error('missing %%EOF');
  const startxref = /startxref\n(\d+)\n%%EOF\s*$/.exec(text);
  if (!startxref) throw new Error('missing startxref');
  const xrefAt = Number(startxref[1]);
  if (!text.startsWith('xref\n', xrefAt)) throw new Error('startxref does not point to the xref table');
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefAt));
  if (!header) throw new Error('bad xref header');
  const count = Number(header[1]);
  const entries = text
    .slice(xrefAt + header[0].length)
    .split('\n')
    .slice(0, count);
  entries.forEach((entry, n) => {
    if (n === 0) return;
    if (!/^\d{10} 00000 n $/.test(entry)) throw new Error(`bad xref entry ${n}: ${entry}`);
    const offset = Number(entry.slice(0, 10));
    if (!text.startsWith(`${n} 0 obj\n`, offset)) throw new Error(`object ${n} is not at offset ${offset}`);
  });
  if (!new RegExp(`/Size ${count}\\b`).test(text)) throw new Error('trailer /Size does not match the table');
  for (const match of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    if (text.slice(start + Number(match[1]), start + Number(match[1]) + 10) !== '\nendstream')
      throw new Error('stream length mismatch');
  }
  const pages = Number(/\/Type \/Pages [^>]*\/Count (\d+)/.exec(text)?.[1] ?? Number.NaN);
  const pageObjects = [...text.matchAll(/\/Type \/Page /g)].length;
  if (pages !== pageObjects) throw new Error(`page tree counts ${pages}, the file has ${pageObjects}`);
  return { pages, objects: count - 1 };
}
