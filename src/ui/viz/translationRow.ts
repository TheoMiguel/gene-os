import { reverseComplement } from '../../engine/alphabet';
import { codonResidue, type Frame, type GeneticCode, isStartCodon } from '../../engine/translate';
import type { Alphabet } from '../../engine/types';
import { columnOfOffset } from './layout';

export interface TranslationMark {
  /** Text column of the residue. */
  readonly column: number;
  readonly kind: 'start' | 'stop';
}

export interface TranslationRow {
  /** One line the width of the sequence row, with each residue under the middle base of its codon. */
  readonly text: string;
  /** Start codons and stops, for highlighting. */
  readonly marks: readonly TranslationMark[];
}

/**
 * The translation of `frame` for the bases `[rowStart, rowEnd)` of `seq`, ready to print under the sequence row.
 * A codon belongs to the row that holds its middle base. Frames +1..+3 start at base 0, 1 and 2 of the top strand;
 * frames -1..-3 read the reverse complement from its own start, so every row of a frame agrees with a whole-sequence
 * translation. Only the row's own codons are translated, so the cost does not depend on the sequence length.
 */
export function translationRow(
  seq: string,
  rowStart: number,
  rowEnd: number,
  frame: Frame,
  code: GeneticCode,
  blockSize: number,
  alphabet: Alphabet = 'dna',
): TranslationRow {
  const columns = columnOfOffset(Math.max(0, rowEnd - rowStart - 1), blockSize) + 1;
  const chars = new Array<string>(columns).fill(' ');
  const marks: TranslationMark[] = [];
  const n = seq.length;
  const phase = Math.abs(frame) - 1;

  for (let start = Math.max(0, rowStart - 1); start <= rowEnd - 2 && start + 3 <= n; start++) {
    const aligned = frame > 0 ? start % 3 === phase : (n - start - 3) % 3 === phase;
    if (!aligned) continue;
    const top = seq.slice(start, start + 3);
    const codon = frame > 0 ? top : reverseComplement(top, alphabet === 'rna' ? 'rna' : 'dna');
    const column = columnOfOffset(start + 1 - rowStart, blockSize);
    const residue = codonResidue(code, codon) ?? 'X';
    chars[column] = residue;
    if (residue === '*') marks.push({ column, kind: 'stop' });
    else if (isStartCodon(code, codon)) marks.push({ column, kind: 'start' });
  }
  return { text: chars.join(''), marks };
}
