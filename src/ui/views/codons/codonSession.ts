import { type Signal, signal } from '@preact/signals';
import type { Frame } from '../../../engine/translate';
import { perDocument } from '../proteins/perDocument';

export type CodonScope = 'orf' | 'all' | 'frame';
export type CodonMetric = 'count' | 'perThousand' | 'rscu';

interface CodonSession {
  readonly scope: Signal<CodonScope>;
  /** Reading frame for the whole-sequence scope. */
  readonly frame: Signal<Frame>;
  readonly metric: Signal<CodonMetric>;
  /** Id of the reference table to compare with, or null for none. */
  readonly reference: Signal<string | null>;
}

/** What the user chose in the Codons view of a document. */
export const codonSessionOf = perDocument<CodonSession>(() => ({
  scope: signal<CodonScope>('orf'),
  frame: signal<Frame>(1),
  metric: signal<CodonMetric>('perThousand'),
  reference: signal<string | null>(null),
}));
