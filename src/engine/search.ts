import { baseMask, cleanSequence, encodeBaseMasks, PLAIN_BASE_MASKS, reverseComplement } from './alphabet';
import { circularLocation, linearLocation } from './location';
import type { Alphabet, Location, Strand } from './types';

/**
 * `text`: the query literally, case-insensitive. `motif`: IUPAC letters for nucleotides; for protein, letters,
 * `X` for any residue, `[ILV]` for a set and `{P}` for any residue except. `regex`: a JavaScript regular expression
 * (non-overlapping matches, case-insensitive).
 */
export type SearchMode = 'text' | 'motif' | 'regex';

export interface SearchOptions {
  /** Default `text`. */
  readonly mode?: SearchMode;
  /** Default `dna`. Protein searches the given strand only. */
  readonly alphabet?: Alphabet;
  /** Matches may cross the origin. Default false. */
  readonly circular?: boolean;
  /** Nucleotides: also search the bottom strand. Default true. */
  readonly bothStrands?: boolean;
  /** Most hits to return; the total still counts every match. Default 10000. */
  readonly maxHits?: number;
  /** Regex on a circular sequence: how many bases past the end a match may reach. Default 1000. */
  readonly maxWrap?: number;
}

export interface SearchHit {
  /** 0-based top-strand position of the match's first base (for a match across the origin, the base before it). */
  readonly start: number;
  readonly length: number;
  /** Strand the query matches: -1 when it matches the reverse complement of the top strand. */
  readonly strand: Strand;
  /** Two segments when the match crosses the origin of a circular sequence. */
  readonly location: Location;
}

export interface SearchResult {
  /** Up to `maxHits`, ordered by `start`, then forward strand first. */
  readonly hits: SearchHit[];
  /** Every match found, also beyond `maxHits`. */
  readonly total: number;
  readonly truncated: boolean;
}

const DEFAULT_MAX_HITS = 10_000;
const DEFAULT_MAX_WRAP = 1000;
const NO_RESIDUE = 31;

interface Collector {
  readonly strand: Strand;
  total: number;
  readonly hits: SearchHit[];
}

class Hits {
  readonly passes: Collector[] = [];
  constructor(
    private readonly seqLength: number,
    private readonly circular: boolean,
    private readonly cap: number,
  ) {}

  pass(strand: Strand): Collector {
    const collector: Collector = { strand, total: 0, hits: [] };
    this.passes.push(collector);
    return collector;
  }

  add(pass: Collector, start: number, length: number): void {
    pass.total++;
    if (pass.hits.length >= this.cap) return;
    const location = this.circular
      ? circularLocation(start, length, this.seqLength, pass.strand)
      : linearLocation(start, start + length, pass.strand);
    pass.hits.push({ start, length, strand: pass.strand, location });
  }

  result(): SearchResult {
    const all = this.passes.flatMap((p) => p.hits);
    all.sort((a, b) => a.start - b.start || b.strand - a.strand);
    const total = this.passes.reduce((sum, p) => sum + p.total, 0);
    return { hits: all.slice(0, this.cap), total, truncated: total > this.cap };
  }
}

/** Bitset per pattern position over residue/base codes; bit `code` is set when that code matches. */
function compileNucleotidePattern(pattern: string): Int32Array {
  const allow = new Int32Array(pattern.length);
  for (const [i, ch] of [...pattern].entries()) {
    const mask = baseMask(ch);
    if (mask === 0) throw new RangeError(`"${ch}" is not an IUPAC nucleotide code`);
    let bits = 0;
    for (const m of PLAIN_BASE_MASKS) if (m & mask) bits |= 1 << m;
    allow[i] = bits;
  }
  return allow;
}

function residueCode(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 65 && c <= 90) return c - 65;
  return c === 42 ? 26 : NO_RESIDUE;
}

function encodeProtein(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) {
    const c = seq.charCodeAt(i);
    const upper = c >= 97 && c <= 122 ? c - 32 : c;
    out[i] = upper >= 65 && upper <= 90 ? upper - 65 : upper === 42 ? 26 : NO_RESIDUE;
  }
  return out;
}

const ANY_LETTER = (1 << 26) - 1;

function compileProteinPattern(pattern: string): Int32Array {
  const allow: number[] = [];
  const tokens = pattern.toUpperCase().match(/\[[A-Z*]+\]|\{[A-Z*]+\}|[A-Z*]/g) ?? [];
  if (tokens.join('') !== pattern.toUpperCase()) {
    throw new RangeError(`"${pattern}" is not a valid protein motif`);
  }
  for (const token of tokens) {
    const set = (letters: string) => [...letters].reduce((bits, ch) => bits | (1 << residueCode(ch)), 0);
    if (token === 'X') allow.push(ANY_LETTER);
    else if (token.startsWith('[')) allow.push(set(token.slice(1, -1)));
    else if (token.startsWith('{')) allow.push(ANY_LETTER & ~set(token.slice(1, -1)));
    else allow.push(set(token));
  }
  return Int32Array.from(allow);
}

function scanCodes(
  codes: Uint8Array,
  allow: Int32Array,
  circular: boolean,
  visit: (start: number) => void,
): void {
  const n = codes.length;
  const m = allow.length;
  if (m === 0 || m > n) return;
  const lastLinear = n - m;
  for (let i = 0; i <= lastLinear; i++) {
    let j = 0;
    while (j < m && (((allow[j] as number) >>> (codes[i + j] as number)) & 1) === 1) j++;
    if (j === m) visit(i);
  }
  if (!circular) return;
  for (let i = lastLinear + 1; i < n; i++) {
    let j = 0;
    while (j < m && (((allow[j] as number) >>> (codes[(i + j) % n] as number)) & 1) === 1) j++;
    if (j === m) visit(i);
  }
}

function scanText(text: string, query: string, circular: boolean, visit: (start: number) => void): void {
  const n = text.length;
  const m = query.length;
  if (m === 0 || m > n) return;
  const haystack = circular ? text + text.slice(0, m - 1) : text;
  for (let at = haystack.indexOf(query); at >= 0 && at < n; at = haystack.indexOf(query, at + 1)) visit(at);
}

function scanRegex(
  text: string,
  expression: string,
  circular: boolean,
  maxWrap: number,
  visit: (start: number, length: number) => void,
): void {
  const n = text.length;
  const haystack = circular ? text + text.slice(0, Math.min(n - 1, maxWrap)) : text;
  const re = new RegExp(expression, 'gi');
  for (let match = re.exec(haystack); match !== null; match = re.exec(haystack)) {
    if (match.index >= n) break;
    if (match[0].length === 0) re.lastIndex++;
    else visit(match.index, match[0].length);
  }
}

/**
 * Searches a sequence for a query and returns hit spans with strand. Linear in the sequence length for text and
 * motif; no more than the first `maxHits` hits are kept, so a query that matches everywhere stays cheap.
 * Nucleotide queries are also searched on the bottom strand unless `bothStrands` is false; a query equal to its own
 * reverse complement is reported once, on strand 1. Throws `RangeError` for an invalid motif and `SyntaxError` for an
 * invalid regular expression.
 */
export function searchSequence(seq: string, query: string, options: SearchOptions = {}): SearchResult {
  const mode = options.mode ?? 'text';
  const alphabet = options.alphabet ?? 'dna';
  const circular = options.circular === true;
  const nucleotide = alphabet !== 'protein';
  const n = seq.length;
  const hits = new Hits(n, circular, options.maxHits ?? DEFAULT_MAX_HITS);
  const needle = mode === 'text' || (mode === 'motif' && nucleotide) ? cleanSequence(query) : query.trim();
  if (needle.length === 0 || n === 0) return hits.result();

  const queries: { strand: Strand; text: string }[] = [{ strand: 1, text: needle }];
  if (nucleotide && options.bothStrands !== false && mode !== 'regex') {
    const reverse = reverseComplement(needle, alphabet);
    if (reverse !== needle.toUpperCase()) queries.push({ strand: -1, text: reverse });
  }

  if (mode === 'regex') {
    const maxWrap = options.maxWrap ?? DEFAULT_MAX_WRAP;
    const forward = hits.pass(1);
    scanRegex(seq, needle, circular, maxWrap, (start, length) => hits.add(forward, start, length));
    if (nucleotide && options.bothStrands !== false) {
      const reverse = hits.pass(-1);
      scanRegex(reverseComplement(seq, alphabet), needle, circular, maxWrap, (a, length) => {
        hits.add(reverse, (((n - a - length) % n) + n) % n, length);
      });
    }
    return hits.result();
  }

  const upper = seq.toUpperCase();
  const codes = mode === 'motif' ? (nucleotide ? encodeBaseMasks(seq) : encodeProtein(seq)) : undefined;
  for (const { strand, text } of queries) {
    const pass = hits.pass(strand);
    const add = (start: number) => hits.add(pass, start, text.length);
    if (codes) {
      const allow = nucleotide ? compileNucleotidePattern(text) : compileProteinPattern(text);
      scanCodes(codes, allow, circular, (start) => hits.add(pass, start, allow.length));
    } else {
      scanText(upper, text.toUpperCase(), circular, add);
    }
  }
  return hits.result();
}
