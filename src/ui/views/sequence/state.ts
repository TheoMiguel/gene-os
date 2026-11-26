import { effect, type Signal, signal } from '@preact/signals';
import type { Frame } from '../../../engine/translate';
import { workspace } from '../../../state/documents';
import type { SiteDisplay } from './mapModel';
import { DEFAULT_FILTER, type RestrictionFilter } from './restrictionRows';

export type MapKind = 'auto' | 'circular' | 'linear';
export type ReadMode = 'text' | 'blocks' | 'sixFrame' | 'singleFrame';
/** Which panes show. `all` is the combined layout; the others give one pane the whole area. */
export type PaneFocus = 'all' | 'map' | 'sequence' | 'sites';
/** Characters per line: a fixed number, or as many as fit. */
export type LineFit = 'auto' | number;

/** What the user last clicked on the map or in the list, so the other panes can tell it from any other selection. */
export interface Pick {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

/** The sequence view's own settings for one document. They survive switching tabs, like the shared view state. */
export interface SequencePrefs {
  readonly mapKind: Signal<MapKind>;
  readonly siteDisplay: Signal<SiteDisplay>;
  readonly readMode: Signal<ReadMode>;
  readonly frame: Signal<Frame>;
  /** NCBI genetic code table id for the translation rows and the copied translation. */
  readonly geneticCode: Signal<number>;
  readonly lineFit: Signal<LineFit>;
  readonly focus: Signal<PaneFocus>;
  /** Where the splitters sit in the combined layout: the map's share of the width, and the text's share of the height. */
  readonly split: Signal<{ readonly col: number; readonly row: number }>;
  /** Enzymes the user picked in the list. The map and the text always show their sites. */
  readonly picked: Signal<ReadonlySet<string>>;
  readonly pick: Signal<Pick | null>;
  readonly filter: Signal<RestrictionFilter>;
  /** Whether the list's filters are open. Unset until the user decides, so a tall view opens them and a short one does not. */
  readonly filtersOpen: Signal<boolean | null>;
}

const prefsByDocument = new Map<string, SequencePrefs>();

/** The sequence view settings of a document. The same object on every call. */
export function prefsOf(docId: string): SequencePrefs {
  let prefs = prefsByDocument.get(docId);
  if (!prefs) {
    prefs = {
      mapKind: signal<MapKind>('auto'),
      siteDisplay: signal<SiteDisplay>('unique'),
      readMode: signal<ReadMode>('text'),
      frame: signal<Frame>(1),
      geneticCode: signal(1),
      lineFit: signal<LineFit>('auto'),
      focus: signal<PaneFocus>('all'),
      split: signal({ col: 0.44, row: 0.46 }),
      picked: signal<ReadonlySet<string>>(new Set()),
      pick: signal<Pick | null>(null),
      filter: signal<RestrictionFilter>(DEFAULT_FILTER),
      filtersOpen: signal<boolean | null>(null),
    };
    prefsByDocument.set(docId, prefs);
  }
  return prefs;
}

let knownIds = new Set<string>();
effect(() => {
  const open = new Set(workspace.documents.value.map((doc) => doc.id));
  for (const id of knownIds) if (!open.has(id)) prefsByDocument.delete(id);
  knownIds = open;
});
