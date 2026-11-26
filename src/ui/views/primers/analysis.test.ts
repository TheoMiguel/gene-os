import { analyzePair, analyzePrimer } from '../../../engine/primers';
import {
  checkPair,
  checkPrimer,
  cleanPrimer,
  dimerDrawing,
  hairpinDrawing,
  invalidCharacters,
  verdictOf,
} from './analysis';

const check = (seq: string) => checkPrimer(seq, analyzePrimer(seq));
const ids = (seq: string) => check(seq).map((f) => f.id);

describe('cleanPrimer and invalidCharacters', () => {
  it('upper-cases and removes spaces and line breaks', () => {
    expect(cleanPrimer(' gta aaa\ncga ')).toBe('GTAAAACGA');
  });

  it('accepts IUPAC letters and names the others', () => {
    expect(invalidCharacters('ACGTRYN')).toEqual([]);
    expect(invalidCharacters('ACG1XJ*')).toEqual(['1', 'X', 'J', '*']);
  });
});

describe('checkPrimer', () => {
  it('accepts a primer designed with the engine defaults (Tm 60, GC 55 %)', () => {
    const seq = 'CAGCTCACTCAAAGGCGGTA';
    expect(check(seq)).toEqual([]);
    expect(verdictOf(check(seq))).toBe('good');
  });

  it('flags a palindromic primer as a hairpin and a self-dimer and asks for a redesign', () => {
    const seq = 'GCGGATCCGCAAAAGCGGATCCGC';
    const findings = check(seq);
    expect(findings.map((f) => f.id)).toEqual(expect.arrayContaining(['hairpin', 'selfDimer']));
    expect(verdictOf(findings)).toBe('redesign');
    const hairpin = findings.find((f) => f.id === 'hairpin');
    expect(hairpin?.drawing?.[1]).toContain('((((((((((....))))))))))');
    const dimer = findings.find((f) => f.id === 'selfDimer');
    expect(dimer?.drawing).toHaveLength(3);
    expect(dimer?.drawing?.[0]).toBe(`5' ${seq} 3'`);
  });

  it('reports length, GC and run problems of a poor primer', () => {
    expect(ids('ATATATATTTTAAAAT')).toEqual(expect.arrayContaining(['short', 'gcLow', 'run', 'tmLow']));
    expect(ids('GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toEqual(
      expect.arrayContaining(['long', 'gcHigh', 'run', 'stickyEnd']),
    );
  });

  it('flags a dinucleotide repeat', () => {
    expect(ids('GACGTCATATATATCGGACT')).toContain('repeat');
  });

  it('warns that a degenerate primer is approximate', () => {
    expect(ids('GTAAAACGACGGCCRGT')).toContain('degenerate');
  });

  it('puts the failures before the cautions', () => {
    const severities = check('GCGGATCCGCAAAAGCGGATCCGC').map((f) => f.severity);
    expect(severities.indexOf('bad')).toBe(0);
  });
});

describe('checkPair', () => {
  const forward = 'GTAAAACGACGGCCAGT';
  const reverse = 'CAGGAAACAGCTATGAC';

  it('passes the M13 pair, which is a well-known good pair', () => {
    expect(checkPair(forward, reverse, analyzePair(forward, reverse)).map((f) => f.id)).not.toContain(
      'crossDimer',
    );
  });

  it('flags a primer that pairs with itself and its partner as a cross-dimer', () => {
    const palindrome = 'GCGGATCCGCAAAAGCGGATCCGC';
    expect(checkPair(palindrome, palindrome, analyzePair(palindrome, palindrome)).map((f) => f.id)).toContain(
      'crossDimer',
    );
  });

  it('warns past 3 °C difference and fails past 5 °C', () => {
    const dimer = analyzePair(forward, reverse).crossDimer;
    expect(checkPair(forward, reverse, { crossDimer: dimer, deltaTm: 2.9 })).toEqual([]);
    expect(checkPair(forward, reverse, { crossDimer: dimer, deltaTm: 4 })[0]).toMatchObject({
      id: 'deltaTm',
      severity: 'warn',
    });
    expect(checkPair(forward, reverse, { crossDimer: dimer, deltaTm: 6 })[0]).toMatchObject({
      id: 'deltaTm',
      severity: 'bad',
    });
  });
});

describe('drawings', () => {
  it('draws a dimer as three lines and a hairpin as two', () => {
    const analysis = analyzePrimer('GCGGATCCGCAAAAGCGGATCCGC');
    expect(dimerDrawing(analysis.selfDimer)).toHaveLength(3);
    expect(hairpinDrawing('GCGGATCCGCAAAAGCGGATCCGC', analysis.hairpin)).toHaveLength(2);
  });
});

describe('verdictOf', () => {
  it('is good with no finding, caution with a warning, redesign with a failure', () => {
    expect(verdictOf([])).toBe('good');
    expect(verdictOf([{ id: 'gcLow', severity: 'warn', params: {} }])).toBe('caution');
    expect(
      verdictOf([
        { id: 'gcLow', severity: 'warn', params: {} },
        { id: 'hairpin', severity: 'bad', params: {} },
      ]),
    ).toBe('redesign');
  });
});
