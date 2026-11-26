import type { SeqRecord, SequenceFormat } from '../engine/types';
import { isAb1, readAb1 } from './ab1';
import { readEmbl, writeEmbl } from './embl';
import { readFasta, writeFasta } from './fasta';
import { readGenBank, writeGenBank } from './genbank';
import { decodeText, FormatError, fallbackName, splitLines, Warnings } from './internal';
import { looksLikeRawSequence, readRaw, writeRaw } from './raw';
import { isSnapGene, readSnapGene, writeSnapGene } from './snapgene';
import type { MultiRecordFormat, ReadResult, WritableFormat, WriteOutput } from './types';

export type * from './types';

/** File extensions (lower case, without the dot) that name a format when the content does not. */
const FORMAT_BY_EXTENSION: Readonly<Record<string, SequenceFormat>> = {
  gb: 'genbank',
  gbk: 'genbank',
  genbank: 'genbank',
  gbff: 'genbank',
  gp: 'genbank',
  gpk: 'genbank',
  embl: 'embl',
  emb: 'embl',
  fasta: 'fasta',
  fa: 'fasta',
  fas: 'fasta',
  fna: 'fasta',
  ffn: 'fasta',
  faa: 'fasta',
  frn: 'fasta',
  mpfa: 'fasta',
  dna: 'snapgene',
  ab1: 'ab1',
  abi: 'ab1',
  ab: 'ab1',
  txt: 'raw',
  seq: 'raw',
};

/** The format named by the first meaningful line of a text, if any. */
function formatOfText(lines: readonly string[]): SequenceFormat | undefined {
  for (const line of lines.slice(0, 50)) {
    if (line.startsWith('LOCUS ')) return 'genbank';
    if (line.startsWith('ID   ')) return 'embl';
    if (line.startsWith('>')) return 'fasta';
  }
  // A GenBank release file opens with a long header before its first record.
  return lines.some((l) => l.startsWith('LOCUS ')) ? 'genbank' : undefined;
}

function extensionOf(fileName: string | undefined): string {
  const dot = fileName?.lastIndexOf('.') ?? -1;
  return dot >= 0 ? (fileName as string).slice(dot + 1).toLowerCase() : '';
}

function readText(
  format: SequenceFormat,
  text: string,
  lines: readonly string[],
  name: string,
  warnings: Warnings,
): readonly SeqRecord[] {
  switch (format) {
    case 'genbank':
      return readGenBank(lines, warnings);
    case 'embl':
      return readEmbl(lines, warnings);
    case 'fasta':
      return readFasta(lines, warnings);
    default:
      return readRaw(text, name);
  }
}

/** Runs a reader and turns any failure into a typed error result: reading never throws on bad input. */
function run(
  format: SequenceFormat | undefined,
  read: (warnings: Warnings) => readonly SeqRecord[],
): ReadResult {
  const warnings = new Warnings();
  if (format === undefined) {
    return {
      ok: false,
      error: { code: 'unknown_format', message: 'the file is not a sequence format GENE_OS reads' },
      warnings: warnings.list,
    };
  }
  try {
    return { ok: true, format, records: read(warnings), warnings: warnings.list };
  } catch (error) {
    const fe =
      error instanceof FormatError
        ? error
        : new FormatError('malformed', error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      format,
      error:
        fe.line === undefined
          ? { code: fe.code, message: fe.message }
          : { code: fe.code, message: fe.message, line: fe.line },
      warnings: warnings.list,
    };
  }
}

const EMPTY: ReadResult = {
  ok: false,
  error: { code: 'empty', message: 'the input is empty' },
  warnings: [],
};

/**
 * Reads a sequence file. The format comes from the content first (ABIF magic, SnapGene cookie, LOCUS / ID /
 * `>` lines), then from the file extension, then plain sequence text is tried. Never throws on bad input:
 * the result is either the records with warnings, or a typed error.
 */
export function readSequenceFile(bytes: Uint8Array, fileName?: string): ReadResult {
  if (bytes.length === 0) return EMPTY;
  if (isAb1(bytes)) return run('ab1', (w) => readAb1(bytes, fileName, w));
  if (isSnapGene(bytes)) return run('snapgene', (w) => readSnapGene(bytes, fileName, w));
  const byExtension = FORMAT_BY_EXTENSION[extensionOf(fileName)];
  if (byExtension === 'ab1') return run('ab1', (w) => readAb1(bytes, fileName, w));
  if (byExtension === 'snapgene') return run('snapgene', (w) => readSnapGene(bytes, fileName, w));
  const text = decodeText(bytes);
  if (text.includes('\0')) return run(undefined, () => []);
  return readDecodedText(text, fileName, byExtension);
}

/**
 * Reads pasted text: FASTA, GenBank or EMBL by content, else plain sequence, where digits (positions) and
 * whitespace are ignored.
 */
export function readSequenceText(text: string): ReadResult {
  return readDecodedText(text, undefined, undefined);
}

function readDecodedText(
  text: string,
  fileName: string | undefined,
  byExtension: SequenceFormat | undefined,
) {
  if (text.trim() === '') return EMPTY;
  const lines = splitLines(text);
  const name = fallbackName(fileName);
  const format =
    formatOfText(lines) ?? byExtension ?? (looksLikeRawSequence(text) ? ('raw' as const) : undefined);
  return run(format, (w) => readText(format as SequenceFormat, text, lines, name, w));
}

const EXTENSION: Readonly<Record<WritableFormat, string>> = {
  fasta: 'fasta',
  genbank: 'gb',
  embl: 'embl',
  snapgene: 'dna',
  raw: 'txt',
};

const MIME: Readonly<Record<WritableFormat, string>> = {
  fasta: 'text/x-fasta',
  genbank: 'chemical/seq-na-genbank',
  embl: 'chemical/x-embl-dl-nucleotide',
  snapgene: 'application/octet-stream',
  raw: 'text/plain',
};

function text(format: WritableFormat, body: string): WriteOutput {
  return { kind: 'text', text: body, extension: EXTENSION[format], mimeType: MIME[format] };
}

/** True when `format` can hold `record`: SnapGene `.dna` files hold DNA only. */
export function canWrite(record: SeqRecord, format: WritableFormat): boolean {
  return format !== 'snapgene' || record.alphabet !== 'protein';
}

/**
 * Writes one record in a format, with the suggested file extension. Throws RangeError when the format cannot
 * hold the record (check with `canWrite`).
 */
export function writeSequenceFile(record: SeqRecord, format: WritableFormat): WriteOutput {
  if (!canWrite(record, format))
    throw new RangeError(`a ${record.alphabet} record cannot be written as ${format}`);
  switch (format) {
    case 'snapgene':
      return {
        kind: 'binary',
        bytes: writeSnapGene(record),
        extension: EXTENSION.snapgene,
        mimeType: MIME.snapgene,
      };
    case 'raw':
      return text(format, writeRaw(record));
    default:
      return writeSequenceRecords([record], format);
  }
}

/** Writes several records into one FASTA, GenBank or EMBL file. */
export function writeSequenceRecords(records: readonly SeqRecord[], format: MultiRecordFormat): WriteOutput {
  const write = { fasta: writeFasta, genbank: writeGenBank, embl: writeEmbl }[format];
  return text(format, write(records));
}
