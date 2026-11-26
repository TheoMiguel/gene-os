import { signal } from '@preact/signals';
import type { CutCountClass } from '../../../engine/restriction';
import type { EndType } from '../../../engine/types';
import { perDocument } from '../../../state/perDocument';
import { createGelSettingsStore } from '../gel/GelPanel';

/** What the Digest view remembers per document while the user visits other tabs. */
export const digestStateOf = perDocument(() => ({
  chosen: signal<readonly string[]>([]),
  endType: signal<EndType | 'all'>('all'),
  cuts: signal<CutCountClass | 'all'>('all'),
  supplier: signal('all'),
  /** Index (0-based) in the double-digest fragment list of the selected fragment. */
  selected: signal<number | null>(null),
  singleLanes: signal(true),
}));

export const digestGelOf = createGelSettingsStore();
