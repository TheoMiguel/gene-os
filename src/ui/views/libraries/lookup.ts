import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  type DatabaseHit,
  fetchSequence,
  NetError,
  SEARCH_LIMIT,
  SERVICE_NAMES,
  type ServiceId,
  searchService,
} from '../../../net';
import { workspace } from '../../../state/documents';
import { notice, sfx } from '../../actions';
import { t } from '../../i18n';

/** What the database panel shows. A failure is its own phase, so it never reads as an empty result. */
export type LookupState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'working'; readonly task: 'search' | 'fetch' | 'open'; readonly service: ServiceId }
  | {
      readonly phase: 'results';
      readonly service: ServiceId;
      readonly hits: readonly DatabaseHit[];
      readonly capped: boolean;
    }
  | { readonly phase: 'done'; readonly service: ServiceId; readonly id: string }
  | { readonly phase: 'failed'; readonly error: NetError };

/** The message for a failed request: names the service and says what to do. */
export function netErrorMessage(error: unknown): string {
  if (error instanceof NetError)
    return t(`lib.db.error.${error.kind}`, { service: SERVICE_NAMES[error.service] });
  return t('lib.db.error.unreachable', { service: '' });
}

/** Opens a fetched record as a document and tells the user. */
function openRecord(record: Parameters<typeof workspace.open>[0]): void {
  workspace.open(record);
  notice.value = null;
  sfx('loaded');
}

/** The service a failed request was aimed at. */
export const failedService = (state: LookupState): ServiceId | null =>
  state.phase === 'failed' ? state.error.service : null;

/**
 * Database lookups for one panel: fetch by identifier, keyword search and opening result rows. One request runs
 * at a time; a new one cancels the old one, and unmounting cancels it too.
 */
export function useLookup() {
  const [state, setState] = useState<LookupState>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = async (
    working: LookupState,
    task: (signal: AbortSignal) => Promise<LookupState>,
  ): Promise<LookupState> => {
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;
    setState(working);
    try {
      const next = await task(own.signal);
      if (!own.signal.aborted) setState(next);
      return next;
    } catch (error) {
      const failed: LookupState = {
        phase: 'failed',
        error: error instanceof NetError ? error : new NetError('ncbi', 'unreachable'),
      };
      if (!own.signal.aborted) setState(failed);
      return failed;
    }
  };

  return {
    state,
    reset: () => {
      controller.current?.abort();
      setState({ phase: 'idle' });
    },

    /** Fetches `id` from `service` and opens it as a document. */
    fetchById: (service: ServiceId, id: string) =>
      run({ phase: 'working', task: 'fetch', service }, async (signal) => {
        openRecord(await fetchSequence(service, id, { signal }));
        return { phase: 'done', service, id };
      }),

    search: (service: ServiceId, query: string) =>
      run({ phase: 'working', task: 'search', service }, async (signal) => {
        const hits = await searchService(service, query, { signal });
        return { phase: 'results', service, hits, capped: hits.length >= SEARCH_LIMIT };
      }),

    /** Opens each hit in turn. Keeps the results on screen when it succeeds. */
    openHits: async (hits: readonly DatabaseHit[]) => {
      const results = state.phase === 'results' ? state : null;
      const first = hits[0];
      if (!first) return;
      const last = await run({ phase: 'working', task: 'open', service: first.service }, async (signal) => {
        for (const hit of hits) openRecord(await fetchSequence(hit.service, hit.id, { signal }));
        return { phase: 'done', service: first.service, id: hits.map((h) => h.id).join(', ') };
      });
      if (last.phase === 'done' && results) setState(results);
      else if (last.phase === 'done') setState(last);
    },
  };
}

/** Last service the user picked, kept for the session so the new-sequence view and the tab agree. */
export const preferredService = signal<ServiceId>('ncbi');
