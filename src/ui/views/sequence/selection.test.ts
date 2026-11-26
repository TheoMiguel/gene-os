import primersJson from '../../../../tests/oracle/primers.json';
import { translate } from '../../../engine/translate';
import type { SeqRecord } from '../../../engine/types';
import {
  MIN_TM_LENGTH,
  oppositeStrandText,
  selectedStrandText,
  selectionRecord,
  selectionStats,
  selectionTranslation,
} from './selection';

const golden = primersJson as unknown as { tm: { seq: string; primer3: number }[] };
const record = (seq: string): SeqRecord => ({
  id: 'r1',
  name: 'plasmid',
  description: '',
  alphabet: 'dna',
  topology: 'circular',
  seq,
  features: [],
  metadata: {},
});
const top = (start: number, end: number) => ({ start, end, strand: 1 as const });
const bottom = (start: number, end: number) => ({ start, end, strand: -1 as const });

describe('selection readout', () => {
  it('reports length and GC content of the selected bases', () => {
    const stats = selectionStats('AATTGGCCAA', top(2, 8), 'dna');
    expect(stats.length).toBe(6);
    expect(stats.gc).toBeCloseTo(66.667, 2);
  });

  it('gives the melting temperature primer3 calc_tm gives for the selected oligo', () => {
    for (const { seq, primer3 } of golden.tm.slice(0, 8)) {
      const stats = selectionStats(`GG${seq}CC`, top(2, 2 + seq.length), 'dna');
      expect(stats.tm).toBeCloseTo(primer3, 2);
    }
  });

  it('shows no melting temperature for a stretch too short to be a duplex, and nothing nucleotide-specific for a protein', () => {
    expect(selectionStats('ACGTACGT', top(0, MIN_TM_LENGTH - 1), 'dna').tm).toBeNull();
    expect(selectionStats('MKTAYIAK', top(0, 5), 'protein')).toEqual({ length: 5, gc: null, tm: null });
  });

  it('reads U as T for the melting temperature of an RNA selection', () => {
    expect(selectionStats('GGCUAUCGAUCGAG', top(0, 14), 'rna').tm).toBeCloseTo(
      selectionStats('GGCTATCGATCGAG', top(0, 14), 'dna').tm as number,
      9,
    );
  });
});

describe('selection actions', () => {
  const seq = 'ATGAAATTTGGGCCCTAA';

  it("copies the selected strand 5' to 3' and offers the other strand as the reverse complement", () => {
    expect(selectedStrandText(seq, top(3, 9), 'dna')).toBe('AAATTT');
    expect(oppositeStrandText(seq, top(3, 9), 'dna')).toBe('AAATTT');
    expect(selectedStrandText(seq, top(0, 6), 'dna')).toBe('ATGAAA');
    expect(oppositeStrandText(seq, top(0, 6), 'dna')).toBe('TTTCAT');
    expect(selectedStrandText(seq, bottom(0, 6), 'dna')).toBe('TTTCAT');
    expect(oppositeStrandText(seq, bottom(0, 6), 'dna')).toBe('ATGAAA');
  });

  it('translates the selection from its first base on the strand it was selected on', () => {
    expect(selectionTranslation(seq, top(0, 18), 'dna')).toBe('MKFGP*');
    expect(selectionTranslation(seq, top(0, 18), 'dna')).toBe(translate(seq));
    expect(selectionTranslation(seq, bottom(0, 18), 'dna')).toBe(translate('TTAGGGCCCAAATTTCAT'));
    expect(selectionTranslation('MKT', top(0, 3), 'protein')).toBe('');
  });

  it('turns a selection into a record named after its source and 1-based range, ready for FASTA', () => {
    const out = selectionRecord(record(seq), top(3, 9));
    expect(out).toMatchObject({ name: 'plasmid_4-9', seq: 'AAATTT', topology: 'linear', features: [] });
    const reverse = selectionRecord(record(seq), bottom(0, 6));
    expect(reverse.name).toBe('plasmid_1-6_rev');
    expect(reverse.seq).toBe('TTTCAT');
  });
});
