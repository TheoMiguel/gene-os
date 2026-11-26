import type { Chromatogram, SeqRecord } from '../engine/types';
import { FormatError, fallbackName, latin1, type Warnings } from './internal';

/**
 * ABIF (`.ab1`) Sanger trace files. After the `ABIF` magic and a version, one directory entry points at a
 * table of 28-byte entries: tag name (4 chars), tag number, element type, element size, element count,
 * data size, data offset. Data of 4 bytes or less sits in the offset field itself.
 * Reference: Applied Biosystems, "ABIF File Format Specification" (2009), and Biopython `Bio.SeqIO.AbiIO`.
 */

interface Entry {
  readonly elementType: number;
  readonly count: number;
  readonly data: Uint8Array;
}

/** ABIF element types for numbers: byte, char, word, short, long. */
const NUMBER_READERS: Readonly<Record<number, { size: number; read: (v: DataView, o: number) => number }>> = {
  1: { size: 1, read: (v, o) => v.getInt8(o) },
  2: { size: 1, read: (v, o) => v.getUint8(o) },
  3: { size: 2, read: (v, o) => v.getUint16(o) },
  4: { size: 2, read: (v, o) => v.getInt16(o) },
  5: { size: 4, read: (v, o) => v.getInt32(o) },
};

/** True when the bytes start with the ABIF magic. */
export function isAb1(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && latin1(bytes.subarray(0, 4)) === 'ABIF';
}

function directory(bytes: Uint8Array): Map<string, Entry> {
  if (!isAb1(bytes)) throw new FormatError('malformed', 'the file does not start with ABIF');
  if (bytes.length < 34) throw new FormatError('malformed', 'the ABIF header is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entrySize = view.getUint16(6 + 10);
  const entryCount = view.getUint32(6 + 12);
  const tableOffset = view.getUint32(6 + 20);
  const entries = new Map<string, Entry>();
  for (let i = 0; i < entryCount; i++) {
    const at = tableOffset + i * entrySize;
    if (at + 28 > bytes.length) throw new FormatError('malformed', 'the ABIF directory is truncated');
    const name = latin1(bytes.subarray(at, at + 4)) + view.getUint32(at + 4);
    const dataSize = view.getUint32(at + 16);
    const dataOffset = dataSize <= 4 ? at + 20 : view.getUint32(at + 20);
    if (dataOffset + dataSize > bytes.length)
      throw new FormatError('malformed', `ABIF tag ${name} points past the end`);
    entries.set(name, {
      elementType: view.getUint16(at + 8),
      count: view.getUint32(at + 12),
      data: bytes.subarray(dataOffset, dataOffset + dataSize),
    });
  }
  return entries;
}

function numbers(entry: Entry | undefined): number[] | undefined {
  if (entry === undefined) return undefined;
  const reader = NUMBER_READERS[entry.elementType];
  if (reader === undefined) return undefined;
  const view = new DataView(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
  const count = Math.min(entry.count, Math.floor(entry.data.length / reader.size));
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = reader.read(view, i * reader.size);
  return out;
}

/** A pString (length byte, then text) or a plain char array. */
function text(entry: Entry | undefined): string | undefined {
  if (entry === undefined) return undefined;
  const bytes = entry.elementType === 18 ? entry.data.subarray(1, 1 + (entry.data[0] ?? 0)) : entry.data;
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Reads the base calls of an AB1 file with their trace: called bases (PBAS2, else PBAS1), peak positions
 * (PLOC2/PLOC1), quality (PCON2/PCON1) and the four analysed channels DATA9-12 assigned to bases through
 * the FWO_ base order. `id` is the sample name (SMPL1) and `name` the file name, as in Biopython.
 */
export function readAb1(bytes: Uint8Array, fileName: string | undefined, warnings: Warnings): SeqRecord[] {
  const tags = directory(bytes);
  const bases = text(tags.get('PBAS2') ?? tags.get('PBAS1'));
  if (!bases) throw new FormatError('no_sequence', 'the trace has no base calls (fragment analysis file?)');
  const seq = bases.toUpperCase();
  const order = text(tags.get('FWO_1')) ?? 'GATC';
  const channels: Partial<Record<'A' | 'C' | 'G' | 'T', number[]>> = {};
  for (let i = 0; i < 4; i++) {
    const base = order[i] as string;
    const data = numbers(tags.get(`DATA${9 + i}`));
    if ((base === 'A' || base === 'C' || base === 'G' || base === 'T') && data) channels[base] = data;
  }
  const peaks = numbers(tags.get('PLOC2') ?? tags.get('PLOC1'));
  const qualityTag = tags.get('PCON2') ?? tags.get('PCON1');
  const quality = qualityTag ? Array.from(qualityTag.data) : undefined;

  let trace: Chromatogram | undefined;
  const { A, C, G, T } = channels;
  if (A && C && G && T && peaks?.length === seq.length) {
    trace = {
      channels: { A, C, G, T },
      peakPositions: peaks,
      ...(quality?.length === seq.length ? { quality } : {}),
    };
  } else {
    warnings.add('content_ignored', 'the trace channels or peak positions are missing or incomplete');
  }
  const name = fallbackName(fileName);
  return [
    {
      id: text(tags.get('SMPL1')) || name,
      name,
      description: '',
      alphabet: 'dna',
      topology: 'linear',
      seq,
      features: [],
      metadata: { molType: 'DNA', sourceFormat: 'ab1' },
      ...(trace === undefined ? {} : { trace }),
    },
  ];
}
