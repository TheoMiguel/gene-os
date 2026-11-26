/**
 * Extra per-document state that a view wants in the project file and the stored session: the designed primers of
 * the primer designer, the strategies of the cloning view. A view registers once, at module load.
 *
 * `read` runs inside the autosave effect, so every signal it reads makes the session save when it changes. It
 * returns plain data that survives `JSON.stringify` and structured clone, or `undefined` when the document has
 * nothing to store. `write` receives the stored value, or nothing, when a document is restored; it must accept
 * values from older or damaged files and ignore what it does not recognise.
 *
 * A value that points at another document cannot hold that document's id, because every restored document gets a
 * new one. `read` writes the other document's position in the workspace instead. `resolve` runs once after all the
 * documents of a file or session are open and receives their new ids in the order they were saved, so position `n`
 * of the saved list is `ids[n]`.
 */
export interface ProjectSection {
  readonly key: string;
  read(docId: string): unknown;
  write(docId: string, value: unknown): void;
  resolve?(ids: readonly string[]): void;
}

const sections = new Map<string, ProjectSection>();

/** Registers a section. Returns a function that removes it. A second section with one key replaces the first. */
export function registerProjectSection(section: ProjectSection): () => void {
  sections.set(section.key, section);
  return () => {
    if (sections.get(section.key) === section) sections.delete(section.key);
  };
}

/** The values of every registered section for one document. A section with no value is left out. */
export function readSections(docId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const section of sections.values()) {
    const value = section.read(docId);
    if (value !== undefined) out[section.key] = value;
  }
  return out;
}

/** Hands each registered section the value stored for it. A section that throws does not stop the others. */
export function writeSections(docId: string, values: Readonly<Record<string, unknown>>): void {
  for (const section of sections.values()) {
    try {
      section.write(docId, values[section.key]);
    } catch {
      // A damaged section value must not stop the rest of the workspace from coming back.
    }
  }
}

/** Tells each registered section the new ids of the documents just restored. A section that throws does not stop the others. */
export function resolveSections(ids: readonly string[]): void {
  for (const section of sections.values()) {
    try {
      section.resolve?.(ids);
    } catch {
      // A damaged section value must not stop the rest of the workspace from coming back.
    }
  }
}
