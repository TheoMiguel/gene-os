import { reverseComplement } from '../../../engine/alphabet';
import { gcContent } from '../../../engine/composition';
import { tmNearestNeighbor } from '../../../engine/primers';
import { translate } from '../../../engine/translate';
import type { Alphabet, SeqRecord, Strand } from '../../../engine/types';
import type { SelectionRange } from '../../../state/view';

/** The shortest selection that gets a melting temperature: shorter oligos are not a duplex in any real assay. */
export const MIN_TM_LENGTH = 8;

export interface SelectionStats {
  readonly length: number;
  /** Percent G+C, or null for a protein. */
  readonly gc: number | null;
  /** Melting temperature in °C (primer3 nearest-neighbor with its defaults), or null when it does not apply. */
  readonly tm: number | null;
}

/** The selected stretch of the top strand. */
export function selectedText(seq: string, selection: SelectionRange): string {
  return seq.slice(selection.start, selection.end);
}

/** The selected bases as read 5'→3' on the strand the user selected on. */
export function selectedStrandText(seq: string, selection: SelectionRange, alphabet: Alphabet): string {
  const text = selectedText(seq, selection);
  return selection.strand === -1 && alphabet !== 'protein'
    ? reverseComplement(text, alphabet === 'rna' ? 'rna' : 'dna')
    : text;
}

/** The other strand of the selection, 5'→3'. */
export function oppositeStrandText(seq: string, selection: SelectionRange, alphabet: Alphabet): string {
  const text = selectedText(seq, selection);
  return selection.strand === -1 ? text : reverseComplement(text, alphabet === 'rna' ? 'rna' : 'dna');
}

/** Length, GC content and melting temperature of the selection. */
export function selectionStats(seq: string, selection: SelectionRange, alphabet: Alphabet): SelectionStats {
  const length = selection.end - selection.start;
  if (alphabet === 'protein') return { length, gc: null, tm: null };
  const text = selectedText(seq, selection);
  return {
    length,
    gc: gcContent(text) * 100,
    tm: length >= MIN_TM_LENGTH ? tmNearestNeighbor(text.replaceAll('U', 'T')) : null,
  };
}

/**
 * Translation of the selection from its first base, on the strand it was selected on, with stops as `*`. `table` is an
 * NCBI genetic code id; the standard code by default.
 */
export function selectionTranslation(
  seq: string,
  selection: SelectionRange,
  alphabet: Alphabet,
  table = 1,
): string {
  return alphabet === 'protein' ? '' : translate(selectedStrandText(seq, selection, alphabet), { table });
}

/** A FASTA-ready record holding the selection, named after its source and its 1-based range. */
export function selectionRecord(record: SeqRecord, selection: SelectionRange): SeqRecord {
  const strand: Strand = selection.strand;
  const text = selectedStrandText(record.seq, selection, record.alphabet);
  const range = `${selection.start + 1}-${selection.end}`;
  return {
    id: record.id,
    name: `${record.name}_${range}${strand === -1 ? '_rev' : ''}`,
    description: `${record.name} ${range}${strand === -1 ? ' (reverse strand)' : ''}`,
    alphabet: record.alphabet,
    topology: 'linear',
    seq: text,
    features: [],
    metadata: {},
  };
}
