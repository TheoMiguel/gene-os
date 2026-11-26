import { effect, type Signal, signal } from '@preact/signals';
import { type CloningResult, designCloning } from '../../../engine/cloning';
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

/** What the Design button produced for a document's cloning panel. */
export type CloningRun =
  | { readonly kind: 'invalid'; readonly error: RequestError }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'designed'; readonly result: CloningResult };

interface PanelState {
  readonly setup: Signal<CloningSetup>;
  readonly run: Signal<CloningRun | null>;
}

const panels = new Map<string, PanelState>();

effect(() => {
  const open = new Set(workspace.documents.value.map((doc) => doc.id));
  for (const id of panels.keys()) if (!open.has(id)) panels.delete(id);
});

/** The sources the form offers: every open document with its current selection. */
export function sourcesOf(documents: readonly SeqDocument[]): CloningSource[] {
  return documents.map((doc) => ({ doc, selection: viewOf(doc.id).selection.value }));
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
    };
    panels.set(doc.id, panel);
  }
  return panel;
}

/** Builds the request from the form and runs the designer. Never throws. */
export function runDesign(docId: string, sources: readonly CloningSource[]): void {
  const panel = panels.get(docId);
  if (!panel) return;
  const built = buildRequest(panel.setup.value, sources);
  if (!built.ok) {
    panel.run.value = { kind: 'invalid', error: built.error };
    return;
  }
  try {
    panel.run.value = { kind: 'designed', result: designCloning(built.request) };
  } catch (error) {
    panel.run.value = { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
