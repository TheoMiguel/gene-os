/**
 * Offline support. The app is a static site whose analysis all runs locally, so once the files are in the
 * browser's cache it works with no network at all, which is what spec 11 promises.
 *
 * Every path here is relative to the page, because the app is also served under a project path such as
 * /gene-os/. A worker registered there controls that folder and nothing above it, which is what we want.
 *
 * Registration is deliberately quiet: a browser without service workers, a page served over plain HTTP, or
 * a blocked registration all leave the app working exactly as before.
 */
export function registerOfflineSupport(): void {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  const base = new URL(import.meta.env.BASE_URL, location.href);
  addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname }).catch(() => {
      // An unavailable cache costs offline use only; the app itself is unaffected.
    });
  });
}
