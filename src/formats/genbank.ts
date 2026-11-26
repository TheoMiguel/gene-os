import type { SeqRecord, Topology } from '../engine/types';
import { formatFeatureTable, parseFeatureTable } from './feature-table';
import {
  chunk,
  cleanSequence,
  detectAlphabet,
  FormatError,
  isInsdcDate,
  type Warnings,
  wrap,
} from './internal';

/** GenBank divisions, which share the LOCUS line with three-letter molecule types such as `DNA`. */
const DIVISIONS = new Set([
  'PRI',
  'ROD',
  'MAM',
  'VRT',
  'INV',
  'PLN',
  'BCT',
  'VRL',
  'PHG',
  'SYN',
  'UNA',
  'EST',
  'PAT',
  'STS',
  'GSS',
  'HTG',
  'HTC',
  'ENV',
  'CON',
  'TSA',
  'UNK',
]);

/** Molecule types the LOCUS line accepts (the strandedness prefix `ss-`, `ds-`, `ms-` is optional). */
const LOCUS_MOL_TYPE = /^(?:ss-|ds-|ms-)?(?:NA|DNA|RNA|tRNA|rRNA|mRNA|uRNA|snRNA|snoRNA|cRNA)$/;

interface Header {
  name: string;
  declaredLength?: number;
  molType?: string;
  topology?: Topology;
  date?: string;
  definition: string[];
  accession?: string;
  version?: string;
  organism?: string;
}

function parseLocus(line: string): Header {
  const tokens = line.slice(5).trim().split(/\s+/);
  const header: Header = { name: tokens[0] ?? '', definition: [] };
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i] as string;
    const unit = tokens[i + 1]?.toLowerCase();
    if (/^\d+$/.test(t) && (unit === 'bp' || unit === 'aa' || unit === 'rc')) {
      header.declaredLength = Number(t);
      if (unit === 'aa') header.molType = 'protein';
      i++;
    } else if (t === 'linear' || t === 'circular') {
      header.topology = t;
    } else if (isInsdcDate(t)) {
      header.date = t;
    } else if (!DIVISIONS.has(t) && LOCUS_MOL_TYPE.test(t)) {
      header.molType = t;
    }
  }
  return header;
}

/**
 * Reads every record of a GenBank file. Identifiers follow Biopython: `name` is the LOCUS name, `id` the
 * VERSION (else the first ACCESSION, else the name), `description` the DEFINITION without its final period.
 * Text before the first LOCUS line (a release-file header) is skipped. A record without sequence data
 * (CONTIG only) is skipped with a warning.
 */
export function readGenBank(lines: readonly string[], warnings: Warnings): SeqRecord[] {
  const records: SeqRecord[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!(lines[i] as string).startsWith('LOCUS')) {
      i++;
      continue;
    }
    const begin = i;
    const header = parseLocus(lines[i++] as string);
    let featureLines: string[] = [];
    let featureStart = 0;
    const seqParts: string[] = [];
    let hasOrigin = false;
    let section = '';
    for (; i < lines.length; i++) {
      const line = lines[i] as string;
      if (line.startsWith('//')) {
        i++;
        break;
      }
      if (line.startsWith('LOCUS')) break;
      const keyword = line.slice(0, 12).trim();
      if (line[0] !== ' ' && line !== '') section = keyword.split(/\s+/)[0] ?? '';
      const value = line.slice(12).trim();
      switch (section) {
        case 'DEFINITION':
          header.definition.push(value);
          break;
        case 'ACCESSION':
          if (keyword === 'ACCESSION') header.accession = value.split(/\s+/)[0] ?? '';
          break;
        case 'VERSION':
          if (keyword === 'VERSION') header.version = value.split(/\s+/)[0] ?? '';
          break;
        case 'SOURCE':
          if (keyword === 'ORGANISM' && value !== '.') header.organism = value;
          break;
        case 'FEATURES':
          if (keyword === 'FEATURES') featureStart = i + 2;
          else featureLines.push(line);
          break;
        case 'ORIGIN':
          if (keyword === 'ORIGIN') hasOrigin = true;
          else seqParts.push(line);
          break;
      }
    }
    if (!hasOrigin) {
      warnings.add('record_skipped', `record ${header.name} has no sequence data`, begin + 1);
      continue;
    }
    const seq = cleanSequence(seqParts, warnings, begin + 1);
    if (header.declaredLength !== undefined && header.declaredLength !== seq.length) {
      warnings.add(
        'length_mismatch',
        `LOCUS says ${header.declaredLength} but the sequence has ${seq.length} letters`,
        begin + 1,
      );
    }
    const topology = header.topology ?? 'linear';
    const features = parseFeatureTable(featureLines, featureStart, {
      length: seq.length,
      topology,
      warnings,
    });
    featureLines = [];
    const description = header.definition.join(' ');
    records.push({
      id: header.version ?? header.accession ?? header.name,
      name: header.name,
      description: description.endsWith('.') ? description.slice(0, -1) : description,
      alphabet: detectAlphabet(seq, header.molType),
      topology,
      seq,
      features,
      metadata: {
        ...(header.accession === undefined ? {} : { accession: header.accession }),
        ...(header.organism === undefined ? {} : { organism: header.organism }),
        ...(header.molType === undefined ? {} : { molType: header.molType }),
        ...(header.date === undefined ? {} : { date: header.date }),
        sourceFormat: 'genbank',
      },
    });
  }
  if (records.length === 0) {
    if (lines.some((l) => l.startsWith('LOCUS')))
      throw new FormatError('no_sequence', 'the file has no sequence data');
    throw new FormatError('malformed', 'no LOCUS line found');
  }
  return records;
}

function locusMolType(record: SeqRecord): string {
  const declared = record.metadata.molType;
  if (declared && LOCUS_MOL_TYPE.test(declared)) return declared;
  if (declared?.includes('RNA')) return 'RNA';
  return record.alphabet === 'rna' ? 'RNA' : 'DNA';
}

/** A GenBank token without spaces, as the LOCUS line and readers expect. */
function locusName(record: SeqRecord): string {
  return (record.name || record.id || 'Unnamed').replace(/\s+/g, '_');
}

function field(keyword: string, text: string): string[] {
  return wrap(text, 67).map((l, i) => (i === 0 ? keyword.padEnd(12) : ' '.repeat(12)) + l);
}

/** Writes one GenBank record, sequence 60 bases per line in blocks of 10. */
function formatRecord(record: SeqRecord): string {
  const protein = record.alphabet === 'protein';
  const mol = protein ? '' : locusMolType(record);
  const stranded = /^(?:ss|ds|ms)-/.test(mol);
  const date =
    record.metadata.date && isInsdcDate(record.metadata.date) ? record.metadata.date : '01-JAN-1980';
  const lines = [
    [
      `LOCUS       ${locusName(record).padEnd(16)}`,
      `${String(record.seq.length).padStart(11)} ${protein ? 'aa' : 'bp'}`,
      `${stranded ? mol.slice(0, 3) : '   '}${(stranded ? mol.slice(3) : mol).padEnd(6)} `,
      `${record.topology.padEnd(8)} UNA ${date}`,
    ].join(' '),
  ];
  const description = record.description || '.';
  lines.push(...field('DEFINITION', description.endsWith('.') ? description : `${description}.`));
  const accession = record.metadata.accession ?? record.id.split('.')[0] ?? '';
  lines.push(...field('ACCESSION', accession || locusName(record)));
  if (record.id !== accession) lines.push(...field('VERSION', record.id));
  lines.push(...field('KEYWORDS', '.'));
  const organism = record.metadata.organism ?? '.';
  lines.push(...field('SOURCE', organism));
  lines.push(...field('  ORGANISM', organism), `${' '.repeat(12)}.`);
  lines.push('FEATURES             Location/Qualifiers');
  lines.push(...formatFeatureTable(record.features, { lead: '' }));
  lines.push('ORIGIN');
  const seq = record.seq.toLowerCase();
  for (let i = 0; i < seq.length; i += 60) {
    lines.push(`${String(i + 1).padStart(9)} ${chunk(seq.slice(i, i + 60), 10).join(' ')}`);
  }
  lines.push('//');
  return `${lines.join('\n')}\n`;
}

/** Writes records as a GenBank flat file. */
export function writeGenBank(records: readonly SeqRecord[]): string {
  return records.map(formatRecord).join('');
}
