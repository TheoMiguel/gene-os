import { effect, signal } from '@preact/signals';
import { workspace } from './documents';

/** A store of view state per open document. */
export interface PerDocument<T> {
  /** The state of a document, created on first use. */
  (docId: string): T;
  /**
   * The state of a document, or undefined when no view has made one yet. Never creates it. Reading inside an effect
   * tracks creation too, so an autosave learns about state that appears later.
   */
  find(docId: string): T | undefined;
}

/**
 * State kept per open document. A tab's panel unmounts when the user switches tabs, so state the user would be
 * annoyed to lose (typed primers, chosen enzymes, the agarose percentage) lives here instead. Closing the document
 * drops its state, after `dispose` has run on it.
 */
export function perDocument<T>(create: () => T, dispose?: (state: T) => void): PerDocument<T> {
  const states = new Map<string, T>();
  const created = signal(0);
  effect(() => {
    const open = new Set(workspace.documents.value.map((doc) => doc.id));
    for (const [id, state] of [...states]) {
      if (open.has(id)) continue;
      dispose?.(state);
      states.delete(id);
    }
  });
  const stateOf = (docId: string): T => {
    let state = states.get(docId);
    if (state === undefined) {
      state = create();
      states.set(docId, state);
      created.value = created.peek() + 1;
    }
    return state;
  };
  return Object.assign(stateOf, {
    find(docId: string): T | undefined {
      void created.value;
      return states.get(docId);
    },
  });
}
