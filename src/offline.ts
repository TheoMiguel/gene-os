/**
 * Offline support. The app is a static site whose analysis all runs locally, so once the files are in the
 * browser's cache it works with no network at all, which is what spec 11 promises.
 *
 * Registration is deliberately quiet: a browser without service workers, a page served over plain HTTP, or
 * a blocked registration all leave the app working exactly as before.
 */
export function registerOfflineSupport(): void {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // An unavailable cache costs offline use only; the app itself is unaffected.
    });
  });
}
