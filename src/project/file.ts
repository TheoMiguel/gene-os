import { downloadBlob, type SaveResult, safeFileName } from '../ui/export/download';
import { parseProjectText } from './parse';
import { applyProject, captureProject, projectName } from './snapshot';
import type { ProjectData, ProjectParse, ProjectRefusal } from './types';

/** File extension of a GENE_OS project. The content is JSON. */
export const PROJECT_EXTENSION = '.geneos';
export const PROJECT_MIME = 'application/json';

/** The project as file text. */
export function serializeProject(data: ProjectData): string {
  return JSON.stringify(data);
}

/** The file name a project saves under: the project name, else the first document's name, else `gene-os`. */
export function projectFileName(data: ProjectData): string {
  const base = data.name.trim() || data.documents[0]?.record.name || 'gene-os';
  return `${safeFileName(base)}${PROJECT_EXTENSION}`;
}

/** Saves the workspace as a project file, through the native save dialog where the browser has one. */
export function saveProject(): Promise<SaveResult> {
  const data = captureProject();
  return downloadBlob(new Blob([serializeProject(data)], { type: PROJECT_MIME }), projectFileName(data));
}

interface OpenPickerWindow {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: { description: string; accept: Record<string, readonly string[]> }[];
  }) => Promise<{ getFile(): Promise<File> }[]>;
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_EXTENSION},.json`;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** Asks for one project file with the native open dialog, or a file input. Resolves to null when the user cancels. Call it from a user gesture. */
export async function pickProjectFile(typeLabel: string): Promise<File | null> {
  const picker = (window as OpenPickerWindow).showOpenFilePicker;
  if (!picker) return pickWithInput();
  try {
    const [handle] = await picker.call(window, {
      multiple: false,
      types: [{ description: typeLabel, accept: { [PROJECT_MIME]: [PROJECT_EXTENSION, '.json'] } }],
    });
    return (await handle?.getFile()) ?? null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export type OpenProjectResult =
  | { readonly ok: true; readonly documents: number; readonly skipped: number }
  | { readonly ok: false; readonly reason: ProjectRefusal | 'unreadable'; readonly version?: number };

/**
 * Reads project text and adds its documents to the workspace. A project from a newer version, a file that is
 * not a project and an unreadable file are refused with a reason and change nothing.
 */
export function openProjectText(text: string): OpenProjectResult {
  const parsed: ProjectParse = parseProjectText(text);
  if (!parsed.ok)
    return parsed.version === undefined
      ? { ok: false, reason: parsed.reason }
      : { ok: false, reason: parsed.reason, version: parsed.version };
  applyProject(parsed.data);
  return { ok: true, documents: parsed.data.documents.length, skipped: parsed.skipped };
}

/** Reads a project file the user chose and opens it. */
export async function openProjectFile(file: File): Promise<OpenProjectResult> {
  try {
    return openProjectText(await file.text());
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/** Sets the project name the file and the report carry. */
export function setProjectName(name: string): void {
  projectName.value = name;
}
