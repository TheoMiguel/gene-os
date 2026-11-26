export type CopyResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

function copyWithSelection(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } finally {
    area.remove();
  }
}

/**
 * Puts `text` on the clipboard. Uses the async Clipboard API, and a hidden text area where the browser has
 * none or refuses it. Call it from a user gesture.
 */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
  } catch {
    // Fall through to the selection method.
  }
  try {
    return copyWithSelection(text) ? { ok: true } : { ok: false, reason: 'copy command refused' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
