import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { notice } from '../ui/actions';
import type { MessageKey } from '../ui/i18n';
import { type RestoreOutcome, sessionController } from './session';

const NOTICE_OF: Partial<Record<RestoreOutcome['status'], MessageKey>> = {
  corrupt: 'session.corrupt',
  newer: 'session.newer',
};

/**
 * Brings the last workspace back when the app opens and keeps it saved while the user works (spec 8.1). It
 * renders nothing. A damaged or newer session is reported once; a browser with no usable IndexedDB keeps no
 * session, and the app says so only when the browser has IndexedDB but refused it.
 */
export function SessionPersistence() {
  useEffect(() => {
    const session = sessionController();
    let stop = () => {};
    let cancelled = false;
    const watchFailures = effect(() => {
      if (session.status.value === 'failed') notice.value = { key: 'session.saveFailed', tone: 'error' };
    });
    void session.restore().then((outcome) => {
      if (cancelled) return;
      const key = NOTICE_OF[outcome.status];
      if (key) notice.value = { key, tone: 'info' };
      if (outcome.status === 'unavailable') {
        if (typeof indexedDB !== 'undefined') notice.value = { key: 'session.unavailable', tone: 'info' };
        return;
      }
      stop = session.start();
    });
    return () => {
      cancelled = true;
      stop();
      watchFailures();
    };
  }, []);
  return null;
}
