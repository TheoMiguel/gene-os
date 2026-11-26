import { effect } from '@preact/signals';
import { workspace } from '../../../state/documents';

/**
 * Creates a store of view state per open document. A tab's panel unmounts when the user switches tabs, so state
 * the user would be annoyed to lose (typed primers, chosen enzymes, the agarose percentage) lives here instead.
 * A document's entry goes when the document closes.
 */
export function perDocument<T>(create: () => T): (docId: string) => T {
  const states = new Map<string, T>();
  effect(() => {
    const open = new Set(workspace.documents.value.map((doc) => doc.id));
    for (const id of [...states.keys()]) if (!open.has(id)) states.delete(id);
  });
  return (docId) => {
    let state = states.get(docId);
    if (state === undefined) {
      state = create();
      states.set(docId, state);
    }
    return state;
  };
}
