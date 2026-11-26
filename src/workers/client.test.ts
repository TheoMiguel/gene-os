import { createInlineBackend, createWorkerBackend } from './client';
import type { AnalysisRequestMessage, AnalysisResponseMessage } from './protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  sent: AnalysisRequestMessage[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<AnalysisResponseMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: AnalysisRequestMessage) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(response: AnalysisResponseMessage) {
    this.onmessage?.({ data: response } as MessageEvent<AnalysisResponseMessage>);
  }
}

const input = { seq: 'ACGTACGT', topology: 'linear', alphabet: 'dna' } as const;
const job = (query: string) => ({ kind: 'search', input, params: { query } }) as const;
const spawn = () => new FakeWorker() as unknown as Worker;

beforeEach(() => {
  FakeWorker.instances = [];
});

describe('worker backend', () => {
  it('posts a typed request and hands back the matching response', () => {
    const backend = createWorkerBackend(spawn);
    const done = vi.fn();
    backend.start(job('ACG'), done);
    const [worker] = FakeWorker.instances;
    expect(worker?.sent).toEqual([{ id: 1, kind: 'search', input, params: { query: 'ACG' } }]);
    worker?.reply({ id: 1, ok: true, value: 42 });
    expect(done).toHaveBeenCalledWith({ ok: true, value: 42 });
  });

  it('reports a failure the worker returns', () => {
    const backend = createWorkerBackend(spawn);
    const done = vi.fn();
    backend.start(job('('), done);
    FakeWorker.instances[0]?.reply({ id: 1, ok: false, reason: 'bad regex' });
    expect(done).toHaveBeenCalledWith({ ok: false, reason: 'bad regex' });
  });

  it('restarts the worker on a cancel and sends the remaining jobs again', () => {
    const backend = createWorkerBackend(spawn);
    const first = vi.fn();
    const second = vi.fn();
    const cancelFirst = backend.start(job('A'), first);
    backend.start(job('C'), second);
    cancelFirst();
    const [old, fresh] = FakeWorker.instances;
    expect(old?.terminated).toBe(true);
    expect(fresh?.sent.map((m) => m.params)).toEqual([{ query: 'C' }]);
    fresh?.reply({ id: 2, ok: true, value: 'c' });
    old?.reply({ id: 1, ok: true, value: 'a' });
    expect(second).toHaveBeenCalledWith({ ok: true, value: 'c' });
    expect(first).not.toHaveBeenCalled();
  });

  it('fails every waiting job when the worker crashes', () => {
    const backend = createWorkerBackend(spawn);
    const done = vi.fn();
    backend.start(job('A'), done);
    FakeWorker.instances[0]?.onerror?.({ message: 'boom' } as ErrorEvent);
    expect(done).toHaveBeenCalledWith({ ok: false, reason: 'boom' });
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });
});

describe('inline backend', () => {
  it('runs the scan before start returns', () => {
    const done = vi.fn();
    createInlineBackend().start(job('ACG'), done);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]?.[0]).toMatchObject({ ok: true, value: { total: 4 } });
  });

  it('turns an engine error into a failure', () => {
    const done = vi.fn();
    createInlineBackend().start({ kind: 'search', input, params: { query: '(', mode: 'regex' } }, done);
    expect(done.mock.calls[0]?.[0]).toMatchObject({ ok: false });
  });
});
