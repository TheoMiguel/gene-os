import type { SeqRecord } from '../engine/types';
import { readSequenceFile, readSequenceText } from '../formats';
import type { ReadResult } from '../formats/types';
import { workspace } from './documents';

/** What the user handed the new-sequence view: pasted text or a file. */
export type SequenceInput =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'file'; readonly file: File };

/** Why an input could not become a sequence. The UI translates each code. */
export type LoadErrorCode =
  | 'empty'
  | 'invalidCharacters'
  | 'accessionNeedsNetwork'
  | 'unknownFormat'
  | 'malformed'
  | 'readFailed';

export type LoadResult =
  | {
      readonly ok: true;
      readonly records: readonly SeqRecord[];
      /** Records the file holds beyond the ones opened, or 0. */
      readonly notOpened: number;
    }
  | { readonly ok: false; readonly error: LoadErrorCode };

/** Turns an input into records. Replaceable so tests and later phases can supply their own reader. */
export type SequenceLoader = (input: SequenceInput) => Promise<LoadResult>;

/** A file with more records than this opens its first ones only, so one drop cannot flood the tab bar. */
export const MAX_RECORDS_PER_INPUT = 50;

const ACCESSION = /^[A-Z]{1,6}_?\d{5,}(\.\d+)?$/i;

const ERROR_OF_READ: Readonly<Record<string, LoadErrorCode>> = {
  empty: 'empty',
  unknown_format: 'unknownFormat',
  malformed: 'malformed',
  no_sequence: 'invalidCharacters',
};

function toLoadResult(read: ReadResult): LoadResult {
  if (!read.ok) return { ok: false, error: ERROR_OF_READ[read.error.code] ?? 'malformed' };
  if (read.records.length === 0) return { ok: false, error: 'invalidCharacters' };
  return {
    ok: true,
    records: read.records.slice(0, MAX_RECORDS_PER_INPUT),
    notOpened: Math.max(0, read.records.length - MAX_RECORDS_PER_INPUT),
  };
}

/** Reads pasted text. A bare accession is rejected, because database lookup arrives in a later phase. */
export function loadText(text: string): LoadResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'empty' };
  if (ACCESSION.test(trimmed)) return { ok: false, error: 'accessionNeedsNetwork' };
  return toLoadResult(readSequenceText(text));
}

const fileLoader: SequenceLoader = async (input) => {
  if (input.kind === 'text') return loadText(input.text);
  try {
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    return toLoadResult(readSequenceFile(bytes, input.file.name));
  } catch {
    return { ok: false, error: 'readFailed' };
  }
};

let loader: SequenceLoader = fileLoader;

/** Replaces the loader, e.g. with a network-backed one. */
export function setSequenceLoader(next: SequenceLoader): void {
  loader = next;
}

/** Loads an input and opens every record it yielded, the last one active. */
export async function openSequence(input: SequenceInput): Promise<LoadResult> {
  const result = await loader(input);
  if (result.ok) for (const record of result.records) workspace.open(record);
  return result;
}
