import { computed, signal } from '@preact/signals';
import type { SeqRecord } from '../engine/types';

/** Analysis sub-tabs of an open sequence, in display order (spec 3.4). */
export const ANALYSIS_TABS = [
  'summary',
  'sequence',
  'proteins',
  'primers',
  'digest',
  'features',
  'search',
  'codons',
  'alignment',
  'cloning',
  'libraries',
] as const;
export type AnalysisTab = (typeof ANALYSIS_TABS)[number];

/** An open sequence: the record plus the view state that belongs to its header tab. */
export interface SeqDocument {
  readonly id: string;
  readonly record: SeqRecord;
  readonly activeTab: AnalysisTab;
}

/**
 * Open documents and the active one. `activeId === null` shows the new-sequence view, which is what
 * the "+" button and an empty workspace display.
 */
export function createDocumentStore() {
  const documents = signal<readonly SeqDocument[]>([]);
  const activeId = signal<string | null>(null);
  let nextId = 1;

  const patch = (id: string, change: Partial<Omit<SeqDocument, 'id'>>) => {
    documents.value = documents.value.map((doc) => (doc.id === id ? { ...doc, ...change } : doc));
  };

  return {
    documents,
    activeId,
    activeDocument: computed(() => documents.value.find((doc) => doc.id === activeId.value) ?? null),

    /** Adds a document for `record` after the existing tabs and makes it active. Returns its id. */
    open(record: SeqRecord): string {
      const id = `doc-${nextId++}`;
      documents.value = [...documents.value, { id, record, activeTab: 'summary' }];
      activeId.value = id;
      return id;
    },

    /** Closes a document. Closing the active one activates its right neighbour, else its left one. */
    close(id: string): void {
      const list = documents.value;
      const index = list.findIndex((doc) => doc.id === id);
      if (index < 0) return;
      const rest = list.filter((doc) => doc.id !== id);
      documents.value = rest;
      if (activeId.value === id) activeId.value = (rest[index] ?? rest[index - 1])?.id ?? null;
    },

    activate(id: string): void {
      if (documents.value.some((doc) => doc.id === id)) activeId.value = id;
    },

    /** Shows the new-sequence view without closing any document. */
    showNewSequence(): void {
      activeId.value = null;
    },

    setActiveTab(id: string, tab: AnalysisTab): void {
      patch(id, { activeTab: tab });
    },

    /** Replaces a document's record, e.g. after an annotation edit. */
    setRecord(id: string, record: SeqRecord): void {
      patch(id, { record });
    },
  };
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;

/** The app's document store. */
export const workspace = createDocumentStore();
