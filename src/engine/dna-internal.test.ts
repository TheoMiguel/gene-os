import { isPalindromic, iupacMatch, reverseComplement } from './dna-internal';

const code = (char: string) => char.charCodeAt(0);

describe('reverseComplement', () => {
  it('complements bases and IUPAC codes and reverses the order', () => {
    expect(reverseComplement('GAATTCrykmBDHVN')).toBe('NBDHVKMRYGAATTC');
    expect(reverseComplement('ACGU')).toBe('ACGT');
    expect(reverseComplement('')).toBe('');
  });
});

describe('iupacMatch', () => {
  it('accepts a template base that the pattern code stands for', () => {
    expect(iupacMatch(code('R'), code('A'))).toBe(true);
    expect(iupacMatch(code('R'), code('c'))).toBe(false);
    expect(iupacMatch(code('A'), code('N'))).toBe(false);
    expect(iupacMatch(code('N'), code('N'))).toBe(true);
  });
});

describe('isPalindromic', () => {
  it('detects sites equal to their reverse complement', () => {
    expect(isPalindromic('GAATTC')).toBe(true);
    expect(isPalindromic('CASTG')).toBe(true);
    expect(isPalindromic('GGTCTC')).toBe(false);
  });
});
