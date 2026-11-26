/**
 * Small DNA helpers shared by the restriction, primer and PCR modules.
 * To be merged into alphabet.ts.
 */

const A = 1;
const C = 2;
const G = 4;
const T = 8;
/** Any template character that is not a definite base (N, IUPAC ambiguity codes, gaps). */
const OTHER = 16;

const IUPAC_BASES: Readonly<Record<string, number>> = {
  A,
  C,
  G,
  T,
  U: T,
  R: A | G,
  Y: C | T,
  S: C | G,
  W: A | T,
  K: G | T,
  M: A | C,
  B: C | G | T,
  D: A | G | T,
  H: A | C | T,
  V: A | C | G,
  N: A | C | G | T | OTHER,
};

const COMPLEMENT_PAIRS = 'ACGTURYSWKMBDHVN';
const COMPLEMENTS = 'TGCAAYRSWMKVHDBN';

function buildTable(fill: (upper: string, code: number) => number): Uint8Array {
  const table = new Uint8Array(256);
  for (let code = 0; code < 256; code++) table[code] = fill(String.fromCharCode(code).toUpperCase(), code);
  return table;
}

/** Char code -> the template bases a pattern letter (IUPAC) accepts. `N` also accepts unknown template letters. */
export const PATTERN_MASK = buildTable((char) => IUPAC_BASES[char] ?? 0);

/** Char code -> the single base a template letter is, or OTHER when it is not a definite base. */
export const BASE_MASK = buildTable((char) => {
  const mask = IUPAC_BASES[char];
  return mask === A || mask === C || mask === G || mask === T ? mask : OTHER;
});

const ASCII = new TextDecoder('latin1');

const COMPLEMENT = buildTable((char, code) => {
  const index = char.length === 1 ? COMPLEMENT_PAIRS.indexOf(char) : -1;
  return index < 0 ? code : COMPLEMENTS.charCodeAt(index);
});

/** Reverse complement of a DNA sequence (IUPAC aware, output upper-case). Unknown letters are kept as-is. */
export function reverseComplement(seq: string): string {
  const out = new Uint8Array(seq.length);
  for (let i = 0, j = seq.length - 1; j >= 0; i++, j--) {
    out[i] = COMPLEMENT[seq.charCodeAt(j) & 0xff] ?? 0;
  }
  return ASCII.decode(out);
}

/** True when template letter `base` satisfies pattern letter `code` (both char codes). */
export function iupacMatch(code: number, base: number): boolean {
  return ((PATTERN_MASK[code & 0xff] ?? 0) & (BASE_MASK[base & 0xff] ?? 0)) !== 0;
}

/** True when an IUPAC pattern equals its own reverse complement. */
export function isPalindromic(pattern: string): boolean {
  return reverseComplement(pattern) === pattern.toUpperCase();
}
