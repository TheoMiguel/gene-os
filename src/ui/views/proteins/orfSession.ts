import { type Signal, signal } from '@preact/signals';
import type { Orf, OrfOptions, StartCodonSet } from '../../../engine/orf';
import { ALL_FRAMES, type Frame } from '../../../engine/translate';
import { perDocument } from '../../../state/perDocument';
import { type SelectionRange, viewOf } from '../../../state/view';
import { type OrfSpan, orfKey, orfSpan } from './orfRows';

/** What the user sets for the ORF search. */
export interface OrfSettings {
  readonly minCodons: number;
  readonly startCodons: Extract<StartCodonSet, string>;
  /** NCBI genetic code table id. */
  readonly table: number;
  readonly frames: readonly Frame[];
  /** False reports an ORF for every start codon, not only the most upstream one of each stop. */
  readonly longestOnly: boolean;
  readonly openEnded: boolean;
  /** Kyte-Doolittle window in residues. Not part of the scan: it only shapes the hydropathy chart. */
  readonly hydropathyWindow: number;
}

/** The defaults of spec 4.7: 100 codons, ATG, all six frames, the standard code. */
export const DEFAULT_ORF_SETTINGS: OrfSettings = {
  minCodons: 100,
  startCodons: 'atg',
  table: 1,
  frames: ALL_FRAMES,
  longestOnly: true,
  openEnded: false,
  hydropathyWindow: 9,
};

/** The scan parameters for `settings`. Leaves out what is default, so equal searches share one cached scan. */
export function scanParams(settings: OrfSettings): OrfOptions {
  const { minCodons, startCodons, table, frames, longestOnly, openEnded } = settings;
  return {
    minCodons,
    startCodons,
    table,
    ...(frames.length === ALL_FRAMES.length ? {} : { frames }),
    ...(longestOnly ? {} : { longestOnly }),
    ...(openEnded ? { openEnded } : {}),
  };
}

interface OrfSession {
  readonly settings: Signal<OrfSettings>;
  /** Key of the ORF the user picked last (`orfKey`). */
  readonly picked: Signal<string | null>;
}

/** The ORF search settings and the picked ORF of a document. The Proteins and Codons views share them. */
export const orfSessionOf = perDocument<OrfSession>(() => ({
  settings: signal(DEFAULT_ORF_SETTINGS),
  picked: signal(null),
}));

const sameSpan = (a: OrfSpan, b: SelectionRange) =>
  a.start === b.start && a.end === b.end && a.strand === b.strand;

/**
 * The ORF the user means: the one the shared selection covers exactly, else the one picked last, else none.
 * The sequence view and the plasmid map move the shared selection, so the ORF follows them.
 */
export function resolveSelectedOrf(
  orfs: readonly Orf[],
  picked: string | null,
  selection: SelectionRange | null,
): Orf | null {
  if (selection) {
    const match = orfs.find((orf) => sameSpan(orfSpan(orf), selection));
    if (match) return match;
  }
  return picked === null ? null : (orfs.find((orf) => orfKey(orf) === picked) ?? null);
}

/** Picks an ORF: remembers it, selects its bases for every view, scrolls the sequence there and shows its frame. */
export function selectOrf(docId: string, orf: Orf): void {
  orfSessionOf(docId).picked.value = orfKey(orf);
  const view = viewOf(docId);
  const span = orfSpan(orf);
  view.select(span.start, span.end, span.strand);
  view.reveal(span.start);
  if (!view.frames.peek().includes(orf.frame)) view.frames.value = [...view.frames.peek(), orf.frame];
}
