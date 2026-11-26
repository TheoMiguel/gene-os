/** File extensions the new-sequence view offers in the picker (spec 3.5). */
export const SEQUENCE_EXTENSIONS = [
  '.fasta',
  '.fa',
  '.fna',
  '.ffn',
  '.faa',
  '.gb',
  '.gbk',
  '.genbank',
  '.embl',
  '.dna',
  '.ab1',
  '.abi',
  '.txt',
  '.seq',
] as const;

interface FileSystemAccessWindow {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    excludeAcceptAllOption: boolean;
    types: { description: string; accept: Record<string, readonly string[]> }[];
  }) => Promise<{ getFile(): Promise<File> }[]>;
}

function pickWithInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = SEQUENCE_EXTENSIONS.join(',');
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

/**
 * Asks the user for sequence files. Uses the File System Access API where the browser has it, else a file
 * input. Resolves to an empty list when the user cancels. Call it from a user gesture. `typeLabel` names
 * the file type in the system dialog.
 */
export async function pickSequenceFiles(typeLabel: string): Promise<File[]> {
  const picker = (window as FileSystemAccessWindow).showOpenFilePicker;
  if (!picker) return pickWithInput();
  try {
    const handles = await picker.call(window, {
      multiple: true,
      excludeAcceptAllOption: false,
      types: [{ description: typeLabel, accept: { 'application/octet-stream': SEQUENCE_EXTENSIONS } }],
    });
    return Promise.all(handles.map((handle) => handle.getFile()));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return [];
    throw error;
  }
}
