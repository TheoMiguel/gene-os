import { loadCoreGoldens, randomDna } from '../../tests/oracle/core-goldens';
import {
  baseMask,
  cleanSequence,
  complement,
  detectAlphabet,
  encodeBases,
  iupacMatches,
  reverseComplement,
} from './alphabet';

const goldens = loadCoreGoldens();

describe('reverse complement and complement (Biopython Seq.reverse_complement / complement)', () => {
  it('matches Biopython on random IUPAC DNA', () => {
    for (const c of goldens.alphabet.dna) {
      expect(reverseComplement(c.seq)).toBe(c.rc);
      expect(complement(c.seq)).toBe(c.complement);
    }
  });

  it('matches Biopython on RNA', () => {
    for (const c of goldens.alphabet.rna) {
      expect(reverseComplement(c.seq, 'rna')).toBe(c.rc);
      expect(complement(c.seq, 'rna')).toBe(c.complement);
    }
  });

  it('keeps lower case and passes gaps through', () => {
    expect(reverseComplement('acgt-N')).toBe('N-acgt');
  });

  it('reverse-complements twice back to the original', () => {
    const seq = randomDna(5000, 3, 'ACGTRYKMSWBDHVN');
    expect(reverseComplement(reverseComplement(seq))).toBe(seq);
  });
});

describe('cleanSequence', () => {
  it('drops whitespace, digits and line numbers from a GenBank ORIGIN block', () => {
    const raw = '        1 gaattcgcgg ccgcttctag\n       21 agtcgacctg cagg\n';
    expect(cleanSequence(raw)).toBe('GAATTCGCGGCCGCTTCTAGAGTCGACCTGCAGG');
  });

  it('keeps stop and gap characters', () => {
    expect(cleanSequence('MK*\r\n A-B 12')).toBe('MK*A-B');
  });

  it('returns an empty string for text without letters', () => {
    expect(cleanSequence(' 12 34\n')).toBe('');
  });
});

describe('detectAlphabet', () => {
  it('recognises DNA, RNA and protein', () => {
    expect(detectAlphabet('ATGGCCATTGTAATGGGCCGC')).toBe('dna');
    expect(detectAlphabet('AUGGCCAUUGUAAUGGGCCGC')).toBe('rna');
    expect(detectAlphabet('MKTAYIAKQRQISFVKSHFSRQ')).toBe('protein');
  });

  it('treats DNA with ambiguity codes and gaps as DNA', () => {
    expect(detectAlphabet('ACGTRYACGTNNACGT-ACGT')).toBe('dna');
    expect(detectAlphabet('ACGTRYACGTRYACGTACGT')).toBe('dna');
  });

  it('is not fooled by a protein made mostly of A, C, G and T residues', () => {
    expect(detectAlphabet('MAGCTAGKLWEDPQRSM')).toBe('protein');
  });

  it('ignores a trailing stop in a protein', () => {
    expect(detectAlphabet('MKVLAAGIV*')).toBe('protein');
  });

  it('defaults an empty sequence to DNA', () => {
    expect(detectAlphabet('')).toBe('dna');
  });
});

describe('IUPAC matching', () => {
  it('matches a sequence base inside the pattern code', () => {
    expect(iupacMatches('R', 'A')).toBe(true);
    expect(iupacMatches('R', 'g')).toBe(true);
    expect(iupacMatches('R', 'C')).toBe(false);
    expect(iupacMatches('N', 'T')).toBe(true);
    expect(iupacMatches('A', 'N')).toBe(false);
    expect(iupacMatches('N', 'N')).toBe(false);
    expect(iupacMatches('T', 'U')).toBe(true);
  });

  it('gives each IUPAC code its bases', () => {
    expect(baseMask('A')).toBe(1);
    expect(baseMask('N')).toBe(15);
    expect(baseMask('B')).toBe(2 | 4 | 8);
    expect(baseMask('-')).toBe(0);
  });

  it('encodes bases A, C, G, T/U as 0..3 and everything else as 4', () => {
    expect([...encodeBases('ACGTUNx')]).toEqual([0, 1, 2, 3, 3, 4, 4]);
  });
});

describe('performance', { timeout: 60_000 }, () => {
  it('reverse-complements and cleans 5 Mb quickly', () => {
    const seq = randomDna(5_000_000, 7);
    const started = performance.now();
    const rc = reverseComplement(seq);
    const cleaned = cleanSequence(`${seq.slice(0, 2_000_000).replace(/(.{60})/g, '$1\n')}`);
    const elapsed = performance.now() - started;
    expect(rc).toHaveLength(seq.length);
    expect(cleaned).toHaveLength(2_000_000);
    expect(elapsed).toBeLessThan(3000);
  });
});
