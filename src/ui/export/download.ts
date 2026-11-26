export type SaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'cancelled' | 'failed' };

interface FileSystemAccessWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
}

const FORBIDDEN_IN_FILE_NAMES = new Set('\\/:*?"<>|');

/** A file name with the characters that file systems reject replaced, and a bounded length. */
export function safeFileName(name: string, fallback = 'gene-os'): string {
  const cleaned = [...name]
    .map((char) => (FORBIDDEN_IN_FILE_NAMES.has(char) || char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .trim()
    .slice(0, 120);
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? fallback : cleaned;
}

function downloadWithAnchor(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves `blob` under `suggestedName`. Uses the File System Access save dialog where the browser has it, so
 * the user picks the folder, and an anchor download everywhere else. A closed dialog gives `cancelled`.
 * Call it from a user gesture.
 */
export async function downloadBlob(blob: Blob, suggestedName: string): Promise<SaveResult> {
  const fileName = safeFileName(suggestedName);
  const picker = (window as FileSystemAccessWindow).showSaveFilePicker;
  if (picker) {
    try {
      const extension = /\.[A-Za-z0-9]+$/.exec(fileName)?.[0];
      const handle = await picker.call(window, {
        suggestedName: fileName,
        types: [
          {
            description: extension ? extension.slice(1).toUpperCase() : 'File',
            accept: { [blob.type || 'application/octet-stream']: extension ? [extension] : [] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { ok: true };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError')
        return { ok: false, reason: 'cancelled' };
      // A browser may refuse the dialog (no user gesture, blocked frame): try the anchor instead.
    }
  }
  try {
    downloadWithAnchor(blob, fileName);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Saves text under `suggestedName`. */
export function downloadText(
  text: string,
  suggestedName: string,
  mimeType = 'text/plain',
): Promise<SaveResult> {
  return downloadBlob(new Blob([text], { type: `${mimeType};charset=utf-8` }), suggestedName);
}
