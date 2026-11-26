import { computed, effect, type ReadonlySignal, type Signal, signal } from '@preact/signals';
import type { SearchHit, SearchMode } from '../engine/search';
import type { Frame } from '../engine/translate';
import type { Feature, Strand } from '../engine/types';
import { workspace } from './documents';

// ---------------------------------------------------------------------------
// Command stack
// ---------------------------------------------------------------------------

/** A reversible edit. `label` is for developers and menus to translate. `apply` runs it (and runs it again on redo); `invert` undoes exactly what `apply` did. */
export interface Command {
  readonly label: string;
  apply(): void;
  invert(): void;
}

export interface CommandStack {
  /** Runs `command`, records it and drops the redo branch. A command that throws is not recorded. */
  run(command: Command): void;
  /** Reverts the latest command. Returns false when there is none. */
  undo(): boolean;
  /** Re-applies the latest reverted command. Returns false when there is none. */
  redo(): boolean;
  clear(): void;
  readonly canUndo: ReadonlySignal<boolean>;
  readonly canRedo: ReadonlySignal<boolean>;
  /** Label of the command `undo` would revert, for a menu item or tooltip. */
  readonly undoLabel: ReadonlySignal<string | null>;
  readonly redoLabel: ReadonlySignal<string | null>;
}

const DEFAULT_HISTORY_LIMIT = 200;

/** A general undo/redo stack. The stack keeps the latest `limit` commands. */
export function createCommandStack(limit = DEFAULT_HISTORY_LIMIT): CommandStack {
  const done = signal<readonly Command[]>([]);
  const undone = signal<readonly Command[]>([]);
  return {
    run(command) {
      command.apply();
      done.value = [...done.peek(), command].slice(-limit);
      undone.value = [];
    },
    undo() {
      const command = done.peek().at(-1);
      if (!command) return false;
      command.invert();
      done.value = done.peek().slice(0, -1);
      undone.value = [...undone.peek(), command];
      return true;
    },
    redo() {
      const command = undone.peek().at(-1);
      if (!command) return false;
      command.apply();
      undone.value = undone.peek().slice(0, -1);
      done.value = [...done.peek(), command];
      return true;
    },
    clear() {
      done.value = [];
      undone.value = [];
    },
    canUndo: computed(() => done.value.length > 0),
    canRedo: computed(() => undone.value.length > 0),
    undoLabel: computed(() => done.value.at(-1)?.label ?? null),
    redoLabel: computed(() => undone.value.at(-1)?.label ?? null),
  };
}

/** A command that sets `target` to `next` and back, for view or parameter state that should be undoable. */
export function setSignalCommand<T>(label: string, target: Signal<T>, next: T): Command {
  let previous = target.peek();
  return {
    label,
    apply() {
      previous = target.peek();
      target.value = next;
    },
    invert() {
      target.value = previous;
    },
  };
}

// ---------------------------------------------------------------------------
// Per-document view state
// ---------------------------------------------------------------------------

/** A selected range on the top strand, 0-based half-open, with the strand the user selected on. */
export interface SelectionRange {
  readonly start: number;
  readonly end: number;
  readonly strand: Strand;
}

/** The bases currently on screen in the sequence view, 0-based half-open. */
export interface VisibleWindow {
  readonly start: number;
  readonly end: number;
}

export const OVERLAY_KINDS = ['feature', 'restriction', 'search', 'primer'] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

/** A coloured range on the top strand that the sequence renderer paints. A wrapping feature is two overlays. */
export interface Overlay {
  readonly id: string;
  readonly kind: OverlayKind;
  readonly start: number;
  readonly end: number;
  readonly strand?: Strand;
  /** Shown as a tooltip. */
  readonly label?: string;
  /** Any CSS color, a theme variable included. Absent means the color of the kind. */
  readonly color?: string;
}

export interface SearchState {
  readonly query: string;
  readonly mode: SearchMode;
}

export const DEFAULT_LINE_LENGTH = 60;

export interface SelectOptions {
  /** Keep the anchor and stretch the selection to the new caret. */
  readonly extend?: boolean;
  /** Strand of the new selection. Default: the current selection's, else the top strand. */
  readonly strand?: Strand;
}

/**
 * Everything the plasmid map, sequence viewer, primer designer and cloning view share about one document's
 * selection and display. Positions are 0-based; the caret sits between bases, so it ranges over `0..length`.
 */
export interface ViewState {
  readonly selection: Signal<SelectionRange | null>;
  readonly caret: Signal<number>;
  readonly window: Signal<VisibleWindow>;
  readonly frames: Signal<readonly Frame[]>;
  readonly search: Signal<SearchState>;
  readonly hits: Signal<readonly SearchHit[]>;
  /** Which overlay kinds the renderer shows. */
  readonly overlays: Signal<Readonly<Record<OverlayKind, boolean>>>;
  readonly lineLength: Signal<number>;
  /** Set by `reveal`; the sequence renderer scrolls to `position` whenever `nonce` changes. */
  readonly revealRequest: Signal<{ readonly position: number; readonly nonce: number } | null>;
  /** Selects `[start, end)`, clamped to the sequence. An empty range clears the selection and moves the caret. */
  select(start: number, end: number, strand?: Strand): void;
  /** Moves the caret, clamped to `0..length`. With `extend` the selection grows from the anchor to the caret. */
  moveCaret(position: number, options?: SelectOptions): void;
  selectAll(): void;
  clearSelection(): void;
  /** Asks the sequence renderer to scroll `position` into view. */
  reveal(position: number): void;
  /** "Jump to position": moves the caret, clears the selection and reveals the position. */
  goTo(position: number): void;
}

const allOverlays = (): Record<OverlayKind, boolean> => ({
  feature: true,
  restriction: true,
  search: true,
  primer: true,
});

const clamp = (value: number, max: number) => Math.min(Math.max(Math.trunc(value), 0), max);

/** Creates view state for a sequence of `length()` bases. `length` is read on every move, so edits stay in range. */
export function createViewState(length: () => number): ViewState {
  const selection = signal<SelectionRange | null>(null);
  const caret = signal(0);
  const revealRequest = signal<{ position: number; nonce: number } | null>(null);
  let anchor: number | null = null;

  const view: ViewState = {
    selection,
    caret,
    window: signal<VisibleWindow>({ start: 0, end: 0 }),
    frames: signal<readonly Frame[]>([]),
    search: signal<SearchState>({ query: '', mode: 'text' }),
    hits: signal<readonly SearchHit[]>([]),
    overlays: signal(allOverlays()),
    lineLength: signal(DEFAULT_LINE_LENGTH),
    revealRequest,

    select(start, end, strand = 1) {
      const max = length();
      const from = clamp(Math.min(start, end), max);
      const to = clamp(Math.max(start, end), max);
      if (from === to) {
        view.moveCaret(from);
        return;
      }
      anchor = from;
      caret.value = to;
      selection.value = { start: from, end: to, strand };
    },

    moveCaret(position, options = {}) {
      const next = clamp(position, length());
      if (options.extend) {
        anchor ??= caret.peek();
        const strand = options.strand ?? selection.peek()?.strand ?? 1;
        selection.value =
          anchor === next ? null : { start: Math.min(anchor, next), end: Math.max(anchor, next), strand };
      } else {
        anchor = null;
        selection.value = null;
      }
      caret.value = next;
    },

    selectAll() {
      view.select(0, length());
    },

    clearSelection() {
      anchor = null;
      selection.value = null;
    },

    reveal(position) {
      revealRequest.value = {
        position: clamp(position, length()),
        nonce: (revealRequest.peek()?.nonce ?? 0) + 1,
      };
    },

    goTo(position) {
      view.moveCaret(position);
      view.reveal(position);
    },
  };
  return view;
}

// ---------------------------------------------------------------------------
// Registry: one view state and one history per open document
// ---------------------------------------------------------------------------

interface DocumentState {
  readonly view: ViewState;
  readonly history: CommandStack;
}

const documentStates = new Map<string, DocumentState>();
const lengthOf = (docId: string) => () =>
  workspace.documents.value.find((doc) => doc.id === docId)?.record.seq.length ?? 0;

function stateOf(docId: string): DocumentState {
  let state = documentStates.get(docId);
  if (!state) {
    state = { view: createViewState(lengthOf(docId)), history: createCommandStack() };
    documentStates.set(docId, state);
  }
  return state;
}

/** The selection and display state of a document. The same object every call, so views stay in sync. */
export function viewOf(docId: string): ViewState {
  return stateOf(docId).view;
}

/** The undo history of a document. */
export function historyOf(docId: string): CommandStack {
  return stateOf(docId).history;
}

let knownIds = new Set<string>();
effect(() => {
  const open = new Set(workspace.documents.value.map((doc) => doc.id));
  for (const id of knownIds) if (!open.has(id)) documentStates.delete(id);
  knownIds = open;
});

/** Undoes the latest command of the active document. Returns false when there is nothing to undo. */
export function undo(): boolean {
  const id = workspace.activeId.peek();
  return id === null ? false : historyOf(id).undo();
}

/** Redoes the latest undone command of the active document. */
export function redo(): boolean {
  const id = workspace.activeId.peek();
  return id === null ? false : historyOf(id).redo();
}

// ---------------------------------------------------------------------------
// Feature edits through the stack
// ---------------------------------------------------------------------------

/** Runs a change to the document's feature list as one undoable command and keeps the workspace record in step. */
export function editFeatures(
  docId: string,
  label: string,
  edit: (features: readonly Feature[]) => readonly Feature[],
): void {
  const find = () => workspace.documents.peek().find((doc) => doc.id === docId);
  if (!find()) return;
  let before: readonly Feature[] = [];
  const write = (features: readonly Feature[]) => {
    const doc = find();
    if (doc) workspace.setRecord(docId, { ...doc.record, features });
  };
  historyOf(docId).run({
    label,
    apply() {
      before = find()?.record.features ?? [];
      write(edit(before));
    },
    invert() {
      write(before);
    },
  });
}

/** Adds a feature as an undoable edit. */
export function addFeature(docId: string, feature: Feature): void {
  editFeatures(docId, `add ${feature.name}`, (features) => [...features, feature]);
}

/** Removes the feature with `featureId` as an undoable edit. */
export function removeFeature(docId: string, featureId: string): void {
  editFeatures(docId, `remove ${featureId}`, (features) => features.filter((f) => f.id !== featureId));
}

/** Changes fields of one feature as an undoable edit. The id cannot change. */
export function updateFeature(docId: string, featureId: string, patch: Partial<Omit<Feature, 'id'>>): void {
  editFeatures(docId, `edit ${featureId}`, (features) =>
    features.map((f) => (f.id === featureId ? { ...f, ...patch } : f)),
  );
}
