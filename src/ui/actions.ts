import { signal } from '@preact/signals';
import { workspace } from '../state/documents';
import { type LoadErrorCode, openSequence, type SequenceInput } from '../state/openSequence';
import { settings } from '../state/settings';
import { playSound, type SoundId } from './audio/sounds';
import { pickSequenceFiles } from './filePicker';
import { type MessageKey, t } from './i18n';

/** Plays an interface sound at the user's volume, unless sounds are off. */
export function sfx(id: SoundId): void {
  const { soundOn, volume } = settings.value;
  if (soundOn) playSound(id, volume);
}

/** The message the app's status line shows, as a key so it follows a language change. */
export interface Notice {
  readonly key: MessageKey;
  readonly tone: 'error' | 'info';
}

export const notice = signal<Notice | null>(null);

const ERROR_KEYS: Readonly<Record<LoadErrorCode, MessageKey>> = {
  empty: 'error.empty',
  invalidCharacters: 'error.invalidCharacters',
  accessionNeedsNetwork: 'error.accessionNeedsNetwork',
  readFailed: 'error.readFailed',
};

/** Opens each input as a document. Returns true when every input loaded. */
export async function loadInputs(inputs: readonly SequenceInput[]): Promise<boolean> {
  let failure: LoadErrorCode | null = null;
  for (const input of inputs) {
    const result = await openSequence(input);
    if (!result.ok) failure = result.error;
  }
  notice.value = failure ? { key: ERROR_KEYS[failure], tone: 'error' } : null;
  sfx(failure ? 'error' : 'loaded');
  return failure === null;
}

/** Shows the system file dialog and opens the chosen files. */
export async function openFilesFromPicker(): Promise<void> {
  const files = await pickSequenceFiles(t('newSeq.fileTypes'));
  if (files.length > 0) await loadInputs(files.map((file) => ({ kind: 'file', file })));
}

export function showNewSequence(): void {
  workspace.showNewSequence();
  sfx('tab');
}

/** Closes the active document; with none open it does nothing. */
export function closeActiveDocument(): void {
  const id = workspace.activeId.value;
  if (id === null) return;
  workspace.close(id);
  sfx('click');
}
