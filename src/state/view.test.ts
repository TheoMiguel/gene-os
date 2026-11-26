import { signal } from '@preact/signals';
import { linearLocation } from '../engine/location';
import type { Feature, SeqRecord } from '../engine/types';
import { workspace } from './documents';
import {
  addFeature,
  createCommandStack,
  createViewState,
  editFeatures,
  historyOf,
  redo,
  removeFeature,
  setSignalCommand,
  undo,
  updateFeature,
  viewOf,
} from './view';

describe('command stack', () => {
  const counter = () => {
    const value = signal(0);
    const add = (n: number, label = `add ${n}`) => ({
      label,
      apply: () => {
        value.value += n;
      },
      invert: () => {
        value.value -= n;
      },
    });
    return { value, add };
  };

  it('undoes and redoes in order and reports what is available', () => {
    const { value, add } = counter();
    const stack = createCommandStack();
    expect(stack.canUndo.value).toBe(false);
    stack.run(add(1));
    stack.run(add(10));
    expect(value.value).toBe(11);
    expect(stack.undoLabel.value).toBe('add 10');

    expect(stack.undo()).toBe(true);
    expect(value.value).toBe(1);
    expect(stack.redoLabel.value).toBe('add 10');
    expect(stack.undo()).toBe(true);
    expect(stack.undo()).toBe(false);
    expect(value.value).toBe(0);
    expect(stack.redo()).toBe(true);
    expect(stack.redo()).toBe(true);
    expect(stack.redo()).toBe(false);
    expect(value.value).toBe(11);
  });

  it('drops the redo branch when a new command runs', () => {
    const { value, add } = counter();
    const stack = createCommandStack();
    stack.run(add(1));
    stack.undo();
    stack.run(add(5));
    expect(stack.canRedo.value).toBe(false);
    expect(value.value).toBe(5);
  });

  it('does not record a command that throws', () => {
    const stack = createCommandStack();
    expect(() =>
      stack.run({
        label: 'bad',
        apply: () => {
          throw new Error('nope');
        },
        invert: () => {},
      }),
    ).toThrow('nope');
    expect(stack.canUndo.value).toBe(false);
  });

  it('keeps only the latest commands up to its limit', () => {
    const { value, add } = counter();
    const stack = createCommandStack(2);
    stack.run(add(1));
    stack.run(add(2));
    stack.run(add(4));
    stack.undo();
    stack.undo();
    expect(stack.undo()).toBe(false);
    expect(value.value).toBe(1);
  });

  it('undoes a signal change', () => {
    const target = signal('a');
    const stack = createCommandStack();
    stack.run(setSignalCommand('set', target, 'b'));
    stack.run(setSignalCommand('set', target, 'c'));
    stack.undo();
    expect(target.value).toBe('b');
    stack.undo();
    expect(target.value).toBe('a');
    stack.redo();
    expect(target.value).toBe('b');
  });
});

describe('view state', () => {
  const view = (length = 100) => createViewState(() => length);

  it('selects a range clamped to the sequence, whichever way it was dragged', () => {
    const v = view();
    v.select(40, 10);
    expect(v.selection.value).toEqual({ start: 10, end: 40, strand: 1 });
    expect(v.caret.value).toBe(40);
    v.select(90, 500, -1);
    expect(v.selection.value).toEqual({ start: 90, end: 100, strand: -1 });
  });

  it('turns an empty selection into a caret move', () => {
    const v = view();
    v.select(10, 40);
    v.select(25, 25);
    expect(v.selection.value).toBeNull();
    expect(v.caret.value).toBe(25);
  });

  it('extends a selection from the anchor, in both directions, and collapses it back', () => {
    const v = view();
    v.moveCaret(50);
    v.moveCaret(60, { extend: true });
    expect(v.selection.value).toEqual({ start: 50, end: 60, strand: 1 });
    v.moveCaret(30, { extend: true });
    expect(v.selection.value).toEqual({ start: 30, end: 50, strand: 1 });
    v.moveCaret(50, { extend: true });
    expect(v.selection.value).toBeNull();
    v.moveCaret(70);
    expect(v.selection.value).toBeNull();
    expect(v.caret.value).toBe(70);
  });

  it('keeps the anchor of a selection made with select()', () => {
    const v = view();
    v.select(20, 40);
    v.moveCaret(45, { extend: true });
    expect(v.selection.value).toMatchObject({ start: 20, end: 45 });
  });

  it('clamps the caret to the sequence, end included', () => {
    const v = view();
    v.moveCaret(-5);
    expect(v.caret.value).toBe(0);
    v.moveCaret(1e6);
    expect(v.caret.value).toBe(100);
  });

  it('selects all and clears', () => {
    const v = view();
    v.selectAll();
    expect(v.selection.value).toEqual({ start: 0, end: 100, strand: 1 });
    v.clearSelection();
    expect(v.selection.value).toBeNull();
  });

  it('asks the renderer to scroll with a new request each time, even for the same position', () => {
    const v = view();
    v.reveal(40);
    const first = v.revealRequest.value;
    v.reveal(40);
    expect(first).toMatchObject({ position: 40 });
    expect(v.revealRequest.value?.nonce).toBe((first?.nonce ?? 0) + 1);
    v.goTo(70);
    expect(v.caret.value).toBe(70);
    expect(v.revealRequest.value?.position).toBe(70);
  });

  it('starts with every overlay on and the default line length', () => {
    const v = view();
    expect(v.overlays.value).toEqual({ feature: true, restriction: true, search: true, primer: true });
    expect(v.lineLength.value).toBe(60);
  });
});

describe('document state and feature edits', () => {
  const feature = (id: string, start: number, end: number): Feature => ({
    id,
    type: 'misc_feature',
    name: id,
    location: linearLocation(start, end, 1),
    origin: 'user',
  });
  const record: SeqRecord = {
    id: 'r',
    name: 'r',
    description: '',
    alphabet: 'dna',
    topology: 'linear',
    seq: 'ACGTACGTACGTACGTACGT',
    features: [],
    metadata: {},
  };
  const featuresOf = (id: string) => workspace.documents.value.find((d) => d.id === id)?.record.features;

  afterEach(() => {
    for (const doc of workspace.documents.value) workspace.close(doc.id);
  });

  it('gives every caller the same view state and history for a document', () => {
    const id = workspace.open(record);
    expect(viewOf(id)).toBe(viewOf(id));
    expect(historyOf(id)).toBe(historyOf(id));
    expect(viewOf(id)).not.toBe(viewOf(workspace.open(record)));
  });

  it('bounds the caret by the document length', () => {
    const id = workspace.open(record);
    viewOf(id).moveCaret(1000);
    expect(viewOf(id).caret.value).toBe(20);
  });

  it('forgets the state of a closed document', () => {
    const id = workspace.open(record);
    const view = viewOf(id);
    workspace.close(id);
    expect(viewOf(id)).not.toBe(view);
  });

  it('writes feature edits to the workspace record and undoes them through the active document', () => {
    const id = workspace.open(record);
    addFeature(id, feature('a', 0, 4));
    addFeature(id, feature('b', 4, 8));
    updateFeature(id, 'a', { name: 'renamed' });
    removeFeature(id, 'b');
    expect(featuresOf(id)?.map((f) => f.name)).toEqual(['renamed']);

    expect(undo()).toBe(true);
    expect(featuresOf(id)?.map((f) => f.id)).toEqual(['a', 'b']);
    expect(undo()).toBe(true);
    expect(featuresOf(id)?.map((f) => f.name)).toEqual(['a', 'b']);
    expect(redo()).toBe(true);
    expect(featuresOf(id)?.map((f) => f.name)).toEqual(['renamed', 'b']);
  });

  it('keeps each document history apart and undoes the active one only', () => {
    const first = workspace.open(record);
    const second = workspace.open(record);
    addFeature(first, feature('a', 0, 4));
    addFeature(second, feature('b', 0, 4));
    workspace.activate(first);
    undo();
    expect(featuresOf(first)).toEqual([]);
    expect(featuresOf(second)?.map((f) => f.id)).toEqual(['b']);
  });

  it('changes nothing for a document that is not open', () => {
    editFeatures('missing', 'x', () => []);
    expect(historyOf('missing').canUndo.value).toBe(false);
  });

  it('has nothing to undo with no active document', () => {
    workspace.showNewSequence();
    expect(undo()).toBe(false);
    expect(redo()).toBe(false);
  });
});
