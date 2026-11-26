import type { SeqRecord, SequenceFormat } from '../engine/types';

/** Why a file could not be read. */
export type ReadErrorCode =
  /** The input holds no data. */
  | 'empty'
  /** Neither the content nor the file name identify a supported format. */
  | 'unknown_format'
  /** The content claims a format but breaks its rules. */
  | 'malformed'
  /** The file is valid but holds no sequence (a contig/CON record, a trace without base calls). */
  | 'no_sequence';

/** Something the reader repaired or skipped; the records are still usable. */
export type ReadWarningCode =
  /** An origin-spanning location written as `start > end` was split into two segments. */
  | 'location_fixed'
  /** A location part was dropped: remote accession, between-bases site or out of range. */
  | 'location_dropped'
  /** An inexact position (`one-of`, `(a.b)`) or mixed strands was reduced to what GENE_OS stores. */
  | 'location_simplified'
  /** A record without sequence data was skipped. */
  | 'record_skipped'
  /** Characters that are not sequence letters were removed. */
  | 'characters_removed'
  /** Text that belongs to no record was ignored. */
  | 'content_ignored'
  /** The declared length differs from the sequence that was read. */
  | 'length_mismatch';

export interface ReadWarning {
  readonly code: ReadWarningCode;
  readonly message: string;
  /** 1-based line of a text file, when known. */
  readonly line?: number;
}

export interface ReadError {
  readonly code: ReadErrorCode;
  readonly message: string;
  readonly line?: number;
}

export type ReadResult =
  | {
      readonly ok: true;
      readonly format: SequenceFormat;
      readonly records: readonly SeqRecord[];
      readonly warnings: readonly ReadWarning[];
    }
  | {
      readonly ok: false;
      /** The format the content was read as, when one was recognised. */
      readonly format?: SequenceFormat;
      readonly error: ReadError;
      readonly warnings: readonly ReadWarning[];
    };

/** Formats GENE_OS can write. AB1 traces come from a sequencer and are read only. */
export type WritableFormat = Exclude<SequenceFormat, 'ab1'>;

/** Formats that hold several records in one file. */
export type MultiRecordFormat = Extract<WritableFormat, 'fasta' | 'genbank' | 'embl'>;

export type WriteOutput =
  | { readonly kind: 'text'; readonly text: string; readonly extension: string; readonly mimeType: string }
  | {
      readonly kind: 'binary';
      readonly bytes: Uint8Array;
      readonly extension: string;
      readonly mimeType: string;
    };
