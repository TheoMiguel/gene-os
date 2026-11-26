import { AMINO_ACIDS, bump, complement, encodeBases, IUPAC_DNA, IUPAC_RNA } from './alphabet';
import { CODON_ORDER, type GeneticCode, getGeneticCode } from './translate';
import type { Alphabet } from './types';

// ---------------------------------------------------------------------------
// Counts and whole-sequence fractions
// ---------------------------------------------------------------------------

/** Number of each letter in the sequence (case-folded to upper case). Letters that do not occur are absent. */
export function countLetters(seq: string): Record<string, number> {
  const tally = new Uint32Array(256);
  for (let i = 0; i < seq.length; i++) {
    const c = seq.charCodeAt(i) & 0xff;
    bump(tally, c >= 97 && c <= 122 ? c - 32 : c, 1);
  }
  const out: Record<string, number> = {};
  for (let c = 0; c < 256; c++) {
    if ((tally[c] as number) > 0) out[String.fromCharCode(c)] = tally[c] as number;
  }
  return out;
}

/** How ambiguity codes enter GC/AT content. Names and meaning follow `Bio.SeqUtils.gc_fraction`. */
export type AmbiguityMode = 'remove' | 'ignore' | 'weighted';

/** Probability that each IUPAC code is G or C, as in Biopython's `_gc_values`. */
const GC_WEIGHT: Readonly<Record<string, number>> = {
  G: 1,
  C: 1,
  S: 1,
  A: 0,
  T: 0,
  U: 0,
  W: 0,
  M: 0.5,
  R: 0.5,
  Y: 0.5,
  K: 0.5,
  V: 2 / 3,
  B: 2 / 3,
  H: 1 / 3,
  D: 1 / 3,
  X: 0.5,
  N: 0.5,
};

const UNAMBIGUOUS = 'GCSATUW';

function gcAtFractions(seq: string, mode: AmbiguityMode): { gc: number; at: number } {
  const counts = countLetters(seq);
  let gc = 0;
  let at = 0;
  let counted = 0;
  for (const [letter, count] of Object.entries(counts)) {
    const weight = GC_WEIGHT[letter];
    if (weight === undefined) continue;
    const plain = UNAMBIGUOUS.includes(letter);
    if (mode === 'remove' && !plain) continue;
    const effective = mode === 'ignore' && !plain ? 0 : weight;
    gc += count * effective;
    at += mode === 'ignore' && !plain ? 0 : count * (1 - weight);
    counted += count;
  }
  const denominator = mode === 'remove' ? counted : seq.length;
  return denominator === 0 ? { gc: 0, at: 0 } : { gc: gc / denominator, at: at / denominator };
}

/**
 * Fraction of G+C, 0..1. `remove` (default) counts only A C G T U S W in the denominator, `ignore` divides by the
 * full length, `weighted` gives ambiguity codes their expected G+C share. Oracle: `Bio.SeqUtils.gc_fraction`.
 */
export function gcContent(seq: string, mode: AmbiguityMode = 'remove'): number {
  return gcAtFractions(seq, mode).gc;
}

/** Fraction of A+T(U), 0..1, with the same ambiguity handling as `gcContent`. */
export function atContent(seq: string, mode: AmbiguityMode = 'remove'): number {
  return gcAtFractions(seq, mode).at;
}

function plainBaseCounts(seq: string): Int32Array {
  const counts = new Int32Array(5);
  const codes = encodeBases(seq);
  for (let i = 0; i < codes.length; i++) bump(counts, codes[i] as number, 1);
  return counts;
}

/** GC skew `(G - C) / (G + C)` of the whole sequence; 0 when it has no G or C. Oracle: `Bio.SeqUtils.GC_skew`. */
export function gcSkew(seq: string): number {
  return skewOf(plainBaseCounts(seq));
}

/** Purine fraction `(A + G) / (A + C + G + T)` over the plain bases. */
export function purineContent(seq: string): number {
  return purineOf(plainBaseCounts(seq));
}

/** Pyrimidine fraction `(C + T) / (A + C + G + T)` over the plain bases. */
export function pyrimidineContent(seq: string): number {
  return pyrimidineOf(plainBaseCounts(seq));
}

// ---------------------------------------------------------------------------
// Sliding windows
// ---------------------------------------------------------------------------

export interface WindowOptions {
  /** Window length in symbols. On a circular sequence it is clamped to the sequence length. */
  readonly window: number;
  /** Distance between window starts. Default 1. */
  readonly step?: number;
  /** Windows that run past the end continue at the start. Default false. */
  readonly circular?: boolean;
  /** Linear only: also emit the shorter windows that start near the end. Default false. */
  readonly partial?: boolean;
}

/** One value per window, struct-of-arrays so a 5 Mb series stays cheap and crosses a worker boundary. */
export interface WindowSeries {
  readonly window: number;
  readonly step: number;
  /** 0-based start of each window. */
  readonly starts: Int32Array;
  readonly values: Float64Array;
}

/** Computes one number from the symbol counts inside a window and the window's actual length. */
export type WindowMetric = (counts: Int32Array, windowLength: number) => number;

/**
 * The one sliding-window builder behind every chart series. `codes` holds one small symbol code per position
 * (below `symbols`); the metric sees the counts of each symbol in the window. Each window costs O(step), so
 * the whole series is linear in the sequence length.
 */
export function slidingWindow(
  codes: Uint8Array,
  symbols: number,
  metric: WindowMetric,
  options: WindowOptions,
): WindowSeries {
  const n = codes.length;
  const step = Math.max(1, Math.floor(options.step ?? 1));
  const circular = options.circular === true;
  const window = Math.max(1, Math.min(Math.floor(options.window), circular ? n : Number.POSITIVE_INFINITY));
  const empty: WindowSeries = { window, step, starts: new Int32Array(0), values: new Float64Array(0) };
  if (n === 0 || (!circular && window > n && options.partial !== true)) return empty;

  const lastStart = circular ? n - 1 : options.partial ? n - 1 : n - window;
  const count = Math.floor(lastStart / step) + 1;
  const starts = new Int32Array(count);
  const values = new Float64Array(count);
  const counts = new Int32Array(symbols);
  const at = (i: number) => codes[circular ? i % n : i] as number;

  let from = 0;
  let to = 0;
  for (let k = 0; k < count; k++) {
    const start = k * step;
    const end = circular ? start + window : Math.min(start + window, n);
    while (to < end) bump(counts, at(to++), 1);
    while (from < start) bump(counts, at(from++), -1);
    starts[k] = start;
    values[k] = metric(counts, end - start);
  }
  return { window, step, starts, values };
}

const A = 0;
const C = 1;
const G = 2;
const T = 3;

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function plainTotal(c: Int32Array): number {
  return (c[A] as number) + (c[C] as number) + (c[G] as number) + (c[T] as number);
}

function skewOf(c: Int32Array): number {
  return ratio((c[G] as number) - (c[C] as number), (c[G] as number) + (c[C] as number));
}

function purineOf(c: Int32Array): number {
  return ratio((c[A] as number) + (c[G] as number), plainTotal(c));
}

function pyrimidineOf(c: Int32Array): number {
  return ratio((c[C] as number) + (c[T] as number), plainTotal(c));
}

/** Shortest window for which the basic Tm formula is used; shorter windows use the Wallace rule. */
const TM_BASIC_MIN_LENGTH = 14;

/**
 * Melting temperature of a window in °C. Windows of 14 or more bases use the basic formula
 * `64.9 + 0.41 * %GC - 672.4 / N` (= `Bio.SeqUtils.MeltingTemp.Tm_GC` with `userset=(64.9, 0.41, 672.4, 0)` and
 * no salt correction). Shorter windows use the Wallace rule `2 (A+T) + 4 (G+C)` (`Tm_Wallace`).
 */
function meltingTemperature(c: Int32Array, windowLength: number): number {
  const gc = (c[G] as number) + (c[C] as number);
  const at = (c[A] as number) + (c[T] as number);
  if (windowLength < TM_BASIC_MIN_LENGTH) return 2 * at + 4 * gc;
  return 64.9 + (0.41 * 100 * gc) / windowLength - 672.4 / windowLength;
}

/** Shannon entropy in bits of the base composition: 0 for one repeated base, 2 for equal A, C, G and T. */
function baseEntropy(c: Int32Array): number {
  const total = plainTotal(c);
  if (total === 0) return 0;
  let bits = 0;
  for (let b = 0; b < 4; b++) {
    const count = c[b] as number;
    if (count > 0) bits -= (count / total) * Math.log2(count / total);
  }
  return bits;
}

/** Window metrics for every nucleotide chart series. */
export const NUCLEOTIDE_METRICS = {
  gc: (c) => ratio((c[G] as number) + (c[C] as number), plainTotal(c)),
  at: (c) => ratio((c[A] as number) + (c[T] as number), plainTotal(c)),
  gcSkew: skewOf,
  purine: purineOf,
  pyrimidine: pyrimidineOf,
  complexity: baseEntropy,
  tm: meltingTemperature,
} as const satisfies Record<string, WindowMetric>;

export type NucleotideSeriesKind = keyof typeof NUCLEOTIDE_METRICS;

/** Sliding-window chart series of a nucleotide sequence. Ambiguity codes count in the window length but in no base. */
export function nucleotideSeries(
  seq: string,
  kind: NucleotideSeriesKind,
  options: WindowOptions,
): WindowSeries {
  return slidingWindow(encodeBases(seq), 5, NUCLEOTIDE_METRICS[kind], options);
}

/**
 * Cumulative GC skew: the running sum of the skew of consecutive, non-overlapping windows. The curve's minimum and
 * maximum mark the replication origin and terminus in bacterial genomes. Oracle: cumulative sum of `GC_skew`.
 */
export function cumulativeGcSkew(seq: string, window: number): WindowSeries {
  const series = nucleotideSeries(seq, 'gcSkew', { window, step: window, partial: true });
  const values = new Float64Array(series.values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += series.values[i] as number;
    values[i] = sum;
  }
  return { ...series, values };
}

// ---------------------------------------------------------------------------
// Molecular weight
// ---------------------------------------------------------------------------

const WATER = 18.0153;

/** Nucleotide monophosphate weights in the chain, from `Bio.Data.IUPACData` (average masses). */
const DNA_WEIGHTS: Readonly<Record<string, number>> = { A: 331.2218, C: 307.1971, G: 347.2212, T: 322.2085 };
const RNA_WEIGHTS: Readonly<Record<string, number>> = { A: 347.2212, C: 323.1965, G: 363.2206, U: 324.1813 };

/** `Bio.Data.IUPACData.protein_weights`: free amino acid average masses. */
const PROTEIN_WEIGHTS: Readonly<Record<string, number>> = {
  A: 89.0932,
  C: 121.1582,
  D: 133.1027,
  E: 147.1293,
  F: 165.1891,
  G: 75.0666,
  H: 155.1546,
  I: 131.1729,
  K: 146.1876,
  L: 131.1729,
  M: 149.2113,
  N: 132.1179,
  O: 255.3134,
  P: 115.1305,
  Q: 146.1445,
  R: 174.201,
  S: 105.0926,
  T: 119.1192,
  U: 168.0532,
  V: 117.1463,
  W: 204.2252,
  Y: 181.1885,
};

function meanWeight(bases: string, table: Readonly<Record<string, number>>): number {
  let sum = 0;
  for (const base of bases) sum += table[base] as number;
  return sum / bases.length;
}

const RESIDUE_WEIGHTS: Readonly<Record<string, number>> = {
  ...PROTEIN_WEIGHTS,
  B: meanWeight('DN', PROTEIN_WEIGHTS),
  Z: meanWeight('EQ', PROTEIN_WEIGHTS),
  J: meanWeight('IL', PROTEIN_WEIGHTS),
  X: meanWeight(AMINO_ACIDS, PROTEIN_WEIGHTS),
};

/** Weight per letter, ambiguity codes at the mean of the bases they stand for. */
function nucleotideWeights(alphabet: 'dna' | 'rna'): Readonly<Record<string, number>> {
  const base = alphabet === 'rna' ? RNA_WEIGHTS : DNA_WEIGHTS;
  const codes = alphabet === 'rna' ? IUPAC_RNA : IUPAC_DNA;
  return Object.fromEntries(Object.entries(codes).map(([code, bases]) => [code, meanWeight(bases, base)]));
}

const NUCLEOTIDE_WEIGHTS = { dna: nucleotideWeights('dna'), rna: nucleotideWeights('rna') } as const;

export interface NucleotideWeightOptions {
  /** `rna` uses the RNA weight table. Default `dna`. */
  readonly alphabet?: Extract<Alphabet, 'dna' | 'rna'>;
  /** Weigh the sequence together with its complement. Default false. */
  readonly doubleStranded?: boolean;
  /** Circular molecule: one more phosphodiester bond per strand, so one water less. Default false. */
  readonly circular?: boolean;
}

function strandWeight(
  counts: Record<string, number>,
  weights: Readonly<Record<string, number>>,
  circular: boolean,
) {
  let sum = 0;
  let residues = 0;
  for (const [letter, count] of Object.entries(counts)) {
    const w = weights[letter];
    if (w === undefined) continue;
    sum += w * count;
    residues += count;
  }
  if (residues === 0) return 0;
  return sum - (residues - 1) * WATER - (circular ? WATER : 0);
}

/**
 * Molecular weight in g/mol of a DNA or RNA molecule. IUPAC ambiguity codes weigh the mean of their bases;
 * other characters are ignored. Oracle: `Bio.SeqUtils.molecular_weight` (`seq_type`, `double_stranded`, `circular`).
 */
export function nucleotideWeight(seq: string, options: NucleotideWeightOptions = {}): number {
  const alphabet = options.alphabet ?? 'dna';
  const weights = NUCLEOTIDE_WEIGHTS[alphabet];
  const circular = options.circular === true;
  const top = strandWeight(countLetters(seq), weights, circular);
  if (!options.doubleStranded) return top;
  return top + strandWeight(countLetters(complement(seq, alphabet)), weights, circular);
}

/**
 * Molecular weight in g/mol of a protein: residue masses minus one water per peptide bond. B, Z, J and X weigh the
 * mean of the residues they may be; other characters (stop `*`, gaps) are ignored.
 * Oracle: `Bio.SeqUtils.molecular_weight(seq, 'protein')` and `ProteinAnalysis.molecular_weight`.
 */
export function proteinWeight(seq: string): number {
  return strandWeight(countLetters(seq), RESIDUE_WEIGHTS, false);
}

// ---------------------------------------------------------------------------
// Codon usage
// ---------------------------------------------------------------------------

/** Position of A, C, G, T in the T, C, A, G order of the codon table. */
const TCAG_OF = [2, 1, 3, 0] as const;

export interface CodonUsageRow {
  readonly codon: string;
  /** Residue the codon codes for under the chosen genetic code; `*` for stop. */
  readonly aminoAcid: string;
  readonly count: number;
  /** Occurrences per thousand codons counted. */
  readonly perThousand: number;
  /** Relative synonymous codon usage: count divided by the mean count of the synonymous codons. 0 when unused. */
  readonly rscu: number;
}

export interface CodonUsageOptions {
  /** NCBI table id or code object. Default 1. */
  readonly table?: number | GeneticCode;
  /** Base offset 0..2 of the first codon. Default 0. */
  readonly frame?: 0 | 1 | 2;
}

/**
 * Turns codon counts into rows: share per thousand and RSCU (Sharp & Li 1987). `counts` lists the 64 codons in
 * NCBI table order (see `CODON_ORDER`). Use it for counts that did not come from a sequence in hand, such as a
 * reference organism's table.
 */
export function codonUsageFromCounts(
  counts: ArrayLike<number>,
  options: Pick<CodonUsageOptions, 'table'> = {},
): { rows: CodonUsageRow[]; total: number } {
  const code = typeof options.table === 'object' ? options.table : getGeneticCode(options.table ?? 1);
  let total = 0;
  for (let index = 0; index < 64; index++) total += counts[index] as number;
  const familySum = new Map<string, { sum: number; size: number }>();
  for (const [index, aa] of [...code.aa].entries()) {
    const family = familySum.get(aa) ?? { sum: 0, size: 0 };
    family.sum += counts[index] as number;
    family.size++;
    familySum.set(aa, family);
  }
  const rows = CODON_ORDER.map((codon, index) => {
    const aminoAcid = code.aa[index] as string;
    const count = counts[index] as number;
    const family = familySum.get(aminoAcid) as { sum: number; size: number };
    return {
      codon,
      aminoAcid,
      count,
      perThousand: total === 0 ? 0 : (1000 * count) / total,
      rscu: family.sum === 0 ? 0 : (count * family.size) / family.sum,
    };
  });
  return { rows, total };
}

/**
 * Codon counts and RSCU for one reading frame of the top strand. All 64 codons are listed in NCBI table order.
 * Codons that hold an ambiguity code are not counted. Counts match a plain codon tally; RSCU follows Sharp & Li (1987).
 */
export function codonUsage(
  seq: string,
  options: CodonUsageOptions = {},
): { rows: CodonUsageRow[]; total: number } {
  const code = typeof options.table === 'object' ? options.table : getGeneticCode(options.table ?? 1);
  const codes = encodeBases(seq);
  const tally = new Uint32Array(64);
  for (let i = options.frame ?? 0; i + 2 < codes.length; i += 3) {
    const [a, b, c] = [codes[i] as number, codes[i + 1] as number, codes[i + 2] as number];
    if (a > 3 || b > 3 || c > 3) continue;
    bump(tally, ((TCAG_OF[a] as number) << 4) | ((TCAG_OF[b] as number) << 2) | (TCAG_OF[c] as number), 1);
  }
  return codonUsageFromCounts(tally, { table: code });
}
