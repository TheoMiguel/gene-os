import type { SeqRecord, Topology } from '../engine/types';
import { formatFeatureTable, parseFeatureTable } from './feature-table';
import { chunk, cleanSequence, detectAlphabet, FormatError, type Warnings, wrap } from './internal';

interface IdLine {
  name: string;
  accession?: string;
  version?: string;
  topology?: Topology;
  molType?: string;
}

/** Parses the ID line: the 2006+ layout (seven `;` fields) or the older `ID name class; mol; div; len BP.` */
function parseIdLine(line: string, lineNumber: number): IdLine {
  const body = line.slice(5).trim();
  const fields = body.split(';').map((f) => f.trim());
  if (fields.length === 7) {
    const [accession = '', sv = '', topology, molType] = fields;
    const version = /^SV\s+(\d+)$/.exec(sv)?.[1];
    return {
      name: accession,
      accession,
      ...(version === undefined ? {} : { version: `${accession}.${version}` }),
      ...(topology === 'circular' || topology === 'linear' ? { topology } : {}),
      ...(molType ? { molType } : {}),
    };
  }
  const name = body.split(/[\s;]+/)[0] ?? '';
  if (fields.length < 3 || !name) throw new FormatError('malformed', 'unrecognised EMBL ID line', lineNumber);
  const molField = fields[1] ?? '';
  const topology = /\bcircular\b/.test(molField)
    ? 'circular'
    : /\blinear\b/.test(molField)
      ? 'linear'
      : undefined;
  const molType = molField.replace(/\b(?:circular|linear)\b/, '').trim();
  return {
    name,
    ...(topology === undefined ? {} : { topology }),
    ...(molType ? { molType } : {}),
  };
}

/**
 * Reads every record of an EMBL file. Identifiers follow Biopython: `name` is the first ID token, `id` the
 * accession with its sequence version (ID `SV` field or `SV` line), `description` the DE lines joined.
 * A record without sequence data (CO lines only) is skipped with a warning.
 */
export function readEmbl(lines: readonly string[], warnings: Warnings): SeqRecord[] {
  const records: SeqRecord[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!(lines[i] as string).startsWith('ID   ')) {
      i++;
      continue;
    }
    const begin = i;
    const id = parseIdLine(lines[i++] as string, begin + 1);
    let accession = id.accession;
    let version = id.version;
    const description: string[] = [];
    let organism: string | undefined;
    const featureLines: string[] = [];
    let featureStart = 0;
    const seqParts: string[] = [];
    let inSequence = false;
    let hasSequence = false;
    for (; i < lines.length; i++) {
      const line = lines[i] as string;
      if (line.startsWith('//')) {
        i++;
        break;
      }
      if (line.startsWith('ID   ')) break;
      if (inSequence) {
        seqParts.push(line);
        continue;
      }
      const code = line.slice(0, 2);
      const value = line.slice(5).trim();
      if (code === 'AC') accession ??= value.split(/[;\s]+/)[0];
      else if (code === 'SV') version ??= value;
      else if (code === 'DE') description.push(value);
      else if (code === 'OS') organism ??= value;
      else if (code === 'FT') {
        if (featureLines.length === 0) featureStart = i + 1;
        featureLines.push(line);
      } else if (code === 'SQ') {
        inSequence = true;
        hasSequence = true;
      }
    }
    if (!hasSequence) {
      warnings.add('record_skipped', `record ${id.name} has no sequence data`, begin + 1);
      continue;
    }
    const seq = cleanSequence(seqParts, warnings, begin + 1);
    const topology = id.topology ?? 'linear';
    records.push({
      id: version ?? accession ?? id.name,
      name: id.name,
      description: description.join(' '),
      alphabet: detectAlphabet(seq, id.molType),
      topology,
      seq,
      features: parseFeatureTable(featureLines, featureStart, { length: seq.length, topology, warnings }),
      metadata: {
        ...(accession === undefined ? {} : { accession }),
        ...(organism === undefined ? {} : { organism }),
        ...(id.molType === undefined ? {} : { molType: id.molType }),
        sourceFormat: 'embl',
      },
    });
  }
  if (records.length === 0) {
    if (lines.some((l) => l.startsWith('ID   ')))
      throw new FormatError('no_sequence', 'the file has no sequence data');
    throw new FormatError('malformed', 'no ID line found');
  }
  return records;
}

/** EMBL molecule types (the ID line vocabulary) that GENE_OS passes through unchanged. */
const EMBL_MOL_TYPES = new Set([
  'genomic DNA',
  'genomic RNA',
  'mRNA',
  'tRNA',
  'rRNA',
  'other RNA',
  'other DNA',
  'transcribed RNA',
  'viral cRNA',
  'unassigned DNA',
  'unassigned RNA',
  'protein',
]);

function emblMolType(record: SeqRecord): string {
  if (record.alphabet === 'protein') return 'protein';
  const declared = record.metadata.molType;
  if (declared && EMBL_MOL_TYPES.has(declared)) return declared;
  return record.alphabet === 'rna' || declared?.includes('RNA') ? 'unassigned RNA' : 'unassigned DNA';
}

function lineBlock(code: string, text: string): string[] {
  return wrap(text, 75).map((l) => `${code}   ${l}`);
}

function baseCounts(seq: string): string {
  const counts = { A: 0, C: 0, G: 0, T: 0 };
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i] as string;
    if (c in counts) counts[c as keyof typeof counts]++;
  }
  const other = seq.length - counts.A - counts.C - counts.G - counts.T;
  return `${counts.A} A; ${counts.C} C; ${counts.G} G; ${counts.T} T; ${other} other;`;
}

function formatRecord(record: SeqRecord): string {
  const protein = record.alphabet === 'protein';
  const unit = protein ? 'AA' : 'BP';
  const accession = (record.metadata.accession ?? record.id.split('.')[0] ?? record.name).replace(
    /[\s;]+/g,
    '_',
  );
  const version = record.id.startsWith(`${accession}.`) ? record.id.slice(accession.length + 1) : '';
  const sv = /^\d+$/.test(version) ? `SV ${version}` : '';
  const lines = [
    `ID   ${accession}; ${sv}; ${record.topology}; ${emblMolType(record)}; STD; UNC; ${record.seq.length} ${unit}.`,
    'XX',
    `AC   ${accession};`,
    'XX',
  ];
  if (record.description) lines.push(...lineBlock('DE', record.description), 'XX');
  if (record.metadata.organism) lines.push(...lineBlock('OS', record.metadata.organism), 'XX');
  if (record.features.length > 0) {
    lines.push('FH   Key             Location/Qualifiers', 'FH');
    lines.push(...formatFeatureTable(record.features, { lead: 'FT' }), 'XX');
  }
  lines.push(`SQ   Sequence ${record.seq.length} ${unit};${protein ? '' : ` ${baseCounts(record.seq)}`}`);
  const seq = protein ? record.seq : record.seq.toLowerCase();
  for (let i = 0; i < seq.length; i += 60) {
    const blocks = chunk(seq.slice(i, i + 60), 10).join(' ');
    lines.push(`     ${blocks.padEnd(65)}${String(Math.min(i + 60, seq.length)).padStart(10)}`);
  }
  lines.push('//');
  return `${lines.join('\n')}\n`;
}

/** Writes records as an EMBL flat file (2006+ ID line). */
export function writeEmbl(records: readonly SeqRecord[]): string {
  return records.map(formatRecord).join('');
}
