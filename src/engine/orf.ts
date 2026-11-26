import { encodeBases, reverseComplement } from './alphabet';
import { circularLocation, linearLocation, regionStart, sliceCircular } from './location';
import {
  ALL_FRAMES,
  CODON_ORDER,
  type Frame,
  type GeneticCode,
  getGeneticCode,
  translate,
} from './translate';
import type { Location, Strand } from './types';

/** Which codons open an ORF: ATG only, ATG/GTG/TTG, the start codons of the genetic code, or an explicit list. */
export type StartCodonSet = 'atg' | 'atg-gtg-ttg' | 'table' | readonly string[];

export interface OrfOptions {
  /** Minimum length in amino acids, the stop codon not counted. Default 100. */
  readonly minCodons?: number;
  /** Default `atg`. */
  readonly startCodons?: StartCodonSet;
  /** NCBI table id or code object, for stop codons, alternative starts and translation. Default 1. */
  readonly table?: number | GeneticCode;
  /** Frames to report; default all six. */
  readonly frames?: readonly Frame[];
  /** The sequence is circular: ORFs may cross the origin, none longer than the sequence. Default false. */
  readonly circular?: boolean;
  /** Report only the longest ORF of each stop codon. When false, every start codon gives an ORF. Default true. */
  readonly longestOnly?: boolean;
  /** Linear only: also report ORFs that reach the end of the sequence with no stop codon. Default false. */
  readonly openEnded?: boolean;
}

export interface Orf {
  /** The ORF's bases, stop codon included. Two segments when it crosses the origin of a circular sequence. */
  readonly location: Location;
  /**
   * +1..+3: the ORF's first base sits at top-strand position 0, 1 or 2 modulo 3. -1..-3: the same, counted along the
   * reverse complement. On a circular sequence the position is the first base's.
   */
  readonly frame: Frame;
  /** Length in amino acids, the stop codon not counted. */
  readonly lengthAa: number;
  /** Translation without the stop. The first residue is always M, whichever start codon opens the ORF. */
  readonly protein: string;
  readonly startCodon: string;
  /** Null for an open-ended ORF. */
  readonly stopCodon: string | null;
}

interface CodonTables {
  readonly isStart: Uint8Array;
  readonly isStop: Uint8Array;
}

/** Codon index in A, C, G, T order: base 4 digits, so ACG is 0*16 + 1*4 + 2. */
function plainIndex(codon: string): number {
  let index = 0;
  for (const ch of codon) index = index * 4 + 'ACGT'.indexOf(ch);
  return index;
}

function resolveStarts(set: StartCodonSet, code: GeneticCode): readonly string[] {
  if (set === 'atg') return ['ATG'];
  if (set === 'atg-gtg-ttg') return ['ATG', 'GTG', 'TTG'];
  if (set === 'table') return code.starts;
  return set.map((codon) => {
    const normal = codon.toUpperCase().replaceAll('U', 'T');
    if (!/^[ACGT]{3}$/.test(normal)) throw new RangeError(`start codon "${codon}" is not three plain bases`);
    return normal;
  });
}

function buildTables(code: GeneticCode, starts: readonly string[]): CodonTables {
  const isStart = new Uint8Array(64);
  const isStop = new Uint8Array(64);
  for (const [i, codon] of CODON_ORDER.entries()) {
    if (code.aa[i] === '*') isStop[plainIndex(codon)] = 1;
  }
  for (const codon of starts) isStart[plainIndex(codon)] = 1;
  return { isStart, isStop };
}

/** An ORF in the coordinates of the strand being scanned: `[start, start + length)` with the stop included. */
interface RawOrf {
  readonly start: number;
  readonly length: number;
  readonly hasStop: boolean;
}

interface ScanSettings {
  readonly tables: CodonTables;
  readonly minCodons: number;
  readonly longestOnly: boolean;
  readonly openEnded: boolean;
  readonly circular: boolean;
  /** Frame offsets 0..2 (start modulo 3) that the caller wants. */
  readonly wantedOffsets: readonly boolean[];
}

function codonAt(codes: Uint8Array, p: number): number {
  const a = codes[p] as number;
  const b = codes[p + 1] as number;
  const c = codes[p + 2] as number;
  return (a | b | c) & 4 ? -1 : a * 16 + b * 4 + c;
}

/**
 * Scans one strand for ORFs. Linear: each frame is read once. Circular: the strand is doubled with two extra bases
 * and only stops whose codon starts in the second copy count, so each stop is seen once, with its whole upstream
 * context; an ORF may not be longer than the sequence.
 */
function scanStrand(strand: Uint8Array, settings: ScanSettings): RawOrf[] {
  const { tables, minCodons, longestOnly, circular } = settings;
  const n = strand.length;
  const found: RawOrf[] = [];
  if (n < 3) return found;
  let codes = strand;
  let limit = n;
  if (circular) {
    codes = new Uint8Array(2 * n + 2);
    codes.set(strand, 0);
    codes.set(strand, n);
    codes[2 * n] = strand[0] as number;
    codes[2 * n + 1] = strand[1 % n] as number;
    limit = 2 * n + 2;
  }

  const emit = (start: number, stopAt: number) => {
    const codons = (stopAt - start) / 3;
    const offset = start % n;
    if (codons >= minCodons && settings.wantedOffsets[offset % 3]) {
      found.push({ start: offset, length: stopAt + 3 - start, hasStop: true });
    }
  };

  for (let f = 0; f < 3; f++) {
    if (!circular && !settings.wantedOffsets[f]) continue;
    let first = -1;
    let starts: number[] = [];
    let p = f;
    for (; p + 2 < limit; p += 3) {
      const idx = codonAt(codes, p);
      if (idx < 0) continue;
      if (tables.isStop[idx]) {
        if (first >= 0 && (!circular || (p >= n && p < 2 * n))) {
          const lowest = circular ? p + 3 - n : 0;
          if (longestOnly) {
            let s = first;
            if (s < lowest) {
              s += 3 * Math.ceil((lowest - s) / 3);
              while (s < p && !tables.isStart[codonAt(codes, s) as number]) s += 3;
            }
            if (s < p) emit(s, p);
          } else {
            for (const s of starts) if (s >= lowest) emit(s, p);
          }
        }
        first = -1;
        starts = [];
      } else if (tables.isStart[idx]) {
        if (first < 0) first = p;
        if (!longestOnly) starts.push(p);
      }
    }
    if (settings.openEnded && !circular && first >= 0) {
      for (const s of longestOnly ? [first] : starts) {
        if ((p - s) / 3 >= minCodons) found.push({ start: s, length: p - s, hasStop: false });
      }
    }
  }
  return found;
}

function frameOf(strand: Strand, offset: number): Frame {
  return ((strand === 1 ? 1 : -1) * ((offset % 3) + 1)) as Frame;
}

/**
 * Finds open reading frames on both strands: a start codon followed in frame by a stop codon, at least
 * `minCodons` long. By default only the longest ORF of each stop is reported (the most upstream start in frame).
 * Result order: by top-strand position of the first base, then strand.
 * Oracle: a naive per-start scan in `scripts/oracle/core_goldens.py`; proteins from `Bio.Seq.translate(cds=True)`.
 */
export function findOrfs(seq: string, options: OrfOptions = {}): Orf[] {
  const code = typeof options.table === 'object' ? options.table : getGeneticCode(options.table ?? 1);
  const settings = {
    tables: buildTables(code, resolveStarts(options.startCodons ?? 'atg', code)),
    minCodons: options.minCodons ?? 100,
    longestOnly: options.longestOnly ?? true,
    openEnded: options.openEnded === true,
    circular: options.circular === true,
  };
  const n = seq.length;
  const wanted = new Set<Frame>(options.frames ?? ALL_FRAMES);
  const orfs: Orf[] = [];

  const topCodes = encodeBases(seq);
  const strands: { strand: Strand; codes: Uint8Array; text: () => string }[] = [
    { strand: 1, codes: topCodes, text: () => seq },
    {
      strand: -1,
      codes: Uint8Array.from(topCodes, (c) => (c < 4 ? 3 - c : c)).reverse(),
      text: () => reverseComplement(seq),
    },
  ];
  for (const { strand, codes, text } of strands) {
    const wantedOffsets = [0, 1, 2].map((offset) => wanted.has(frameOf(strand, offset)));
    if (!wantedOffsets.includes(true)) continue;
    const raws = scanStrand(codes, { ...settings, wantedOffsets });
    if (raws.length === 0) continue;
    const letters = text();
    for (const raw of raws) {
      const body = settings.circular
        ? sliceCircular(letters, raw.start, raw.length)
        : letters.slice(raw.start, raw.start + raw.length);
      const upper = body.toUpperCase();
      const coding = raw.hasStop ? upper.slice(0, -3) : upper.slice(0, raw.length - (raw.length % 3));
      const topStart = strand === 1 ? raw.start : (((n - raw.start - raw.length) % n) + n) % n;
      let location: Location;
      if (settings.circular) location = circularLocation(topStart, raw.length, n, strand);
      else if (strand === 1) location = linearLocation(raw.start, raw.start + raw.length, 1);
      else location = linearLocation(n - raw.start - raw.length, n - raw.start, -1);
      orfs.push({
        location,
        frame: frameOf(strand, raw.start),
        lengthAa: coding.length / 3,
        protein: `M${translate(coding, { table: code }).slice(1)}`,
        startCodon: upper.slice(0, 3),
        stopCodon: raw.hasStop ? upper.slice(-3) : null,
      });
    }
  }
  return orfs.sort(
    (a, b) => regionStart(a.location) - regionStart(b.location) || b.location.strand - a.location.strand,
  );
}
