import { effect, type ReadonlySignal, signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { Alphabet, Topology } from '../engine/types';
import { type AnalysisBackend, createDefaultBackend } from '../workers/client';
import { type AnalysisKind, type ParamsOf, type ResultOf, stableKey } from '../workers/protocol';
import { type SeqDocument, workspace } from './documents';

/** What a view sees of one scan: still running, done, or failed with a reason. */
export type AnalysisState<T> =
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'failed'; readonly reason: string };

/** Most results kept per document. The oldest finished ones go first. */
export const MAX_CACHED_RESULTS = 32;

interface Entry {
  readonly state: ReturnType<typeof signal<AnalysisState<unknown>>>;
  /** Hooks currently showing this result. */
  watchers: number;
  settled: boolean;
  cancel: (() => void) | null;
  dropped: boolean;
}

interface DocumentCache {
  readonly seq: string;
  readonly topology: Topology;
  readonly alphabet: Alphabet;
  /** Insertion order is least-recently-used first. */
  readonly entries: Map<string, Entry>;
}

const caches = new Map<string, DocumentCache>();
let backend: AnalysisBackend | null = null;

/** Replaces where scans run, or restores the default (a worker, or the inline path without workers) with `null`. */
export function setAnalysisBackend(next: AnalysisBackend | null): void {
  backend = next;
  clearAnalysisCache();
}

function drop(cache: DocumentCache, key: string, entry: Entry): void {
  entry.dropped = true;
  entry.cancel?.();
  entry.cancel = null;
  if (cache.entries.get(key) === entry) cache.entries.delete(key);
}

function disposeDocument(docId: string): void {
  const cache = caches.get(docId);
  if (!cache) return;
  for (const [key, entry] of cache.entries) drop(cache, key, entry);
  caches.delete(docId);
}

/** Forgets every cached result and cancels every running scan. */
export function clearAnalysisCache(): void {
  for (const docId of [...caches.keys()]) disposeDocument(docId);
}

effect(() => {
  const docs = workspace.documents.value;
  for (const [docId, cache] of caches) {
    const doc = docs.find((candidate) => candidate.id === docId);
    if (!doc || doc.record.seq !== cache.seq || doc.record.topology !== cache.topology)
      disposeDocument(docId);
  }
});

function cacheOf(doc: SeqDocument): DocumentCache {
  const { seq, topology, alphabet } = doc.record;
  let cache = caches.get(doc.id);
  if (cache && (cache.seq !== seq || cache.topology !== topology || cache.alphabet !== alphabet)) {
    disposeDocument(doc.id);
    cache = undefined;
  }
  if (!cache) {
    cache = { seq, topology, alphabet, entries: new Map() };
    caches.set(doc.id, cache);
  }
  return cache;
}

function evict(cache: DocumentCache): void {
  for (const [key, entry] of cache.entries) {
    if (cache.entries.size <= MAX_CACHED_RESULTS) return;
    if (entry.settled && entry.watchers === 0) drop(cache, key, entry);
  }
}

function entryFor<K extends AnalysisKind>(doc: SeqDocument, kind: K, params: ParamsOf<K>): Entry {
  const cache = cacheOf(doc);
  const key = `${kind}:${stableKey(params)}`;
  const known = cache.entries.get(key);
  if (known) {
    cache.entries.delete(key);
    cache.entries.set(key, known);
    return known;
  }

  const entry: Entry = {
    state: signal<AnalysisState<unknown>>({ status: 'pending' }),
    watchers: 0,
    settled: false,
    cancel: null,
    dropped: false,
  };
  cache.entries.set(key, entry);
  const { seq, topology, alphabet } = cache;
  backend ??= createDefaultBackend();
  const cancel = backend.start({ kind, input: { seq, topology, alphabet }, params }, (outcome) => {
    entry.settled = true;
    entry.cancel = null;
    if (entry.dropped) return;
    entry.state.value = outcome.ok
      ? { status: 'ready', value: outcome.value }
      : { status: 'failed', reason: outcome.reason };
  });
  if (!entry.settled) entry.cancel = cancel;
  evict(cache);
  return entry;
}

/**
 * The result of one scan of a workspace document, cached per document: asking again with the same parameters
 * returns the same signal and never recomputes. A sequence edit or closing the document discards the results.
 * Prefer `useAnalysis` inside a component, which also cancels a scan that its own parameters replaced.
 */
export function analysisSignal<K extends AnalysisKind>(
  doc: SeqDocument,
  kind: K,
  params: ParamsOf<K>,
): ReadonlySignal<AnalysisState<ResultOf<K>>> {
  return entryFor(doc, kind, params).state as ReadonlySignal<AnalysisState<ResultOf<K>>>;
}

/**
 * Reads one scan inside a component and re-renders when it finishes. When the parameters change while the
 * previous scan still runs and nothing else shows it, that scan is cancelled. Leaving the view cancels nothing,
 * so returning to a tab shows the finished result at once.
 */
export function useAnalysis<K extends AnalysisKind>(
  doc: SeqDocument,
  kind: K,
  params: ParamsOf<K>,
): AnalysisState<ResultOf<K>> {
  const entry = entryFor(doc, kind, params);
  const held = useRef<Entry | null>(null);
  const key = `${doc.id}:${kind}:${stableKey(params)}`;

  useEffect(() => {
    const previous = held.current;
    held.current = entry;
    entry.watchers++;
    if (previous && previous !== entry) {
      previous.watchers--;
      if (previous.watchers <= 0 && previous.cancel) {
        const cache = caches.get(doc.id);
        const stale = cache && [...cache.entries].find(([, candidate]) => candidate === previous);
        if (cache && stale) drop(cache, stale[0], previous);
      }
    }
  }, [key, entry, doc.id]);

  useEffect(
    () => () => {
      if (held.current) held.current.watchers--;
      held.current = null;
    },
    [],
  );

  return entry.state.value as AnalysisState<ResultOf<K>>;
}
