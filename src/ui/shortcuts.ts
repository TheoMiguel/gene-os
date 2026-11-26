/** A Ctrl (or Cmd) chord. `nativeInFields` leaves the browser's own action alone inside text fields. */
interface Chord {
  readonly key: string;
  readonly shift?: boolean;
  readonly nativeInFields?: boolean;
}

/** The keyboard shortcuts of spec 9. A shortcut without a handler is not intercepted. */
export const SHORTCUTS = {
  newTab: { key: 'n' },
  closeTab: { key: 'w' },
  openFile: { key: 'o' },
  save: { key: 's' },
  find: { key: 'f' },
  undo: { key: 'z', nativeInFields: true },
  redo: { key: 'y', nativeInFields: true },
  redoAlt: { key: 'z', shift: true, nativeInFields: true },
  copy: { key: 'c', nativeInFields: true },
  selectAll: { key: 'a', nativeInFields: true },
  goTo: { key: 'g' },
  export: { key: 'e' },
} as const satisfies Record<string, Chord>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** The parts of a keyboard event the registry reads. */
export type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'target' | 'preventDefault'
>;

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches('input, textarea, select');
}

function matches(chord: Chord, event: ShortcutEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.shiftKey === (chord.shift ?? false) &&
    event.key.toLowerCase() === chord.key
  );
}

/** Maps spec 9 chords to handlers. Later phases attach handlers to the shortcuts that have none yet. */
export function createShortcutRegistry() {
  const handlers = new Map<ShortcutId, () => void>();
  const ids = Object.keys(SHORTCUTS) as ShortcutId[];

  return {
    /** Attaches the handler for `id`, replacing any earlier one. Returns a function that detaches it. */
    on(id: ShortcutId, handler: () => void): () => void {
      handlers.set(id, handler);
      return () => {
        if (handlers.get(id) === handler) handlers.delete(id);
      };
    },

    /** Runs the handler that matches `event` and cancels the browser default. Returns true when one ran. */
    handle(event: ShortcutEvent): boolean {
      const id = ids.find((candidate) => matches(SHORTCUTS[candidate], event));
      if (!id) return false;
      const chord: Chord = SHORTCUTS[id];
      const handler = handlers.get(id);
      if (!handler || (chord.nativeInFields && isTextField(event.target))) return false;
      event.preventDefault();
      handler();
      return true;
    },
  };
}

/** The app's shortcut registry. */
export const shortcuts = createShortcutRegistry();
