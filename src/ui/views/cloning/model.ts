import { detectAlphabet } from '../../../engine/alphabet';
import {
  ATT_SITES,
  type CloningMethod,
  type CloningRequest,
  type Dntp,
  type GatewayInsert,
  GOLDEN_GATE_ENZYMES,
  type Part,
  type PlannedPrimer,
  type VectorOpening,
} from '../../../engine/cloning';
import { cutCount, isClassicEnzyme } from '../../../engine/cloning/enzymes';
import { ENZYME_CATALOG } from '../../../engine/restriction';
import type { SeqRecord, Topology } from '../../../engine/types';
import type { SeqDocument } from '../../../state/documents';
import type { SelectionRange } from '../../../state/view';
import { parsePasted } from '../alignment/model';

/** The cloning methods the engine designs, in the order the chooser lists them, and what each one allows. */
export const METHODS: readonly { readonly id: CloningMethod; readonly manyInserts: boolean }[] = [
  { id: 'restriction', manyInserts: false },
  { id: 'gibson', manyInserts: true },
  { id: 'golden_gate', manyInserts: true },
  { id: 'gateway', manyInserts: true },
  { id: 'topo', manyInserts: false },
  { id: 'in_fusion', manyInserts: true },
  { id: 'lic', manyInserts: false },
];

/** Where a part comes from: a region selected in a document, a whole document, or pasted text. */
export type SourceChoice =
  | { readonly kind: 'selection'; readonly docId: string }
  | { readonly kind: 'doc'; readonly docId: string }
  | { readonly kind: 'paste'; readonly text: string; readonly topology: Topology };

/** Every field of the cloning form. Inputs hold text, so an empty one means "use the default". */
export interface CloningSetup {
  readonly method: CloningMethod;
  readonly inserts: readonly SourceChoice[];
  readonly vector: SourceChoice;
  readonly enzymes: readonly [string, string];
  readonly insertMode: 'amplify' | 'digest';
  readonly dephosphorylate: boolean;
  readonly insertReverse: boolean;
  readonly opening: 'enzymes' | 'region';
  readonly openEnzymes: readonly [string, string];
  readonly removeStart: string;
  readonly removeLength: string;
  readonly overlap: string;
  readonly goldenEnzyme: string;
  readonly goldenVectorMode: 'digest' | 'pcr';
  readonly goldenStyle: 'scar' | 'native';
  readonly gatewayReaction: 'BP' | 'LR';
  readonly gatewayPrimers: boolean;
  readonly attLeft: string;
  readonly attRight: string;
  readonly topoSite: string;
  readonly topoDirectional: boolean;
  readonly topoAmplify: boolean;
  readonly topoPolymerase: '' | 'taq' | 'proofreading';
  readonly vectorDntp: '' | Dntp;
  readonly insertDntp: '' | Dntp;
  readonly targetTm: string;
  readonly annealMin: string;
  readonly annealMax: string;
}

export const DEFAULT_CLONING_FIELDS: Omit<CloningSetup, 'inserts' | 'vector'> = {
  method: 'restriction',
  enzymes: ['', ''],
  insertMode: 'amplify',
  dephosphorylate: false,
  insertReverse: false,
  opening: 'enzymes',
  openEnzymes: ['', ''],
  removeStart: '',
  removeLength: '0',
  overlap: '',
  goldenEnzyme: GOLDEN_GATE_ENZYMES[0] ?? 'BsaI',
  goldenVectorMode: 'digest',
  goldenStyle: 'scar',
  gatewayReaction: 'LR',
  gatewayPrimers: true,
  attLeft: '1',
  attRight: '2',
  topoSite: '',
  topoDirectional: true,
  topoAmplify: true,
  topoPolymerase: '',
  vectorDntp: '',
  insertDntp: '',
  targetTm: '',
  annealMin: '',
  annealMax: '',
};

/** Overlap defaults the engine uses, shown as the placeholder of the overlap field. */
export const OVERLAP_DEFAULTS = { gibson: 30, in_fusion: 15 } as const;

/** The att variants the engine knows, ascending. */
export const ATT_VARIANTS: readonly number[] = [...ATT_SITES.keys()].sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// Resolving the chosen sources into parts
// ---------------------------------------------------------------------------

export type PartRole = 'insert' | 'vector';

export type PartErrorCode = 'closed' | 'no_selection' | 'empty_paste' | 'protein' | 'vector_linear';

export interface PartError {
  readonly code: PartErrorCode;
  readonly role: PartRole;
  /** 1-based number of the insert, when there are several. */
  readonly index: number;
}

/** A document's id, name, record and current selection, as the source chooser reads it. */
export interface CloningSource {
  readonly doc: SeqDocument;
  readonly selection: SelectionRange | null;
}

const PASTED_NAME = { insert: 'Pasted insert', vector: 'Pasted vector' } as const;

function pastedRecord(text: string, topology: Topology, role: PartRole): SeqRecord | null {
  const parsed = parsePasted(text);
  if (!parsed) return null;
  const name = parsed.label === 'Pasted' ? PASTED_NAME[role] : parsed.label;
  return {
    id: name,
    name,
    description: '',
    alphabet: 'dna',
    topology,
    seq: parsed.seq,
    features: [],
    metadata: {},
  };
}

/** Turns a source choice into an engine part. A vector must be circular. Errors say what to fix. */
export function resolvePart(
  choice: SourceChoice,
  sources: readonly CloningSource[],
  role: PartRole,
  index = 1,
): { readonly part: Part } | { readonly error: PartError } {
  const fail = (code: PartErrorCode) => ({ error: { code, role, index } });
  if (choice.kind === 'paste') {
    const record = pastedRecord(choice.text, role === 'vector' ? 'circular' : choice.topology, role);
    if (!record) return fail('empty_paste');
    if (detectAlphabet(record.seq) === 'protein') return fail('protein');
    return { part: { id: record.name, record } };
  }
  const source = sources.find((s) => s.doc.id === choice.docId);
  if (!source) return fail('closed');
  const { record } = source.doc;
  if (record.alphabet === 'protein') return fail('protein');
  if (role === 'vector' && record.topology !== 'circular') return fail('vector_linear');
  if (choice.kind === 'doc') return { part: { id: record.name, record } };
  const selection = source.selection;
  if (!selection) return fail('no_selection');
  return {
    part: {
      id: `${record.name}:${selection.start + 1}-${selection.end}`,
      record,
      region: { start: selection.start, length: selection.end - selection.start },
    },
  };
}

// ---------------------------------------------------------------------------
// Building the engine request
// ---------------------------------------------------------------------------

export type RequestError =
  | { readonly kind: 'part'; readonly error: PartError }
  | {
      readonly kind: 'field';
      readonly field: 'opening' | 'region' | 'overlap' | 'topoSite' | 'tm' | 'anneal';
    };

export type RequestResult =
  | { readonly ok: true; readonly request: CloningRequest }
  | { readonly ok: false; readonly error: RequestError };

const bad = (field: Extract<RequestError, { kind: 'field' }>['field']): RequestResult => ({
  ok: false,
  error: { kind: 'field', field },
});

const number = (text: string): number | null | undefined => {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const named = (pair: readonly [string, string]) => pair.map((s) => s.trim()).filter((s) => s !== '');

function openingOf(setup: CloningSetup): VectorOpening | 'opening' | 'region' {
  if (setup.opening === 'enzymes') {
    const enzymes = named(setup.openEnzymes);
    return enzymes.length === 0 ? 'opening' : { enzymes };
  }
  const start = number(setup.removeStart);
  const length = number(setup.removeLength);
  if (start === undefined || start === null || length === null || (length !== undefined && length < 0))
    return 'region';
  return { remove: { start: start - 1, length: length ?? 0 } };
}

function primerOptions(
  setup: CloningSetup,
): { readonly targetTm?: number; readonly annealRange?: { min: number; max: number } } | RequestResult {
  const tm = number(setup.targetTm);
  const min = number(setup.annealMin);
  const max = number(setup.annealMax);
  if (tm === null) return bad('tm');
  if (min === null || max === null) return bad('anneal');
  const annealRange = min !== undefined || max !== undefined ? { min: min ?? 18, max: max ?? 35 } : undefined;
  if (annealRange && !(annealRange.min >= 10 && annealRange.min <= annealRange.max)) return bad('anneal');
  return { ...(tm === undefined ? {} : { targetTm: tm }), ...(annealRange ? { annealRange } : {}) };
}

/**
 * Builds the engine request for the form, or says which field or source to fix first. Fields that only another
 * method uses are ignored, so switching method never blocks on a stale field.
 */
export function buildRequest(setup: CloningSetup, sources: readonly CloningSource[]): RequestResult {
  const vector = resolvePart(setup.vector, sources, 'vector');
  if ('error' in vector) return { ok: false, error: { kind: 'part', error: vector.error } };
  const many = METHODS.find((m) => m.id === setup.method)?.manyInserts ?? false;
  const wanted = many ? setup.inserts : setup.inserts.slice(0, 1);
  const inserts: Part[] = [];
  for (const [i, choice] of wanted.entries()) {
    const resolved = resolvePart(choice, sources, 'insert', i + 1);
    if ('error' in resolved) return { ok: false, error: { kind: 'part', error: resolved.error } };
    inserts.push(resolved.part);
  }
  const primers = primerOptions(setup);
  if ('ok' in primers) return primers;
  const first = inserts[0] as Part;

  switch (setup.method) {
    case 'restriction': {
      const enzymes = named(setup.enzymes);
      return {
        ok: true,
        request: {
          method: 'restriction',
          vector: vector.part,
          insert: first,
          ...(enzymes.length > 0 ? { enzymes } : {}),
          insertMode: setup.insertMode,
          dephosphorylateVector: setup.dephosphorylate,
          insertReverse: setup.insertReverse,
          ...primers,
        },
      };
    }
    case 'gibson':
    case 'in_fusion': {
      const opening = openingOf(setup);
      if (typeof opening === 'string') return bad(opening);
      const overlap = number(setup.overlap);
      if (overlap === null) return bad('overlap');
      return {
        ok: true,
        request: {
          method: setup.method,
          vector: vector.part,
          opening,
          inserts,
          ...(overlap === undefined ? {} : { overlap }),
          ...primers,
        },
      };
    }
    case 'golden_gate':
      return {
        ok: true,
        request: {
          method: 'golden_gate',
          enzyme: setup.goldenEnzyme,
          vector: vector.part,
          vectorMode: setup.goldenVectorMode,
          parts: inserts,
          junctionStyle: setup.goldenStyle,
          ...primers,
        },
      };
    case 'gateway': {
      const left = Number(setup.attLeft);
      const right = Number(setup.attRight);
      const withSites = setup.gatewayReaction === 'BP' && setup.gatewayPrimers;
      const gatewayInserts: GatewayInsert[] = inserts.map((part) =>
        withSites ? { part, attB: { left, right } } : { part },
      );
      return {
        ok: true,
        request: {
          method: 'gateway',
          reaction: setup.gatewayReaction,
          vector: vector.part,
          inserts: gatewayInserts,
          ...primers,
        },
      };
    }
    case 'topo': {
      const site = number(setup.topoSite);
      if (site === undefined || site === null || site < 1) return bad('topoSite');
      return {
        ok: true,
        request: {
          method: 'topo',
          vector: vector.part,
          site: site - 1,
          insert: first,
          directional: setup.topoDirectional,
          amplify: setup.topoAmplify,
          ...(setup.topoPolymerase === '' ? {} : { polymerase: setup.topoPolymerase }),
          ...primers,
        },
      };
    }
    case 'lic': {
      const opening = openingOf(setup);
      if (typeof opening === 'string') return bad(opening);
      return {
        ok: true,
        request: {
          method: 'lic',
          vector: vector.part,
          opening,
          insert: first,
          ...(setup.vectorDntp === '' ? {} : { vectorDntp: setup.vectorDntp }),
          ...(setup.insertDntp === '' ? {} : { insertDntp: setup.insertDntp }),
          ...primers,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers for the chooser and the result
// ---------------------------------------------------------------------------

/** Longest vector the form scans for single-cutting enzymes. A longer one takes typed enzyme names. */
export const MAX_SCANNED_VECTOR = 100_000;

/** Classic enzymes that cut a circular vector exactly once, so each can open it. */
export function singleCutters(record: SeqRecord): string[] {
  if (record.seq.length > MAX_SCANNED_VECTOR || record.alphabet === 'protein') return [];
  return ENZYME_CATALOG.filter(isClassicEnzyme)
    .filter((enzyme) => cutCount(record.seq, record.topology, enzyme) === 1)
    .map((enzyme) => enzyme.name)
    .sort((a, b) => a.localeCompare(b));
}

/** The primers as a plain order list: one line per primer, name then sequence, tab separated. */
export function orderList(primers: readonly PlannedPrimer[]): string {
  return primers
    .map((p) => `${p.name}\t${p.seq}`)
    .join('\n')
    .concat('\n');
}

/** Where a pasted or chosen vector sits: the vector document for the insertion-point shortcut. */
export function vectorDocId(setup: CloningSetup): string | null {
  return setup.vector.kind === 'paste' ? null : setup.vector.docId;
}
