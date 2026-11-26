import { batch, signal } from '@preact/signals';
import type { SeqRecord } from '../engine/types';
import { type DocumentStore, type SeqDocument, workspace } from '../state/documents';
import { viewOf } from '../state/view';
import { readSections, writeSections } from './sections';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type ProjectData,
  type ProjectDocument,
  type ViewConfig,
} from './types';

/** The project name the user typed. It names the file and heads the comparison report. */
export const projectName = signal('');

/**
 * The record as it is saved: automatically detected features are left out, because they are recomputed from the
 * sequence and never belong to the user's data. Returns the same object when there is nothing to leave out.
 */
export function persistableRecord(record: SeqRecord): SeqRecord {
  return record.features.some((feature) => feature.origin === 'detected')
    ? { ...record, features: record.features.filter((feature) => feature.origin !== 'detected') }
    : record;
}

/** Reads a document's view configuration. Reading signals here makes an enclosing effect track them. */
export function captureView(docId: string): ViewConfig {
  const view = viewOf(docId);
  return {
    selection: view.selection.value,
    caret: view.caret.value,
    search: view.search.value,
    overlays: view.overlays.value,
    lineLength: view.lineLength.value,
    frames: view.frames.value,
  };
}

/** The user-facing state of one document, without its record. */
export function captureDocumentState(doc: SeqDocument): Omit<ProjectDocument, 'record'> {
  return { activeTab: doc.activeTab, view: captureView(doc.id), sections: readSections(doc.id) };
}

/** Reads the whole workspace into project data. */
export function captureProject(store: DocumentStore = workspace, name = projectName.value): ProjectData {
  const docs = store.documents.value;
  const activeId = store.activeId.value;
  const index = docs.findIndex((doc) => doc.id === activeId);
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    app: 'GENE_OS',
    name,
    savedAt: new Date().toISOString(),
    activeIndex: index >= 0 ? index : null,
    documents: docs.map((doc) => ({ record: persistableRecord(doc.record), ...captureDocumentState(doc) })),
  };
}

/** Puts a stored view configuration on a document's view state. */
export function applyView(docId: string, config: ViewConfig): void {
  const view = viewOf(docId);
  batch(() => {
    if (config.selection) view.select(config.selection.start, config.selection.end, config.selection.strand);
    else view.moveCaret(config.caret);
    view.search.value = config.search;
    view.overlays.value = config.overlays;
    view.lineLength.value = config.lineLength;
    view.frames.value = config.frames;
  });
  if (config.selection) view.caret.value = config.caret;
}

/** Opens one stored document in the workspace and restores its tab, view and sections. Returns its new id. */
export function openProjectDocument(doc: ProjectDocument, store: DocumentStore = workspace): string {
  const id = store.open(doc.record);
  store.setActiveTab(id, doc.activeTab);
  applyView(id, doc.view);
  writeSections(id, doc.sections);
  return id;
}

/**
 * Adds every document of a project to the workspace, after the documents that are open, then activates the one
 * that was active when the project was saved. An empty project shows the new-sequence view. Returns the new ids.
 */
export function applyProject(data: ProjectData, store: DocumentStore = workspace): string[] {
  const ids = data.documents.map((doc) => openProjectDocument(doc, store));
  const active = data.activeIndex === null ? undefined : ids[data.activeIndex];
  if (active) store.activate(active);
  else if (ids.length === 0) store.showNewSequence();
  if (data.name !== '') projectName.value = data.name;
  return ids;
}
