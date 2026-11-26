import type { Alphabet } from './types';

/** IUPAC nucleotide codes mapped to the plain bases they stand for. */
export const IUPAC_DNA: Readonly<Record<string, string>> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  R: 'AG',
  Y: 'CT',
  S: 'CG',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
};

/** RNA codes: the DNA table with U in place of T. */
export const IUPAC_RNA: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IUPAC_DNA).map(([code, bases]) => [code === 'T' ? 'U' : code, bases.replace('T', 'U')]),
);

/** The 20 standard amino acids, in alphabetical one-letter order. */
export const AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY';

/** One-letter codes accepted in protein input: the 20, ambiguity codes B Z J X, rare U O, and stop `*`. */
export const PROTEIN_LETTERS = `${AMINO_ACIDS}BZJXUO*`;

/** Bit per plain base, so an IUPAC code is the OR of the bases it stands for. U shares T's bit. */
export const BASE_BIT = { A: 1, C: 2, G: 4, T: 8 } as const;

const NUCLEOTIDE_COMPLEMENT = 'ATGCYRMKBVDHSWN';
const NUCLEOTIDE_COMPLEMENT_OF = 'TACGRYKMVBHDSWN';

function buildTable(fill: (table: Uint8Array) => void): Uint8Array {
  const table = new Uint8Array(256);
  fill(table);
  return table;
}

/** Base mask (A=1, C=2, G=4, T/U=8, IUPAC = OR of members) per char code. 0 for non-nucleotide characters. */
const MASK_OF = buildTable((t) => {
  for (const [code, bases] of Object.entries(IUPAC_DNA)) {
    let mask = 0;
    for (const base of bases) mask |= BASE_BIT[base as keyof typeof BASE_BIT];
    t[code.charCodeAt(0)] = mask;
    t[code.toLowerCase().charCodeAt(0)] = mask;
  }
  t[85] = BASE_BIT.T;
  t[117] = BASE_BIT.T;
});

const BASE_CODE_OF = buildTable((t) => {
  t.fill(4);
  for (const [i, base] of [...'ACGT'].entries()) {
    t[base.charCodeAt(0)] = i;
    t[base.toLowerCase().charCodeAt(0)] = i;
  }
  t[85] = 3;
  t[117] = 3;
});

function complementTable(thymine: 'T' | 'U'): Uint8Array {
  return buildTable((t) => {
    for (let i = 0; i < 256; i++) t[i] = i;
    for (let i = 0; i < NUCLEOTIDE_COMPLEMENT.length; i++) {
      const from = NUCLEOTIDE_COMPLEMENT[i] as string;
      const to = NUCLEOTIDE_COMPLEMENT_OF[i] as string;
      for (const [a, b] of [
        [from, to],
        [from.toLowerCase(), to.toLowerCase()],
      ] as const) {
        t[a.charCodeAt(0)] = b.charCodeAt(0);
      }
    }
    t[65] = thymine.charCodeAt(0);
    t[97] = thymine.toLowerCase().charCodeAt(0);
    for (const ch of 'TUtu') t[ch.charCodeAt(0)] = ch === ch.toUpperCase() ? 65 : 97;
  });
}

const DNA_COMPLEMENT = complementTable('T');
const RNA_COMPLEMENT = complementTable('U');

const textDecoder = new TextDecoder('latin1');

/** Adds `delta` to a typed-array counter. */
export function bump(counts: Uint32Array | Int32Array, index: number, delta: number): void {
  counts[index] = (counts[index] as number) + delta;
}

/** Decodes one byte per character into a string, without per-character concatenation. */
export function bytesToString(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/** Bit mask of the plain bases an IUPAC nucleotide letter stands for (A=1, C=2, G=4, T/U=8), 0 if not a nucleotide. */
export function baseMask(char: string): number {
  return MASK_OF[char.charCodeAt(0) & 0xff] ?? 0;
}

/**
 * Per-character base mask for a whole sequence, one byte per base. Linear time, no per-base allocation.
 * Shared by every scanner that matches IUPAC codes.
 */
export function encodeBaseMasks(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) out[i] = MASK_OF[seq.charCodeAt(i) & 0xff] as number;
  return out;
}

/** Plain-base codes for a sequence: A=0, C=1, G=2, T/U=3, anything else (N, gaps, other IUPAC) = 4. */
export function encodeBases(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) out[i] = BASE_CODE_OF[seq.charCodeAt(i) & 0xff] as number;
  return out;
}

/** Base masks of the four plain bases: the only sequence letters an IUPAC pattern letter can match. */
export const PLAIN_BASE_MASKS: readonly number[] = [1, 2, 4, 8];

/**
 * True when a pattern letter matches a sequence letter, IUPAC-aware: the sequence letter must be a plain base
 * (A, C, G, T or U) inside the set the pattern letter stands for. `R` matches A and G; `N` matches every plain base;
 * an ambiguity code in the sequence matches nothing, as in `Bio.SeqUtils.nt_search`.
 */
export function iupacMatches(patternCode: string, seqBase: string): boolean {
  const sequenceMask = baseMask(seqBase);
  return PLAIN_BASE_MASKS.includes(sequenceMask) && (sequenceMask & baseMask(patternCode)) !== 0;
}

/**
 * Cleans pasted sequence text: removes whitespace, digits (GenBank line numbers), and any other character that
 * cannot be part of a sequence, then upper-cases. Keeps letters, `*` (stop) and `-` (gap).
 */
export function cleanSequence(raw: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i <= raw.length; i++) {
    const c = i < raw.length ? raw.charCodeAt(i) : -1;
    const keep = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 42 || c === 45;
    if (keep) continue;
    if (i > from) out += raw.slice(from, i);
    from = i + 1;
  }
  return out.toUpperCase();
}

/**
 * Guesses whether a cleaned sequence is DNA, RNA or protein.
 * Nucleotide when at least 90% of the letters (gaps and stops excluded) are A, C, G, T, U or N, or when every
 * letter is an IUPAC nucleotide code and at least 75% are A, C, G, T, U or N. RNA when it has U and no T.
 */
export function detectAlphabet(seq: string): Alphabet {
  const counts = new Uint32Array(128);
  let letters = 0;
  for (let i = 0; i < seq.length; i++) {
    const c = seq.charCodeAt(i) & 0x7f;
    if (c === 45 || c === 42) continue;
    bump(counts, c >= 97 ? c - 32 : c, 1);
    letters++;
  }
  if (letters === 0) return 'dna';
  const at = (ch: string) => counts[ch.charCodeAt(0)] as number;
  const plain = at('A') + at('C') + at('G') + at('T') + at('U') + at('N');
  let allIupac = true;
  for (let c = 65; c < 91 && allIupac; c++) {
    if ((counts[c] as number) > 0 && MASK_OF[c] === 0 && c !== 85) allIupac = false;
  }
  const nucleotide = plain / letters >= 0.9 || (allIupac && plain / letters >= 0.75);
  if (!nucleotide) return 'protein';
  return at('U') > 0 && at('T') === 0 ? 'rna' : 'dna';
}

/** Complement of each base (A↔T or A↔U, C↔G, IUPAC codes paired). Characters that are not nucleotides pass through. */
export function complement(seq: string, alphabet: Alphabet = 'dna'): string {
  const table = alphabet === 'rna' ? RNA_COMPLEMENT : DNA_COMPLEMENT;
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) out[i] = table[seq.charCodeAt(i) & 0xff] as number;
  return bytesToString(out);
}

/** Reverse complement, IUPAC-aware and RNA-aware. Oracle: `Bio.Seq.Seq.reverse_complement`. */
export function reverseComplement(seq: string, alphabet: Alphabet = 'dna'): string {
  const table = alphabet === 'rna' ? RNA_COMPLEMENT : DNA_COMPLEMENT;
  const n = seq.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[n - 1 - i] = table[seq.charCodeAt(i) & 0xff] as number;
  return bytesToString(out);
}

const RESIDUE_CODE_OF = buildTable((t) => {
  t.fill(AMINO_ACIDS.length);
  for (const [i, aa] of [...AMINO_ACIDS].entries()) {
    t[aa.charCodeAt(0)] = i;
    t[aa.toLowerCase().charCodeAt(0)] = i;
  }
});

/** Residue codes for a protein: index in `AMINO_ACIDS` for the 20 standard residues, 20 for anything else. */
export function encodeResidues(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) out[i] = RESIDUE_CODE_OF[seq.charCodeAt(i) & 0xff] as number;
  return out;
}
