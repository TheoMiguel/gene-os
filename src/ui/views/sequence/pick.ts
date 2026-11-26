import type { Span, Strand } from '../../../engine/types';
import type { ViewState } from '../../../state/view';
import type { MapItem } from './mapItems';
import type { Pick, SequencePrefs } from './state';

/**
 * The one way any pane selects something: selects the range on the shared view state, scrolls the text to it, and
 * remembers what was clicked so the other panes can tell it from a selection made by dragging. A restriction site
 * also picks its enzyme.
 */
export function pickRange(
  view: ViewState,
  prefs: SequencePrefs,
  target: {
    readonly id: string;
    readonly span: Span;
    readonly strand: Strand;
    readonly reveal: number;
    readonly enzyme?: string;
  },
): void {
  view.select(target.span.start, target.span.end, target.strand);
  view.reveal(target.reveal);
  prefs.pick.value = { id: target.id, start: target.span.start, end: target.span.end };
  if (target.enzyme) prefs.picked.value = new Set([target.enzyme]);
}

/** Selects a map element everywhere. */
export function pickItem(view: ViewState, prefs: SequencePrefs, item: MapItem): void {
  pickRange(view, prefs, {
    id: item.id,
    span: item.select,
    strand: item.kind === 'site' ? 1 : item.strand,
    reveal: item.reveal,
    ...(item.enzyme ? { enzyme: item.enzyme } : {}),
  });
}

/** The id of the clicked element while the shared selection still is that element's range, else null. */
export function activePick(
  pick: Pick | null,
  selection: { readonly start: number; readonly end: number } | null,
): string | null {
  return pick && selection && selection.start === pick.start && selection.end === pick.end ? pick.id : null;
}
