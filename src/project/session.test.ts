// @vitest-environment jsdom

import type { SeqRecord } from '../engine/types';
import { readSequenceText } from '../formats';
import { workspace } from '../state/documents';
import { viewOf } from '../state/view';
import { createSessionController } from './session';
import { memoryBackend, type SessionBackend, type SessionWrite } from './session-store';
import { projectName } from './snapshot';

function record(name: string, seq: string, topology: SeqRecord['topology'] = 'linear'): SeqRecord {
  const read = readSequenceText(`>${name}\n${seq}\n`);
  if (!read.ok || !read.records[0]) throw new Error('fixture failed');
  return { ...read.records[0], topology };
}

function closeAll() {
  for (const doc of workspace.documents.value) workspace.close(doc.id);
  projectName.value = '';
}

/** A memory backend that logs what each write held, so a test can see what was rewritten. */
function loggedBackend() {
  const backend = memoryBackend();
  const writes: SessionWrite[] = [];
  const write = backend.write.bind(backend);
  backend.write = async (change) => {
    writes.push(change);
    await write(change);
  };
  return { backend, writes };
}

const settle = () => vi.advanceTimersByTimeAsync(2000);

beforeEach(() => {
  closeAll();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  closeAll();
});

describe('session autosave', () => {
  it('writes the workspace after a quiet moment, not on every change', async () => {
    const { backend, writes } = loggedBackend();
    const session = createSessionController({ backend });
    const stop = session.start();
    const id = workspace.open(record('pUC19', 'ACGT'.repeat(100), 'circular'));
    viewOf(id).moveCaret(5);
    viewOf(id).moveCaret(9);
    expect(writes).toHaveLength(0);
    await settle();
    expect(writes).toHaveLength(1);
    expect([...backend.data.keys()].sort()).toEqual(['meta', `record:${id}`]);
    stop();
  });

  it('rewrites only the small entry when the view changes, never the sequence', async () => {
    const { backend, writes } = loggedBackend();
    const session = createSessionController({ backend });
    const stop = session.start();
    const id = workspace.open(record('big', 'ACGTTGCA'.repeat(625_000)));
    await settle();
    viewOf(id).select(100, 200);
    workspace.setActiveTab(id, 'digest');
    await settle();
    expect(writes).toHaveLength(2);
    expect(Object.keys(writes[0]?.puts ?? {})).toContain(`record:${id}`);
    expect(Object.keys(writes[1]?.puts ?? {})).toEqual(['meta']);
    stop();
  });

  it('removes the record of a closed document', async () => {
    const { backend } = loggedBackend();
    const session = createSessionController({ backend });
    const stop = session.start();
    const a = workspace.open(record('a', 'ACGTACGT'));
    workspace.open(record('b', 'GGGGCCCC'));
    await settle();
    workspace.close(a);
    await settle();
    expect(backend.data.has(`record:${a}`)).toBe(false);
    expect(backend.data.size).toBe(2);
    stop();
  });

  it('reports a failed write and keeps working', async () => {
    const backend: SessionBackend = {
      readAll: async () => new Map(),
      write: vi.fn().mockRejectedValue(new DOMException('full', 'QuotaExceededError')),
      clear: async () => {},
    };
    const onSaveFailed = vi.fn();
    const session = createSessionController({ backend, onSaveFailed });
    const stop = session.start();
    workspace.open(record('a', 'ACGTACGT'));
    await settle();
    expect(onSaveFailed).toHaveBeenCalledOnce();
    expect(session.status.value).toBe('failed');
    stop();
  });
});

describe('session restore', () => {
  async function saveThenReload(configure: () => void) {
    const { backend } = loggedBackend();
    const first = createSessionController({ backend });
    const stop = first.start();
    configure();
    await settle();
    stop();
    closeAll();
    return backend;
  }

  it('brings back the documents, the active tab, the view and the project name', async () => {
    const backend = await saveThenReload(() => {
      const a = workspace.open(record('pUC19', 'ACGT'.repeat(100), 'circular'));
      const b = workspace.open(record('read', 'GATTACA'.repeat(20)));
      workspace.setActiveTab(a, 'digest');
      viewOf(a).select(10, 40);
      workspace.activate(b);
      projectName.value = 'Lab 4';
    });
    const second = createSessionController({ backend });
    expect(await second.restore()).toEqual({ status: 'restored', documents: 2, skipped: 0 });
    const [a, b] = workspace.documents.value;
    expect(a?.record.name).toBe('pUC19');
    expect(a?.record.topology).toBe('circular');
    expect(a?.activeTab).toBe('digest');
    expect(viewOf(a?.id as string).selection.value).toMatchObject({ start: 10, end: 40 });
    expect(workspace.activeId.value).toBe(b?.id);
    expect(projectName.value).toBe('Lab 4');
  });

  it('writes the restored workspace under its new ids and removes the old entries', async () => {
    const backend = await saveThenReload(() => void workspace.open(record('a', 'ACGTACGT')));
    const session = createSessionController({ backend });
    await session.restore();
    const stop = session.start();
    await settle();
    const newId = workspace.documents.value[0]?.id as string;
    expect([...backend.data.keys()].sort()).toEqual(['meta', `record:${newId}`]);
    stop();
  });

  it('survives a 5 Mb sequence next to other documents', async () => {
    const backend = await saveThenReload(() => {
      workspace.open(record('big', 'ACGTTGCA'.repeat(625_000)));
      workspace.open(record('small', 'ACGTACGT'));
      workspace.open(record('mid', 'ACGTTGCA'.repeat(10_000), 'circular'));
    });
    const session = createSessionController({ backend });
    expect(await session.restore()).toMatchObject({ status: 'restored', documents: 3 });
    expect(workspace.documents.value[0]?.record.seq.length).toBe(5_000_000);
  });

  it('starts empty when nothing is stored', async () => {
    expect(await createSessionController({ backend: memoryBackend() }).restore()).toEqual({
      status: 'empty',
    });
  });

  it('clears damaged data and starts empty', async () => {
    const backend = memoryBackend();
    backend.data.set('meta', 'garbage');
    backend.data.set('record:doc-1', { seq: 7 });
    expect(await createSessionController({ backend }).restore()).toEqual({ status: 'corrupt' });
    expect(backend.data.size).toBe(0);
    expect(workspace.documents.value).toHaveLength(0);
  });

  it('drops one damaged record and restores the rest', async () => {
    const backend = await saveThenReload(() => {
      workspace.open(record('a', 'ACGTACGT'));
      workspace.open(record('b', 'GGGGCCCC'));
    });
    const key = [...backend.data.keys()].find((k) => k.startsWith('record:')) as string;
    backend.data.set(key, { not: 'a record' });
    expect(await createSessionController({ backend }).restore()).toEqual({
      status: 'restored',
      documents: 1,
      skipped: 1,
    });
  });

  it('leaves a session from a newer version untouched until the workspace changes', async () => {
    const backend = await saveThenReload(() => void workspace.open(record('a', 'ACGTACGT')));
    const meta = backend.data.get('meta') as Record<string, unknown>;
    backend.data.set('meta', { ...meta, version: 99 });
    const before = new Map(backend.data);
    const session = createSessionController({ backend });
    expect(await session.restore()).toEqual({ status: 'newer', version: 99 });
    const stop = session.start();
    await settle();
    expect(new Map(backend.data)).toEqual(before);
    workspace.open(record('b', 'GGGGCCCC'));
    await settle();
    expect((backend.data.get('meta') as { version: number }).version).toBe(1);
    stop();
  });

  it('reports unavailable storage without throwing', async () => {
    const backend: SessionBackend = {
      readAll: () => Promise.reject(new Error('blocked')),
      write: async () => {},
      clear: async () => {},
    };
    expect(await createSessionController({ backend }).restore()).toEqual({ status: 'unavailable' });
  });

  it('clears the stored session on request and keeps the open documents', async () => {
    const { backend } = loggedBackend();
    const session = createSessionController({ backend });
    const stop = session.start();
    workspace.open(record('a', 'ACGTACGT'));
    await settle();
    expect(backend.data.size).toBe(2);
    await session.clear();
    expect(backend.data.size).toBe(0);
    expect(workspace.documents.value).toHaveLength(1);
    workspace.open(record('b', 'GGGGCCCC'));
    await settle();
    expect(backend.data.size).toBe(3);
    stop();
  });
});
