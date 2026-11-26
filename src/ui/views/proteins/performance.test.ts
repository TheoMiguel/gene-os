import { randomDna } from '../../../../tests/oracle/core-goldens';
import { reverseComplement } from '../../../engine/alphabet';
import { codonUsage } from '../../../engine/composition';
import { extractLocation } from '../../../engine/location';
import { findOrfs } from '../../../engine/orf';
import { sixFrameTranslation } from '../../../engine/translate';
import { orfRows } from './orfRows';

describe('work the views do on the main thread, on a 5 Mb sequence', { timeout: 60_000 }, () => {
  const seq = randomDna(5_000_000, 20261126);
  const orfs = findOrfs(seq, { minCodons: 100 });

  it('builds a row with the protein properties for every ORF', () => {
    const started = performance.now();
    const rows = orfRows(orfs, seq.length);
    expect(rows).toHaveLength(orfs.length);
    expect(orfs.length).toBeGreaterThan(1000);
    expect(performance.now() - started).toBeLessThan(15_000);
  });

  it('counts the codons of all ORFs together and of a reverse frame', () => {
    const started = performance.now();
    const coding = orfs.map((orf) => extractLocation(seq, orf.location)).join('');
    expect(codonUsage(coding).total).toBe(coding.length / 3);
    expect(codonUsage(reverseComplement(seq), { frame: 1 }).total).toBeGreaterThan(1_600_000);
    expect(performance.now() - started).toBeLessThan(15_000);
  });

  it('translates all six frames', () => {
    const started = performance.now();
    const frames = sixFrameTranslation(seq);
    expect(frames.every((frame) => frame.protein.length > 1_600_000)).toBe(true);
    expect(performance.now() - started).toBeLessThan(15_000);
  });
});
