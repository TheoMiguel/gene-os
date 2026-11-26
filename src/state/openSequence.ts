import type { SeqRecord } from '../engine/types';
import { workspace } from './documents';

/** What the user handed the new-sequence view: pasted text or a file. */
export type SequenceInput =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'file'; readonly file: File };

/** Why an input could not become a sequence. The UI translates each code. */
export type LoadErrorCode = 'empty' | 'invalidCharacters' | 'accessionNeedsNetwork' | 'readFailed';

export type LoadResult =
  | { readonly ok: true; readonly record: SeqRecord }
  | { readonly ok: false; readonly error: LoadErrorCode };

/** Turns an input into a record. The format readers replace the raw-DNA stub through `setSequenceLoader`. */
export type SequenceLoader = (input: SequenceInput) => Promise<LoadResult>;

const IUPAC_DNA = /^[ACGTURYSWKMBDHVN]*$/;
const ACCESSION = /^[A-Z]{1,6}_?\d{5,}(\.\d+)?$/i;
let untitled = 0;

/** Builds a linear DNA record from raw sequence text. FASTA header lines, digits and whitespace are ignored. */
export function parseRawDna(text: string, name?: string): LoadResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'empty' };
  if (ACCESSION.test(trimmed)) return { ok: false, error: 'accessionNeedsNetwork' };
  const lines = trimmed.split('\n');
  const first = lines[0] ?? '';
  const header = first.startsWith('>') ? first.slice(1).trim() : '';
  const seq = lines
    .filter((line) => !line.startsWith('>'))
    .join('')
    .replace(/[\s\d]/g, '')
    .toUpperCase();
  if (seq === '') return { ok: false, error: 'empty' };
  if (!IUPAC_DNA.test(seq)) return { ok: false, error: 'invalidCharacters' };
  untitled += 1;
  const label = name ?? (header.split(/\s/)[0] || `seq_${String(untitled).padStart(3, '0')}`);
  return {
    ok: true,
    record: {
      id: `rec-${untitled}`,
      name: label,
      description: header,
      alphabet: seq.includes('U') && !seq.includes('T') ? 'rna' : 'dna',
      topology: 'linear',
      seq,
      features: [],
      metadata: { sourceFormat: 'raw' },
    },
  };
}

const rawDnaLoader: SequenceLoader = async (input) => {
  if (input.kind === 'text') return parseRawDna(input.text);
  try {
    return parseRawDna(await input.file.text(), input.file.name.replace(/\.[^.]+$/, ''));
  } catch {
    return { ok: false, error: 'readFailed' };
  }
};

let loader: SequenceLoader = rawDnaLoader;

/** Replaces the loader, e.g. with the format-detecting readers. */
export function setSequenceLoader(next: SequenceLoader): void {
  loader = next;
}

/** Loads an input and, on success, opens it as a new active document. */
export async function openSequence(input: SequenceInput): Promise<LoadResult> {
  const result = await loader(input);
  if (result.ok) workspace.open(result.record);
  return result;
}
