import { effect, type Signal, signal } from '@preact/signals';
import type { CloningResult } from '../../../engine/cloning';
import { type SeqDocument, workspace } from '../../../state/documents';
import { viewOf } from '../../../state/view';
import {
  buildRequest,
  type CloningSetup,
  type CloningSource,
  DEFAULT_CLONING_FIELDS,
  type RequestError,
  type SourceChoice,
} from './model';
import { startDesign } from './run';

/** What the Design button produced for a document's cloning panel. */
export type CloningRun =
  | { readonly kind: 'running'; readonly startedAt: number }
  | { readonly kind: 'invalid'; readonly error: RequestError }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'designed'; readonly result: CloningResult; readonly setup: CloningSetup };

interface PanelState {
  readonly setup: Signal<CloningSetup>;
  readonly run: Signal<CloningRun | null>;
  cancel: (() => void) | null;
}

const panels = new Map<string, PanelState>();
const created = signal(0);

effect(() => {
  const open = new Set(workspace.documents.value.map((doc) => doc.id));
  for (const [id, panel] of panels) {
    if (open.has(id)) continue;
    panel.cancel?.();
    panels.delete(id);
  }
});

/** The sources the form offers: every open nucleotide document with its current selection. Cloning works on DNA. */
export function sourcesOf(documents: readonly SeqDocument[]): CloningSource[] {
  return documents
    .filter((doc) => doc.record.alphabet !== 'protein')
    .map((doc) => ({ doc, selection: viewOf(doc.id).selection.value }));
}

const PASTE: SourceChoice = { kind: 'paste', text: '', topology: 'linear' };

/**
 * The first choices for a new panel. A region selected in the Sequence view becomes the insert; the vector is
 * the current document when it is circular, else another circular document.
 */
export function defaultSources(
  current: SeqDocument,
  sources: readonly CloningSource[],
): { insert: SourceChoice; vector: SourceChoice } {
  const others = sources.filter((s) => s.doc.id !== current.id);
  const circularOther = others.find((s) => s.doc.record.topology === 'circular');
  const currentSelection = sources.find((s) => s.doc.id === current.id)?.selection;
  const vectorOther: SourceChoice = circularOther ? { kind: 'doc', docId: circularOther.doc.id } : PASTE;
  if (currentSelection) return { insert: { kind: 'selection', docId: current.id }, vector: vectorOther };
  if (current.record.topology === 'circular') {
    const pick = others.find((s) => s.selection) ?? others[0];
    const insert: SourceChoice = pick
      ? { kind: pick.selection ? 'selection' : 'doc', docId: pick.doc.id }
      : PASTE;
    return { insert, vector: { kind: 'doc', docId: current.id } };
  }
  return { insert: { kind: 'doc', docId: current.id }, vector: vectorOther };
}

/** The form and the last result of a document's cloning panel. The same objects every call, so a tab switch keeps them. */
export function cloningPanelOf(doc: SeqDocument, sources: readonly CloningSource[]): PanelState {
  let panel = panels.get(doc.id);
  if (!panel) {
    const { insert, vector } = defaultSources(doc, sources);
    panel = {
      setup: signal({ ...DEFAULT_CLONING_FIELDS, inserts: [insert], vector }),
      run: signal(null),
      cancel: null,
    };
    panels.set(doc.id, panel);
    created.value = created.peek() + 1;
  }
  return panel;
}

/** The form of a document's cloning panel, or undefined when the user never opened it. Reading in an effect tracks new panels too. */
export function findCloningSetup(docId: string): Signal<CloningSetup> | undefined {
  void created.value;
  return panels.get(docId)?.setup;
}

/** Gives a document a cloning panel with the form a project file or session stored, and no result. */
export function restoreCloningSetup(docId: string, setup: CloningSetup): void {
  const old = panels.get(docId);
  old?.cancel?.();
  panels.set(docId, { setup: signal(setup), run: signal(null), cancel: null });
  created.value = created.peek() + 1;
}

/** Builds the request from the form and runs the designer off the main thread, replacing a design in progress. */
export function runDesign(docId: string, sources: readonly CloningSource[]): void {
  const panel = panels.get(docId);
  if (!panel) return;
  panel.cancel?.();
  panel.cancel = null;
  const built = buildRequest(panel.setup.value, sources);
  if (!built.ok) {
    panel.run.value = { kind: 'invalid', error: built.error };
    return;
  }
  const designedFor = panel.setup.value;
  panel.run.value = { kind: 'running', startedAt: performance.now() };
  panel.cancel = startDesign(built.request, (outcome) => {
    panel.cancel = null;
    panel.run.value = outcome.kind === 'designed' ? { ...outcome, setup: designedFor } : outcome;
  });
}

/** Stops the design in progress and clears the result. */
export function cancelDesign(docId: string): void {
  const panel = panels.get(docId);
  if (!panel) return;
  panel.cancel?.();
  panel.cancel = null;
  panel.run.value = null;
}
