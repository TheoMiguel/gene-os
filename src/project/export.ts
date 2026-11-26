import type { ReadonlySignal } from '@preact/signals';
import { reverseComplement } from '../engine/alphabet';
import { countLetters } from '../engine/composition';
import { formatLocation, locationBounds, locationLength } from '../engine/location';
import type { Orf } from '../engine/orf';
import { type EnzymeSites, endType } from '../engine/restriction';
import { translate } from '../engine/translate';
import type { Feature, SeqRecord, Span } from '../engine/types';
import { type AnalysisState, analysisSignal } from '../state/analysis';
import type { SeqDocument } from '../state/documents';
import { type Cell, type ExportColumn, serializeTable, type TableFormat, toJson } from '../ui/export/tabular';

/** A range of the top strand, 0-based half-open: what the user selected. */
export interface Range {
  readonly start: number;
  readonly end: number;
}

function clipSpan(span: Span, range: Range): Span | null {
  const start = Math.max(span.start, range.start);
  const end = Math.min(span.end, range.end);
  if (start >= end) return null;
  return {
    start: start - range.start,
    end: end - range.start,
    ...((span.partialStart || span.start < range.start) && { partialStart: true as const }),
    ...((span.partialEnd || span.end > range.end) && { partialEnd: true as const }),
    ...(span.betweenBases && { betweenBases: true as const }),
  };
}

function clipFeature(feature: Feature, range: Range): Feature | null {
  const segments = feature.location.segments.flatMap((segment) => clipSpan(segment, range) ?? []);
  return segments.length === 0 ? null : { ...feature, location: { ...feature.location, segments } };
}

/**
 * The part of a record inside `range` as a new linear record: its bases, and the features that touch it, cut to
 * the range and moved to its coordinates. A feature cut by the range is marked partial at the cut.
 */
export function sliceRecord(record: SeqRecord, range: Range): SeqRecord {
  const features = record.features.flatMap((feature) => clipFeature(feature, range) ?? []);
  return {
    ...record,
    name: `${record.name}_${range.start + 1}-${range.end}`,
    seq: record.seq.slice(range.start, range.end),
    topology: 'linear',
    features,
  };
}

/** The ways the user copies a sequence. */
export type CopyKind = 'sequence' | 'reverseComplement' | 'translation';

/** The text of one copy action for `seq`, a nucleotide or protein sequence of `record`'s kind. */
export function copyTextOf(record: SeqRecord, seq: string, kind: CopyKind): string {
  if (kind === 'sequence') return seq;
  if (kind === 'reverseComplement') return reverseComplement(seq, record.alphabet);
  return translate(seq);
}

/** One exportable table of a document's analyses. */
export interface AnalysisTable {
  readonly id: 'features' | 'composition' | 'restriction' | 'orfs';
  readonly rowCount: number;
  /** The table as CSV, TSV or JSON text. */
  serialize(format: TableFormat): string;
  /** The rows as objects keyed by column id, for the combined JSON file. */
  objects(): unknown[];
}

function makeTable<Row>(
  id: AnalysisTable['id'],
  columns: readonly ExportColumn<Row>[],
  rows: readonly Row[],
): AnalysisTable {
  return {
    id,
    rowCount: rows.length,
    serialize: (format) => serializeTable(format, columns, rows),
    objects: () => JSON.parse(toJson(columns, rows)) as unknown[],
  };
}

const column = <Row>(id: string, header: string, value: (row: Row) => Cell): ExportColumn<Row> => ({
  id,
  header,
  value,
});

/** Waits for a worker analysis to finish. Rejects with its reason when it fails. */
function settled<T>(source: ReadonlySignal<AnalysisState<T>>): Promise<T> {
  let unsubscribe = () => {};
  const done = new Promise<T>((resolve, reject) => {
    unsubscribe = source.subscribe((state) => {
      if (state.status === 'ready') resolve(state.value);
      else if (state.status === 'failed') reject(new Error(state.reason));
    });
  });
  return done.finally(() => unsubscribe());
}

function featuresTable(record: SeqRecord): AnalysisTable {
  return makeTable<Feature>(
    'features',
    [
      column('name', 'Name', (f) => f.name),
      column('type', 'Type', (f) => f.type),
      column('location', 'Location', (f) => formatLocation(f.location)),
      column('start', 'Start', (f) => locationBounds(f.location).start + 1),
      column('end', 'End', (f) => locationBounds(f.location).end),
      column('length', 'Length', (f) => locationLength(f.location)),
      column('strand', 'Strand', (f) => f.location.strand),
      column('origin', 'Origin', (f) => f.origin),
      column('description', 'Description', (f) => f.description ?? ''),
    ],
    record.features,
  );
}

function compositionTable(record: SeqRecord): AnalysisTable {
  const total = record.seq.length || 1;
  return makeTable<{ letter: string; count: number; fraction: number }>(
    'composition',
    [
      column('letter', 'Letter', (r) => r.letter),
      column('count', 'Count', (r) => r.count),
      column('fraction', 'Fraction', (r) => r.fraction),
    ],
    Object.entries(countLetters(record.seq))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([letter, count]) => ({ letter, count, fraction: count / total })),
  );
}

/**
 * Every analysis table of one document: its features, composition, restriction sites over the whole enzyme
 * catalog and open reading frames of 50 or more residues. The scans run in the analysis worker and are cached
 * with the views' own results. Nucleotide-only tables are left out for a protein.
 */
export async function analysisTables(doc: SeqDocument): Promise<AnalysisTable[]> {
  const { record } = doc;
  const tables: AnalysisTable[] = [featuresTable(record), compositionTable(record)];
  if (record.alphabet === 'protein') return tables;

  const [scan, orfs] = await Promise.all([
    settled(analysisSignal(doc, 'restriction', {})),
    settled(analysisSignal(doc, 'orfs', { minCodons: 50 })),
  ]);
  tables.push(
    makeTable<EnzymeSites>(
      'restriction',
      [
        column('enzyme', 'Enzyme', (s) => s.enzyme.name),
        column('site', 'Recognition site', (s) => s.enzyme.site),
        column('ends', 'Ends', (s) => endType(s.enzyme)),
        column('cuts', 'Cuts', (s) => s.topCuts.length),
        column('positions', 'Cut positions', (s) => [...s.topCuts].sort((a, b) => a - b).join(';')),
      ],
      scan.sites.filter((sites) => sites.topCuts.length > 0),
    ),
    makeTable<Orf>(
      'orfs',
      [
        column('frame', 'Frame', (o) => o.frame),
        column('start', 'Start', (o) => locationBounds(o.location).start + 1),
        column('end', 'End', (o) => locationBounds(o.location).end),
        column('length', 'Length (aa)', (o) => o.lengthAa),
        column('startCodon', 'Start codon', (o) => o.startCodon),
        column('stopCodon', 'Stop codon', (o) => o.stopCodon),
        column('protein', 'Protein', (o) => o.protein),
      ],
      orfs,
    ),
  );
  return tables;
}

/** One JSON file with the document's identity and every table, each row an object keyed by column id. */
export function analysisJson(record: SeqRecord, tables: readonly AnalysisTable[]): string {
  return JSON.stringify(
    {
      document: {
        name: record.name,
        length: record.seq.length,
        alphabet: record.alphabet,
        topology: record.topology,
        accession: record.metadata.accession ?? null,
      },
      tables: Object.fromEntries(tables.map((table) => [table.id, table.objects()])),
    },
    null,
    2,
  );
}
