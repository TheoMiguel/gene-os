import { effect, signal } from '@preact/signals';
import type { SeqRecord } from '../engine/types';
import { type DocumentStore, workspace } from '../state/documents';
import { parseProject } from './parse';
import { indexedDbBackend, type SessionBackend } from './session-store';
import { applyProject, captureDocumentState, persistableRecord, projectName } from './snapshot';
import { PROJECT_FORMAT, PROJECT_VERSION } from './types';

const META_KEY = 'meta';
const RECORD_PREFIX = 'record:';
const recordKey = (docId: string) => `${RECORD_PREFIX}${docId}`;

/** What a restore found. The interface turns each status into a message, or into none. */
export type RestoreOutcome =
  | { readonly status: 'empty' }
  | { readonly status: 'restored'; readonly documents: number; readonly skipped: number }
  /** The stored data was damaged or unreadable. It was cleared and the workspace starts empty. */
  | { readonly status: 'corrupt' }
  /** A newer GENE_OS version wrote the session. It stays untouched until the workspace changes. */
  | { readonly status: 'newer'; readonly version: number }
  /** The browser has no usable IndexedDB (private mode, blocked storage). The session is not kept. */
  | { readonly status: 'unavailable' };

export interface SessionOptions {
  readonly backend: SessionBackend;
  readonly store?: DocumentStore;
  /** Quiet time after the last change before the session is written. Default 800 ms. */
  readonly debounceMs?: number;
  /** Called when a write fails, e.g. the browser's storage quota is full. */
  readonly onSaveFailed?: (error: unknown) => void;
}

interface PendingSave {
  readonly meta: Record<string, unknown>;
  readonly records: ReadonlyMap<string, SeqRecord>;
}

/** Runs `task` when the browser is idle, or after a timeout where it has no idle callback. */
function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(task, { timeout: 3000 });
  else setTimeout(task, 0);
}

/**
 * Keeps the workspace in a backend and brings it back. The session splits in two: one small `meta` entry (tabs,
 * view configuration, project name) and one entry per document record. A change to the view rewrites only the
 * small entry, so moving the caret in a 5 Mb sequence never writes 5 Mb. Writes wait for a quiet moment, then
 * run when the browser is idle.
 */
export function createSessionController(options: SessionOptions) {
  const { backend, store = workspace, debounceMs = 800, onSaveFailed } = options;
  /** The record object stored under each document id; reference equality says whether a record changed. */
  const written = new Map<string, SeqRecord>();
  /** Record entries found in storage that the next write must remove: documents of an earlier launch. */
  let stale: string[] = [];
  const status = signal<'idle' | 'saving' | 'failed'>('idle');
  let pending: PendingSave | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  function capture(): PendingSave {
    const docs = store.documents.value;
    const meta = {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      name: projectName.value,
      savedAt: new Date().toISOString(),
      activeId: store.activeId.value,
      documents: docs.map((doc) => ({ id: doc.id, ...captureDocumentState(doc) })),
    };
    return { meta, records: new Map(docs.map((doc) => [doc.id, doc.record])) };
  }

  async function write(save: PendingSave): Promise<void> {
    const puts: Record<string, unknown> = { [META_KEY]: save.meta };
    const changed: string[] = [];
    for (const [id, record] of save.records)
      if (written.get(id) !== record) {
        puts[recordKey(id)] = persistableRecord(record);
        changed.push(id);
      }
    const gone = [...written.keys()].filter((id) => !save.records.has(id)).map(recordKey);
    const deletes = [...new Set([...gone, ...stale.filter((key) => !(key in puts))])];
    status.value = 'saving';
    try {
      await backend.write({ puts, deletes });
      for (const id of changed) written.set(id, save.records.get(id) as SeqRecord);
      for (const key of gone) written.delete(key.slice(RECORD_PREFIX.length));
      stale = [];
      status.value = 'idle';
    } catch (error) {
      status.value = 'failed';
      onSaveFailed?.(error);
    }
  }

  /** Writes the latest captured state now. Runs after any write in flight, so writes never overlap. */
  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const save = pending;
    pending = null;
    if (save) chain = chain.then(() => write(save));
    return chain;
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => whenIdle(() => void flush()), debounceMs);
  }

  return {
    status,

    /** Rebuilds the workspace from the backend. Call once, before `start`. Never throws. */
    async restore(): Promise<RestoreOutcome> {
      let stored: ReadonlyMap<string, unknown>;
      try {
        stored = await backend.readAll();
      } catch {
        return { status: 'unavailable' };
      }
      if (stored.size === 0) return { status: 'empty' };
      stale = [...stored.keys()].filter((key) => key.startsWith(RECORD_PREFIX));

      const corrupt = async (): Promise<RestoreOutcome> => {
        try {
          await backend.clear();
        } catch {
          // The data stays unreadable either way; the next successful write replaces it.
        }
        stale = [];
        return { status: 'corrupt' };
      };

      const meta = stored.get(META_KEY);
      if (
        typeof meta !== 'object' ||
        meta === null ||
        !Array.isArray((meta as { documents?: unknown }).documents)
      )
        return corrupt();
      const { documents, activeId, version, name, format } = meta as {
        documents: { id?: unknown; activeTab?: unknown; view?: unknown; sections?: unknown }[];
        activeId?: unknown;
        version?: unknown;
        name?: unknown;
        format?: unknown;
      };
      const parsed = parseProject({
        format,
        version,
        name,
        activeIndex: documents.findIndex(
          (doc) => doc !== null && typeof doc === 'object' && doc.id === activeId,
        ),
        documents: documents.map((doc) => ({
          record: stored.get(recordKey(String(doc?.id))),
          activeTab: doc?.activeTab,
          view: doc?.view,
          sections: doc?.sections,
        })),
      });
      if (!parsed.ok) {
        if (parsed.reason === 'newerVersion') return { status: 'newer', version: parsed.version ?? 0 };
        return corrupt();
      }
      applyProject(parsed.data, store);
      written.clear();
      pending = capture();
      schedule();
      return { status: 'restored', documents: parsed.data.documents.length, skipped: parsed.skipped };
    },

    /**
     * Starts saving every change. The state at this moment is the baseline and is not rewritten, so starting
     * after a refused newer session leaves it intact until the user changes something. Returns a stop function.
     */
    start(): () => void {
      let first = true;
      const stop = effect(() => {
        const save = capture();
        if (first) {
          first = false;
          return;
        }
        pending = save;
        schedule();
      });
      const onHide = () => {
        if (document.visibilityState === 'hidden') void flush();
      };
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onHide);
      return () => {
        stop();
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', onHide);
        clearTimeout(timer);
      };
    },

    flush,

    /** Empties the stored session. Open documents stay open and are saved again after the next change. */
    async clear(): Promise<void> {
      clearTimeout(timer);
      pending = null;
      await chain;
      written.clear();
      stale = [];
      await backend.clear();
    },
  };
}

export type SessionController = ReturnType<typeof createSessionController>;

let shared: SessionController | null = null;

/** The app's session controller, on IndexedDB. */
export function sessionController(): SessionController {
  shared ??= createSessionController({ backend: indexedDbBackend() });
  return shared;
}
