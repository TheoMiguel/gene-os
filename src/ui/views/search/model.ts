import { reverseComplement } from '../../../engine/alphabet';
import { linearLocation, sliceCircular } from '../../../engine/location';
import { ENZYME_CATALOG } from '../../../engine/restriction';
import type { SearchHit, SearchMode, SearchOptions, SearchResult } from '../../../engine/search';
import { type Frame, sixFrameTranslation } from '../../../engine/translate';
import type { Alphabet, Enzyme, Location, SeqRecord, Span, Strand } from '../../../engine/types';
import type { AnalysisInput } from '../../../workers/protocol';

/** What the user types in the search box. `enzyme` searches the recognition site of a catalog enzyme. */
export type QueryKind = 'text' | 'motif' | 'regex' | 'enzyme';
/** Which of the molecule's letters to search. A protein record has only its residues. */
export type SearchTarget = 'sequence' | 'translation' | 'both';
export type SearchScope = 'whole' | 'selection';

export interface SearchForm {
  readonly kind: QueryKind;
  /** The text of the search box: a sequence, a motif, an expression or an enzyme name. */
  readonly query: string;
  readonly bothStrands: boolean;
  readonly matchCase: boolean;
  readonly crossOrigin: boolean;
  readonly scope: SearchScope;
  readonly target: SearchTarget;
  readonly maxHits: number;
}

export const DEFAULT_MAX_HITS = 10_000;

export const DEFAULT_FORM: SearchForm = {
  kind: 'motif',
  query: '',
  bothStrands: true,
  matchCase: false,
  crossOrigin: true,
  scope: 'whole',
  target: 'sequence',
  maxHits: DEFAULT_MAX_HITS,
};

export type SearchParams = { readonly query: string } & SearchOptions;

/** One scan the workers run, with what is needed to put its hits back on the document. */
export interface SearchJob {
  readonly key: string;
  readonly input: AnalysisInput;
  readonly params: SearchParams;
  /** Added to every start: where the scanned text begins in the document. */
  readonly offset: number;
  /** Set for a scan of a translation: the reading frame whose protein is `input.seq`. */
  readonly frame: Frame | null;
  readonly docLength: number;
}

export interface SearchPlan {
  /** The scan of the whole record, run through the shared analysis cache. Null when nothing needs it. */
  readonly whole: SearchParams | null;
  /** Every other scan: a selection, or a translation. */
  readonly jobs: readonly SearchJob[];
  /** The enzyme the box names, or null when the box names none. */
  readonly enzyme: Enzyme | null;
  /** The box names an enzyme the catalog does not have. */
  readonly unknownEnzyme: boolean;
}

/** The catalog enzyme with this name, ignoring case. */
export function findEnzyme(name: string): Enzyme | null {
  const wanted = name.trim().toLowerCase();
  return wanted === ''
    ? null
    : (ENZYME_CATALOG.find((enzyme) => enzyme.name.toLowerCase() === wanted) ?? null);
}

const isNucleotide = (alphabet: Alphabet) => alphabet !== 'protein';

let lastTranslation: {
  readonly seq: string;
  readonly frames: ReturnType<typeof sixFrameTranslation>;
} | null = null;

/** The six-frame translation of `seq`, kept for the latest sequence so a new query does not translate again. */
function framesOf(seq: string) {
  if (lastTranslation?.seq !== seq) lastTranslation = { seq, frames: sixFrameTranslation(seq) };
  return lastTranslation.frames;
}

const engineMode = (kind: QueryKind): SearchMode => (kind === 'enzyme' ? 'motif' : kind);

/** The scans a form asks for on a record. An empty box, or an unknown enzyme, asks for none. */
export function planSearch(
  record: Pick<SeqRecord, 'seq' | 'alphabet' | 'topology'>,
  form: SearchForm,
  selection: { readonly start: number; readonly end: number } | null,
): SearchPlan {
  const enzyme = form.kind === 'enzyme' ? findEnzyme(form.query) : null;
  const none = {
    whole: null,
    jobs: [],
    enzyme,
    unknownEnzyme: form.kind === 'enzyme' && form.query.trim() !== '' && !enzyme,
  };
  const query = form.kind === 'enzyme' ? (enzyme?.site ?? '') : form.query;
  if (query.trim() === '') return none;

  const nucleotide = isNucleotide(record.alphabet);
  const target = nucleotide && form.kind !== 'enzyme' ? form.target : 'sequence';
  const base: SearchParams = {
    query,
    mode: engineMode(form.kind),
    maxHits: form.maxHits,
    ...(nucleotide ? { bothStrands: form.bothStrands } : {}),
  };
  const jobs: SearchJob[] = [];
  let whole: SearchParams | null = null;
  const docLength = record.seq.length;

  if (target !== 'translation') {
    const scoped = form.scope === 'selection' && selection;
    if (scoped) {
      const seq = record.seq.slice(selection.start, selection.end);
      const params = { ...base, circular: false };
      jobs.push({
        key: `seq:${selection.start}:${selection.end}`,
        input: { seq, topology: 'linear', alphabet: record.alphabet },
        params,
        offset: selection.start,
        frame: null,
        docLength,
      });
    } else {
      whole = { ...base, circular: form.crossOrigin && record.topology === 'circular' };
    }
  }

  if (target !== 'sequence') {
    const proteinBase: SearchParams = { query, mode: engineMode(form.kind), maxHits: form.maxHits };
    for (const { frame, protein } of framesOf(record.seq)) {
      jobs.push({
        key: `frame:${frame}`,
        input: { seq: protein, topology: 'linear', alphabet: 'protein' },
        params: { ...proteinBase, circular: false },
        offset: 0,
        frame,
        docLength,
      });
    }
  }
  return { whole, jobs, enzyme, unknownEnzyme: false };
}

/** A hit on the document, with the peptide it matched when it came from a translation. */
export interface PlacedHit {
  readonly hit: SearchHit;
  readonly frame: Frame | null;
  readonly peptide?: Context;
}

/** Text before, in and after a match. */
export interface Context {
  readonly left: string;
  readonly match: string;
  readonly right: string;
}

const PEPTIDE_FLANK = 4;

const shift = (location: Location, by: number): Location =>
  by === 0
    ? location
    : {
        ...location,
        segments: location.segments.map((s): Span => ({ ...s, start: s.start + by, end: s.end + by })),
      };

/** Puts a hit of one scan back in document coordinates, 0-based on the top strand. */
export function placeHit(job: SearchJob, hit: SearchHit): PlacedHit {
  if (job.frame === null) {
    return {
      hit: { ...hit, start: hit.start + job.offset, location: shift(hit.location, job.offset) },
      frame: null,
    };
  }
  const bases = hit.length * 3;
  const strandStart = Math.abs(job.frame) - 1 + 3 * hit.start;
  const strand: Strand = job.frame > 0 ? 1 : -1;
  const start = job.frame > 0 ? strandStart : job.docLength - strandStart - bases;
  const protein = job.input.seq;
  const end = hit.start + hit.length;
  return {
    hit: { start, length: bases, strand, location: linearLocation(start, start + bases, strand) },
    frame: job.frame,
    peptide: {
      left: protein.slice(Math.max(0, hit.start - PEPTIDE_FLANK), hit.start),
      match: protein.slice(hit.start, end),
      right: protein.slice(end, end + PEPTIDE_FLANK),
    },
  };
}

/** Keeps the hits whose every segment lies inside `[start, end)`. */
export function withinRange(placed: readonly PlacedHit[], start: number, end: number): PlacedHit[] {
  return placed.filter(({ hit }) => hit.location.segments.every((s) => s.start >= start && s.end <= end));
}

const FLANK = 10;

/** Top-strand text around a nucleotide hit. A circular molecule reads its flanks across the origin. */
export function nucleotideContext(seq: string, hit: SearchHit, circular: boolean, flank = FLANK): Context {
  const n = seq.length;
  const match = circular
    ? sliceCircular(seq, hit.start, hit.length)
    : seq.slice(hit.start, hit.start + hit.length);
  if (circular) {
    const size = Math.min(flank, Math.max(0, Math.floor((n - hit.length) / 2)));
    return {
      left: sliceCircular(seq, hit.start - size, size),
      match,
      right: sliceCircular(seq, hit.start + hit.length, size),
    };
  }
  return {
    left: seq.slice(Math.max(0, hit.start - flank), hit.start),
    match,
    right: seq.slice(hit.start + hit.length, hit.start + hit.length + flank),
  };
}

/** One line of the results table. */
export interface ResultRow {
  readonly hit: SearchHit;
  readonly frame: Frame | null;
  readonly context: Context;
}

/** The table rows of some placed hits, in document order. */
export function resultRows(
  record: Pick<SeqRecord, 'seq' | 'topology'>,
  placed: readonly PlacedHit[],
): ResultRow[] {
  const circular = record.topology === 'circular';
  return placed
    .map(({ hit, frame, peptide }) => ({
      hit,
      frame,
      context: peptide ?? nucleotideContext(record.seq, hit, circular),
    }))
    .sort((a, b) => a.hit.start - b.hit.start || b.hit.strand - a.hit.strand);
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Keeps the rows whose matched letters equal what the user typed, letter case included. The engine ignores
 * case, so this runs after it. The text of a reverse-strand hit is read in the hit's own direction, as the
 * query is. Motifs and enzymes name letter classes, so they have no case to match.
 */
export function keepMatchingCase(rows: readonly ResultRow[], form: SearchForm): ResultRow[] {
  if (form.matchCase !== true || (form.kind !== 'text' && form.kind !== 'regex')) return [...rows];
  const source = form.kind === 'text' ? escapeRegex(form.query.trim()) : form.query;
  let exact: RegExp;
  try {
    exact = new RegExp(`^(?:${source})$`);
  } catch {
    return [...rows];
  }
  return rows.filter(({ hit, frame, context }) => {
    const oriented = frame === null && hit.strand === -1 ? reverseComplement(context.match) : context.match;
    return exact.test(oriented);
  });
}

/** Where the hit list is capped and how many hits exist. */
export interface HitCount {
  readonly shown: number;
  readonly total: number;
  readonly capped: boolean;
}

/** Sorted rows cut to `maxHits`, with the count the user sees. */
export function capRows(
  rows: readonly ResultRow[],
  total: number,
  maxHits: number,
): { rows: ResultRow[]; count: HitCount } {
  const kept = rows.slice(0, maxHits);
  const exact = Math.max(total, rows.length);
  return { rows: kept, count: { shown: kept.length, total: exact, capped: exact > kept.length } };
}

/**
 * The row to go to from `current` (-1 for none yet). With none, the first hit after the caret going on, or the
 * last one before it going back, and the list wraps at its ends. Null for an empty list.
 */
export function stepIndex(
  rows: readonly ResultRow[],
  current: number,
  direction: 1 | -1,
  caret: number,
): number | null {
  if (rows.length === 0) return null;
  if (current < 0) {
    if (direction === 1) {
      return Math.max(
        rows.findIndex((row) => row.hit.start >= caret),
        0,
      );
    }
    const before = rows.findLastIndex((row) => row.hit.start < caret);
    return before < 0 ? rows.length - 1 : before;
  }
  return (current + direction + rows.length) % rows.length;
}

/** The span of a hit that the shared selection can hold: the part that holds `hit.start`. */
export function hitSpan(hit: SearchHit): Span {
  return hit.location.segments.find((s) => s.start === hit.start) ?? (hit.location.segments[0] as Span);
}

/** The result of one scan. `job` is null for the scan of the whole record. */
export interface ScanOutput {
  readonly job: SearchJob | null;
  readonly result: SearchResult;
}

/**
 * Everything the scans found, as table rows in document order. When a scan hit its limit, the count is the
 * engine's total; otherwise it is what the rows hold, so a filter that dropped hits never leaves a stale number.
 */
export function collectRows(
  record: Pick<SeqRecord, 'seq' | 'topology'>,
  form: SearchForm,
  outputs: readonly ScanOutput[],
  selection: { readonly start: number; readonly end: number } | null,
): { rows: ResultRow[]; count: HitCount } {
  const placed: PlacedHit[] = [];
  let total = 0;
  let truncated = false;
  for (const { job, result } of outputs) {
    total += result.total;
    truncated ||= result.truncated;
    const hits: PlacedHit[] = job
      ? result.hits.map((hit) => placeHit(job, hit))
      : result.hits.map((hit) => ({ hit, frame: null }));
    const clipped = job?.frame !== null && job !== null && form.scope === 'selection' && selection;
    placed.push(...(clipped ? withinRange(hits, selection.start, selection.end) : hits));
  }
  const rows = keepMatchingCase(resultRows(record, placed), form);
  return capRows(rows, truncated ? total : rows.length, form.maxHits);
}
