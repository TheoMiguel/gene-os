import { signal } from '@preact/signals';
import type { Topology } from '../../../engine/types';
import { workspace } from '../../../state/documents';
import { historyOf } from '../../../state/view';

const chosenIds = signal<ReadonlySet<string>>(new Set());

/** True once the user set the topology of this document, so inference no longer decides it. Reads as a signal. */
export function topologyChosen(docId: string): boolean {
  return chosenIds.value.has(docId);
}

function mark(docId: string, on: boolean): void {
  const next = new Set(chosenIds.peek());
  if (on) next.add(docId);
  else next.delete(docId);
  chosenIds.value = next;
}

/**
 * Sets the topology of the document's record as one undoable command, and marks it as the user's choice.
 * Undo restores the earlier topology and gives the decision back to inference.
 */
export function chooseTopology(docId: string, topology: Topology): void {
  const find = () => workspace.documents.peek().find((doc) => doc.id === docId);
  if (!find()) return;
  let before: Topology = topology;
  let wasChosen = false;
  const write = (value: Topology) => {
    const doc = find();
    if (doc) workspace.setRecord(docId, { ...doc.record, topology: value });
  };
  historyOf(docId).run({
    label: `topology ${topology}`,
    apply() {
      before = find()?.record.topology ?? topology;
      wasChosen = chosenIds.peek().has(docId);
      mark(docId, true);
      write(topology);
    },
    invert() {
      mark(docId, wasChosen);
      write(before);
    },
  });
}
