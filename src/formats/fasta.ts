import type { SeqRecord } from '../engine/types';
import { chunk, cleanSequence, FormatError, plainRecord, type Warnings } from './internal';

/**
 * Reads every record of a FASTA file. As in Biopython, `id` and `name` are the first word of the title line
 * and `description` is the whole title. Text before the first `>` is ignored with a warning.
 */
export function readFasta(lines: readonly string[], warnings: Warnings): SeqRecord[] {
  const records: SeqRecord[] = [];
  let title: string | undefined;
  let titleLine = 0;
  let parts: string[] = [];
  const flush = () => {
    if (title === undefined) return;
    const id = title.split(/\s+/)[0] ?? '';
    records.push(
      plainRecord(
        { id, name: id, description: title, seq: cleanSequence(parts, warnings, titleLine) },
        'fasta',
      ),
    );
    parts = [];
  };
  lines.forEach((line, index) => {
    if (line.startsWith('>')) {
      flush();
      title = line.slice(1).trim();
      titleLine = index + 1;
    } else if (title !== undefined) {
      parts.push(line);
    } else if (line.trim() !== '') {
      warnings.add('content_ignored', 'text before the first ">" line was ignored', index + 1);
    }
  });
  flush();
  if (records.length === 0) throw new FormatError('malformed', 'no ">" title line found');
  return records;
}

/** FASTA title for a record: its description, prefixed with the id unless it already starts with it. */
function title(record: SeqRecord): string {
  if (!record.description) return record.id;
  if (record.description.startsWith(record.id)) return record.description;
  return `${record.id} ${record.description}`;
}

/** Writes records as FASTA, 60 letters per line. */
export function writeFasta(records: readonly SeqRecord[]): string {
  const lines: string[] = [];
  for (const record of records) {
    lines.push(`>${title(record)}`, ...chunk(record.seq, 60));
  }
  return `${lines.join('\n')}\n`;
}
