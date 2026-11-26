import { PUC19 } from '../../tests/fixtures/restriction/fixtures';
import { countLetters, gcContent, gcSkew, nucleotideWeight, proteinWeight } from './composition';
import { instabilityIndex, isoelectricPoint } from './protein';
import { proteinProperties, summarizeSequence } from './summary';

const PROTEIN = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVV';

describe('summarizeSequence', () => {
  it('gives a DNA record the counts, GC, skew and both weights the engine functions give', () => {
    const s = summarizeSequence(PUC19, 'dna', 'circular');
    expect(s.length).toBe(PUC19.length);
    expect(s.counts).toEqual(countLetters(PUC19));
    expect(s.gc).toBe(gcContent(PUC19));
    expect(s.gcSkew).toBe(gcSkew(PUC19));
    expect(s.weight).toBe(nucleotideWeight(PUC19, { alphabet: 'dna', circular: true }));
    expect(s.weightDoubleStranded).toBe(
      nucleotideWeight(PUC19, { alphabet: 'dna', circular: true, doubleStranded: true }),
    );
    expect(s.weightDoubleStranded as number).toBeGreaterThan(s.weight);
    expect(s.protein).toBeUndefined();
  });

  it('weighs an RNA record with the RNA table and a linear one without the circular correction', () => {
    const rna = summarizeSequence('ACGUACGUAC', 'rna', 'linear');
    expect(rna.weight).toBe(nucleotideWeight('ACGUACGUAC', { alphabet: 'rna' }));
    const circular = summarizeSequence('ACGTACGTAC', 'dna', 'circular');
    const linear = summarizeSequence('ACGTACGTAC', 'dna', 'linear');
    expect(circular.weight).toBeLessThan(linear.weight);
  });

  it('gives a protein record its properties and no nucleotide fields', () => {
    const s = summarizeSequence(PROTEIN, 'protein', 'linear');
    expect(s.weight).toBe(proteinWeight(PROTEIN));
    expect(s.protein?.isoelectricPoint).toBe(isoelectricPoint(PROTEIN));
    expect(s.protein?.instabilityIndex).toBe(instabilityIndex(PROTEIN));
    expect(s.gc).toBeUndefined();
    expect(s.weightDoubleStranded).toBeUndefined();
  });

  it('handles a sequence of one letter and an empty one without throwing', () => {
    expect(summarizeSequence('A', 'dna', 'linear').counts).toEqual({ A: 1 });
    expect(summarizeSequence('', 'dna', 'linear').weight).toBe(0);
  });
});

describe('proteinProperties', () => {
  it('gives a lysine-rich peptide a positive charge and an aspartate-rich one a negative charge at pH 7.4', () => {
    expect(proteinProperties('KKKKKKKKKK').charge).toBeGreaterThan(0);
    expect(proteinProperties('DDDDDDDDDD').charge).toBeLessThan(0);
  });

  it('reports aromaticity as the fraction of F, W and Y', () => {
    expect(proteinProperties('FWYAAAAAAA').aromaticity).toBeCloseTo(0.3, 12);
  });
});

describe('summarizeSequence on 5 Mb', { timeout: 60_000 }, () => {
  it('summarizes a 5 Mb genome in well under the time budget', () => {
    const chunk = 'ACGTTGCAAGCTTGACCGATAGGCTAAGCTTAGGCCTAAGGCTA';
    const seq = chunk.repeat(Math.ceil(5_000_000 / chunk.length)).slice(0, 5_000_000);
    const start = performance.now();
    const s = summarizeSequence(seq, 'dna', 'circular');
    expect(performance.now() - start).toBeLessThan(10_000);
    expect(s.length).toBe(5_000_000);
    expect(Object.values(s.counts).reduce((a, b) => a + b, 0)).toBe(5_000_000);
  });
});
