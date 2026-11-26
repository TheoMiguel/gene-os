import { loadCoreGoldens, randomDna } from '../../tests/oracle/core-goldens';
import {
  CODON_ORDER,
  codonResidue,
  GENETIC_CODES,
  getGeneticCode,
  isStartCodon,
  sixFrameTranslation,
  translate,
  translateFrame,
} from './translate';

const goldens = loadCoreGoldens();

describe('genetic code tables (Bio.Data.CodonTable)', () => {
  it('has every NCBI table that Biopython knows, with identical codon assignments and start codons', () => {
    const ids = GENETIC_CODES.map((c) => String(c.id));
    expect(ids).toEqual(Object.keys(goldens.geneticCodes));
    for (const code of GENETIC_CODES) {
      const reference = goldens.geneticCodes[String(code.id)];
      expect(code.aa).toBe(reference?.aa);
      expect([...code.starts].sort()).toEqual([...(reference?.starts ?? [])].sort());
    }
  });

  it('lists the codons in TCAG order', () => {
    expect(CODON_ORDER).toHaveLength(64);
    expect(CODON_ORDER[0]).toBe('TTT');
    expect(CODON_ORDER[63]).toBe('GGG');
  });

  it('answers codon queries', () => {
    const bacterial = getGeneticCode(11);
    expect(codonResidue(bacterial, 'TGG')).toBe('W');
    expect(codonResidue(bacterial, 'UAA')).toBe('*');
    expect(codonResidue(bacterial, 'TGN')).toBeUndefined();
    expect(isStartCodon(bacterial, 'GTG')).toBe(true);
    expect(isStartCodon(getGeneticCode(1), 'ATT')).toBe(false);
    expect(() => getGeneticCode(7)).toThrow(RangeError);
  });
});

describe('translate (Bio.Seq.translate)', () => {
  it('matches Biopython for every table on random sequences and for IUPAC codons on tables 1 and 11', () => {
    for (const c of goldens.translate.cases) {
      expect(translate(c.seq, { table: c.table })).toBe(c.protein);
    }
  });

  it('matches Biopython with to_stop', () => {
    for (const c of goldens.translate.toStop) {
      expect(translate(c.seq, { toStop: true })).toBe(c.protein);
    }
  });

  it('drops a partial last codon and reads RNA', () => {
    expect(translate('ATGGCCAT')).toBe('MA');
    expect(translate('AUGGCC')).toBe('MA');
    expect(translate('AT')).toBe('');
  });

  it('gives X for characters that are not nucleotides', () => {
    expect(translate('AT-GGG')).toBe('XG');
  });
});

describe('six-frame translation (Biopython translate on each frame)', () => {
  it('matches Biopython in all six frames under the bacterial table', () => {
    for (const c of goldens.translate.sixFrame) {
      const result = sixFrameTranslation(c.seq, { table: c.table });
      expect(result.map((r) => r.frame)).toEqual([1, 2, 3, -1, -2, -3]);
      for (const { frame, protein } of result) expect(protein).toBe(c.frames[String(frame)]);
      expect(translateFrame(c.seq, -2, { table: 11 })).toBe(c.frames['-2']);
    }
  });
});

describe('performance', () => {
  it('translates six frames of 5 Mb in a few seconds', () => {
    const seq = randomDna(5_000_000, 11);
    const started = performance.now();
    const frames = sixFrameTranslation(seq);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(frames[0]?.protein).toHaveLength(Math.floor(5_000_000 / 3));
  });
});
