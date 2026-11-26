import { NetError, type RequestContext, type ServiceId } from './types';

/** Longest wait for one response. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Least gap between two requests to one service. NCBI allows about three requests a second without an API key,
 * so 340 ms keeps one tab under the limit. The other services publish no per-second limit that a person reaches.
 */
export const MIN_INTERVAL_MS: Readonly<Record<ServiceId, number>> = { ncbi: 340, ena: 0, uniprot: 0 };

const nextSlot = new Map<ServiceId, number>();

function sleep(ms: number, signal: AbortSignal | undefined, service: ServiceId): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(new NetError(service, 'cancelled'));
    if (signal?.aborted) return cancelled();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cancelled();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Waits for this service's next free slot and claims it. Calls queue in order, so a burst is spread out. */
async function takeSlot(service: ServiceId, signal: AbortSignal | undefined): Promise<void> {
  const interval = MIN_INTERVAL_MS[service];
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(service) ?? 0);
  nextSlot.set(service, slot + interval);
  if (slot > now) await sleep(slot - now, signal, service);
}

/** Forgets the claimed slots. Tests call it between cases. */
export function resetRateLimits(): void {
  nextSlot.clear();
}

function failureOfStatus(service: ServiceId, status: number): NetError {
  if (status === 429) return new NetError(service, 'rateLimited', status);
  if (status === 404) return new NetError(service, 'notFound', status);
  if (status === 400) return new NetError(service, 'invalidIdentifier', status);
  return new NetError(service, 'serverError', status);
}

/**
 * GETs `url` and returns the body text. Sends no cookies, no referrer and no custom header, so the request is a
 * plain cross-origin read and carries nothing but the URL the caller built. Throws `NetError` for every failure:
 * offline, timeout, a cancelled call, a refused or unreachable service, and any HTTP error status.
 */
export async function getText(service: ServiceId, url: URL, context: RequestContext = {}): Promise<string> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetError(service, 'offline');
  await takeSlot(service, context.signal);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  context.signal?.addEventListener('abort', onCallerAbort, { once: true });
  if (context.signal?.aborted) controller.abort();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw failureOfStatus(service, response.status);
    return await response.text();
  } catch (error) {
    if (error instanceof NetError) throw error;
    if (timedOut) throw new NetError(service, 'timeout');
    if (context.signal?.aborted) throw new NetError(service, 'cancelled');
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new NetError(service, offline ? 'offline' : 'unreachable');
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** Parses a JSON body; a body that is not JSON is a bad response from `service`, not an empty result. */
export function parseJson(service: ServiceId, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new NetError(service, 'badResponse');
  }
}
