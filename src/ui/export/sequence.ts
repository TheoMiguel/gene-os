import type { SeqRecord } from '../../engine/types';
import { writeSequenceFile } from '../../formats';
import type { WritableFormat } from '../../formats/types';
import { downloadBlob, type SaveResult, safeFileName } from './download';

/** Writes `record` in `format` with the sequence writers and saves it as `<record name>.<extension>`. */
export function downloadSequence(record: SeqRecord, format: WritableFormat): Promise<SaveResult> {
  const output = writeSequenceFile(record, format);
  const blob = new Blob([output.kind === 'text' ? output.text : (output.bytes as Uint8Array<ArrayBuffer>)], {
    type: output.mimeType,
  });
  return downloadBlob(blob, `${safeFileName(record.name)}.${output.extension}`);
}
