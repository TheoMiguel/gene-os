import { effect } from '@preact/signals';
import { workspace } from '../../../state/documents';

/**
 * State kept per open document: `stateOf(docId)` creates it on first use, and closing the document drops it.
 * The state outlives the view, so leaving a tab and coming back finds the controls as they were.
 */
export function perDocument<T>(create: () => T): (docId: string) => T {
  const states = new Map<string, T>();
  effect(() => {
    const open = new Set(workspace.documents.value.map((doc) => doc.id));
    for (const id of states.keys()) if (!open.has(id)) states.delete(id);
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
