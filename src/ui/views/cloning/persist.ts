import type { Dntp } from '../../../engine/cloning';
import type { Topology } from '../../../engine/types';
import { registerProjectSection } from '../../../project/sections';
import { workspace } from '../../../state/documents';
import { type CloningSetup, DEFAULT_CLONING_FIELDS, METHODS, type SourceChoice } from './model';
import { findCloningSetup, restoreCloningSetup } from './store';

/** A source as stored: another document is its position in the saved list, `-1` when it was closed. */
type StoredSource =
  | { readonly kind: 'selection' | 'doc'; readonly ref: number }
  | { readonly kind: 'paste'; readonly text: string; readonly topology: Topology };

type StoredSetup = Omit<CloningSetup, 'inserts' | 'vector'> & {
  readonly inserts: readonly StoredSource[];
  readonly vector: StoredSource;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function toStored(source: SourceChoice, order: readonly string[]): StoredSource {
  return source.kind === 'paste' ? source : { kind: source.kind, ref: order.indexOf(source.docId) };
}

function readSource(raw: unknown): StoredSource | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'paste')
    return typeof raw.text === 'string'
      ? { kind: 'paste', text: raw.text, topology: raw.topology === 'circular' ? 'circular' : 'linear' }
      : null;
  if (
    (raw.kind === 'doc' || raw.kind === 'selection') &&
    typeof raw.ref === 'number' &&
    Number.isInteger(raw.ref)
  )
    return { kind: raw.kind, ref: raw.ref };
  return null;
}

const text = (raw: unknown, fallback: string) => (typeof raw === 'string' ? raw : fallback);
const flag = (raw: unknown, fallback: boolean) => (typeof raw === 'boolean' ? raw : fallback);
const oneOf = <T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.find((value) => value === raw) ?? fallback;
const pair = (raw: unknown, fallback: readonly [string, string]): readonly [string, string] =>
  Array.isArray(raw) && typeof raw[0] === 'string' && typeof raw[1] === 'string'
    ? [raw[0], raw[1]]
    : fallback;

const DNTPS: readonly ('' | Dntp)[] = ['', 'A', 'C', 'G', 'T'];

/** The form fields of a stored value, each one checked, the defaults for what is missing or wrong. */
function readFields(raw: Record<string, unknown>): Omit<CloningSetup, 'inserts' | 'vector'> {
  const d = DEFAULT_CLONING_FIELDS;
  return {
    method: oneOf(
      raw.method,
      METHODS.map((m) => m.id),
      d.method,
    ),
    enzymes: pair(raw.enzymes, d.enzymes),
    insertMode: oneOf(raw.insertMode, ['amplify', 'digest'], d.insertMode),
    dephosphorylate: flag(raw.dephosphorylate, d.dephosphorylate),
    insertReverse: flag(raw.insertReverse, d.insertReverse),
    opening: oneOf(raw.opening, ['enzymes', 'region'], d.opening),
    openEnzymes: pair(raw.openEnzymes, d.openEnzymes),
    removeStart: text(raw.removeStart, d.removeStart),
    removeLength: text(raw.removeLength, d.removeLength),
    overlap: text(raw.overlap, d.overlap),
    goldenEnzyme: text(raw.goldenEnzyme, d.goldenEnzyme),
    goldenVectorMode: oneOf(raw.goldenVectorMode, ['digest', 'pcr'], d.goldenVectorMode),
    goldenStyle: oneOf(raw.goldenStyle, ['scar', 'native'], d.goldenStyle),
    goldenOverhangs: text(raw.goldenOverhangs, d.goldenOverhangs),
    gatewayReaction: oneOf(raw.gatewayReaction, ['BP', 'LR'], d.gatewayReaction),
    gatewayPrimers: flag(raw.gatewayPrimers, d.gatewayPrimers),
    attLeft: text(raw.attLeft, d.attLeft),
    attRight: text(raw.attRight, d.attRight),
    topoSite: text(raw.topoSite, d.topoSite),
    topoDirectional: flag(raw.topoDirectional, d.topoDirectional),
    topoAmplify: flag(raw.topoAmplify, d.topoAmplify),
    topoPolymerase: oneOf(raw.topoPolymerase, ['', 'taq', 'proofreading'], d.topoPolymerase),
    vectorDntp: oneOf(raw.vectorDntp, DNTPS, d.vectorDntp),
    insertDntp: oneOf(raw.insertDntp, DNTPS, d.insertDntp),
    targetTm: text(raw.targetTm, d.targetTm),
    annealMin: text(raw.annealMin, d.annealMin),
    annealMax: text(raw.annealMax, d.annealMax),
  };
}

/** Reads a stored cloning form. Returns null for a value that is not a form at all. */
function parseStored(raw: unknown): StoredSetup | null {
  if (!isRecord(raw)) return null;
  const vector = readSource(raw.vector);
  const inserts = Array.isArray(raw.inserts) ? raw.inserts.map(readSource) : [];
  if (!vector || inserts.length === 0 || inserts.some((source) => source === null)) return null;
  return { ...readFields(raw), inserts: inserts as StoredSource[], vector };
}

const pending = new Map<string, StoredSetup>();

function fromStored(source: StoredSource, ids: readonly string[]): SourceChoice {
  return source.kind === 'paste' ? source : { kind: source.kind, docId: ids[source.ref] ?? '' };
}

/**
 * The cloning view's form per document in the project file and the stored session: the method, its settings, and
 * where the insert and the vector come from. The designed result is not stored; Design builds it again from the
 * form. A document the user never opened in the cloning tab stores nothing.
 */
registerProjectSection({
  key: 'cloning',
  read(docId) {
    const setup = findCloningSetup(docId);
    if (!setup) return undefined;
    const order = workspace.documents.value.map((doc) => doc.id);
    const { inserts, vector, ...fields } = setup.value;
    const stored: StoredSetup = {
      ...fields,
      inserts: inserts.map((source) => toStored(source, order)),
      vector: toStored(vector, order),
    };
    return stored;
  },
  write(docId, value) {
    const stored = parseStored(value);
    if (stored) pending.set(docId, stored);
  },
  resolve(ids) {
    for (const [docId, stored] of pending) {
      const { inserts, vector, ...fields } = stored;
      restoreCloningSetup(docId, {
        ...fields,
        inserts: inserts.map((source) => fromStored(source, ids)),
        vector: fromStored(vector, ids),
      });
    }
    pending.clear();
  },
});
