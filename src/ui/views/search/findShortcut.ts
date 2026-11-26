import { signal } from '@preact/signals';
import { workspace } from '../../../state/documents';
import { shortcuts } from '../../shortcuts';

/** True from Ctrl+F until the search box has taken focus. */
export const focusSearchBox = signal(false);

/** Opens the Search & Motifs view of the active document and asks it to focus the search box. */
export function openSearch(): void {
  const id = workspace.activeId.peek();
  if (id === null) return;
  workspace.setActiveTab(id, 'search');
  focusSearchBox.value = true;
}

shortcuts.on('find', openSearch);
