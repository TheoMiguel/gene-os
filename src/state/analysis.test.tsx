// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/preact';
import { PUC19 } from '../../tests/fixtures/restriction/fixtures';
import type { SeqRecord } from '../engine/types';
import type { AnalysisBackend, AnalysisJob, AnalysisOutcome } from '../workers/client';
import { createInlineBackend } from '../workers/client';
import {
  type AnalysisState,
  analysisSignal,
  clearAnalysisCache,
  MAX_CACHED_RESULTS,
  setAnalysisBackend,
  useAnalysis,
} from './analysis';
import { type SeqDocument, workspace } from './documents';

const record = (seq: string, name = 'test'): SeqRecord => ({
  id: name,
  name,
  description: '',
  alphabet: 'dna',
  topology: 'linear',
  seq,
  features: [],
  metadata: {},
});

/** A backend that holds every job until the test settles it. */
function deferredBackend() {
  const jobs: { job: AnalysisJob; done: (o: AnalysisOutcome) => void; cancelled: boolean }[] = [];
  const backend: AnalysisBackend = {
    start(job, done) {
      const entry = { job, done, cancelled: false };
      jobs.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };
  return { backend, jobs };
}

const open = (seq: string): SeqDocument => {
  const id = workspace.open(record(seq));
  return workspace.documents.value.find((doc) => doc.id === id) as SeqDocument;
};

afterEach(() => {
  cleanup();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
  setAnalysisBackend(null);
});

describe('analysisSignal', () => {
  it('is pending until the backend answers, then ready', () => {
    const { backend, jobs } = deferredBackend();
    setAnalysisBackend(backend);
    const sig = analysisSignal(open(PUC19), 'search', { query: 'GAATTC' });
    expect(sig.value).toEqual({ status: 'pending' });
    jobs[0]?.done({ ok: true, value: { total: 1 } });
    expect(sig.value).toEqual({ status: 'ready', value: { total: 1 } });
  });

  it('is ready at once on the inline backend', () => {
    setAnalysisBackend(createInlineBackend());
    const sig = analysisSignal(open(PUC19), 'search', { query: 'GAATTC' });
    expect(sig.value.status).toBe('ready');
  });

  it('reports a failure with its reason', () => {
    setAnalysisBackend(createInlineBackend());
    const sig = analysisSignal(open(PUC19), 'search', { query: '(', mode: 'regex' });
    expect(sig.value.status).toBe('failed');
  });

  it('never recomputes for the same document and parameters, whatever their key order', () => {
    const { backend, jobs } = deferredBackend();
    setAnalysisBackend(backend);
    const doc = open(PUC19);
    const a = analysisSignal(doc, 'search', { query: 'GAATTC', mode: 'text' });
    const b = analysisSignal(doc, 'search', { mode: 'text', query: 'GAATTC' });
    expect(b).toBe(a);
    expect(jobs).toHaveLength(1);
    analysisSignal(doc, 'search', { query: 'GGATCC' });
    expect(jobs).toHaveLength(2);
  });

  it('keeps results per document, so switching documents recomputes nothing', () => {
    const { backend, jobs } = deferredBackend();
    setAnalysisBackend(backend);
    const first = open(PUC19);
    const second = open('ACGTACGTACGT');
    analysisSignal(first, 'search', { query: 'A' });
    analysisSignal(second, 'search', { query: 'A' });
    analysisSignal(first, 'search', { query: 'A' });
    expect(jobs).toHaveLength(2);
  });

  it('cancels running scans and forgets results when the document closes', () => {
    const { backend, jobs } = deferredBackend();
    setAnalysisBackend(backend);
    const doc = open(PUC19);
    const sig = analysisSignal(doc, 'search', { query: 'A' });
    workspace.close(doc.id);
    expect(jobs[0]?.cancelled).toBe(true);
    jobs[0]?.done({ ok: true, value: { total: 1 } });
    expect(sig.value.status).toBe('pending');
  });

  it('discards results when the sequence changes, but not when only features change', () => {
    const { backend, jobs } = deferredBackend();
    setAnalysisBackend(backend);
    const doc = open(PUC19);
    analysisSignal(doc, 'search', { query: 'A' });
    workspace.setRecord(doc.id, { ...doc.record, features: [] });
    const unchanged = workspace.documents.value.find((d) => d.id === doc.id) as SeqDocument;
    analysisSignal(unchanged, 'search', { query: 'A' });
    expect(jobs).toHaveLength(1);

    workspace.setRecord(doc.id, { ...doc.record, seq: `${PUC19}A` });
    expect(jobs[0]?.cancelled).toBe(true);
    const edited = workspace.documents.value.find((d) => d.id === doc.id) as SeqDocument;
    analysisSignal(edited, 'search', { query: 'A' });
    expect(jobs).toHaveLength(2);
  });

  it('bounds the cache by dropping the oldest finished results', () => {
    const { backend, jobs } = deferredBackend();
    setAnalysisBackend(backend);
    const doc = open(PUC19);
    for (let i = 0; i <= MAX_CACHED_RESULTS; i++) {
      analysisSignal(doc, 'search', { query: `A${i}` });
      jobs[i]?.done({ ok: true, value: i });
    }
    analysisSignal(doc, 'search', { query: 'A0' });
    expect(jobs).toHaveLength(MAX_CACHED_RESULTS + 2);
    clearAnalysisCache();
  });
});

describe('useAnalysis', () => {
  function Probe({ doc, query, seen }: { doc: SeqDocument; query: string; seen: AnalysisState<unknown>[] }) {
    seen.push(useAnalysis(doc, 'search', { query }));
    return null;
  }

  it('cancels the scan its own parameters replaced, and none on unmount', async () => {
    const { backend, jobs } = deferredBackend();
    setAnalysisBackend(backend);
    const doc = open(PUC19);
    const seen: AnalysisState<unknown>[] = [];
    const view = render(<Probe doc={doc} query="AAA" seen={seen} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.rerender(<Probe doc={doc} query="CCC" seen={seen} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jobs.map((j) => j.cancelled)).toEqual([true, false]);

    view.unmount();
    expect(jobs.map((j) => j.cancelled)).toEqual([true, false]);
  });

  it('re-renders with the value when the scan finishes', async () => {
    const { backend, jobs } = deferredBackend();
    setAnalysisBackend(backend);
    const doc = open(PUC19);
    const seen: AnalysisState<unknown>[] = [];
    render(<Probe doc={doc} query="AAA" seen={seen} />);
    expect(seen.at(-1)?.status).toBe('pending');
    jobs[0]?.done({ ok: true, value: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen.at(-1)).toEqual({ status: 'ready', value: 'done' });
  });
});
