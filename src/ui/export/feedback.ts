import { notice } from '../actions';
import type { CopyResult } from './clipboard';
import type { SaveResult } from './download';

/** Tells the user, through the status line, whether a copy worked. */
export function reportCopy(result: CopyResult): void {
  notice.value = result.ok
    ? { key: 'export.copied', tone: 'info' }
    : { key: 'export.copyFailed', tone: 'error' };
}

/** Tells the user when a save failed. A closed dialog and a finished save need no message. */
export function reportSave(result: SaveResult): void {
  if (!result.ok && result.reason === 'failed') notice.value = { key: 'export.saveFailed', tone: 'error' };
}
