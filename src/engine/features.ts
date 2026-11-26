import catalogJson from '../data/features.json';
import { encodeBaseMasks, reverseComplement } from './alphabet';
import { circularLocation, linearLocation } from './location';
import { sixFrameTranslation } from './translate';
import {
  FEATURE_TYPES,
  type Feature,
  type FeatureSignature,
  type FeatureType,
  type Strand,
  type Topology,
} from './types';

/** A detected feature with the fraction of identical bases (or residues) that earned the hit. */
export interface DetectedFeature extends Feature {
  readonly origin: 'detected';
  /** Matching fraction over the signature's length, 0..1. */
  readonly identity: number;
  /** Record the signature came from, when the catalog gives one. */
  readonly source?: string;
}

export interface DetectOptions {
  /** Circular sequences also report hits that cross the origin. Default linear. */
  readonly topology?: Topology;
  /** Signatures to search for. Default: the bundled catalog. */
  readonly catalog?: readonly FeatureSignature[];
  /** Search protein signatures in the six-frame translation. Default true. */
  readonly proteins?: boolean;
}

function parseCatalog(raw: unknown): FeatureSignature[] {
  if (!Array.isArray(raw)) throw new TypeError('feature catalog must be an array');
  return raw.map((entry: Record<string, unknown>, index) => {
    const seq = entry.seq;
    const valid =
      typeof entry.name === 'string' &&
      FEATURE_TYPES.includes(entry.type as FeatureType) &&
      typeof seq === 'string' &&
      /^[A-Za-z]+$/.test(seq) &&
      (entry.seqAlphabet === 'dna' || entry.seqAlphabet === 'protein') &&
      typeof entry.minIdentity === 'number' &&
      entry.minIdentity > 0 &&
      entry.minIdentity <= 1;
    if (!valid) throw new TypeError(`feature catalog entry ${index} is malformed`);
    return entry as unknown as FeatureSignature;
  });
}

/** The bundled catalog of common cloning-vector parts, built by `scripts/oracle/build_feature_catalog.py`. */
export const FEATURE_CATALOG: readonly FeatureSignature[] = parseCatalog(catalogJson);

const SEED_MAX = 10;
const SEED_MIN = 4;
/** Overlapping hits of one signature beyond this many per cluster are dropped, weakest first. */
const CLUSTER_CAP = 256;

/** Mismatches a signature may carry for its identity threshold. */
function mismatchBudget(length: number, minIdentity: number): number {
  return Math.floor(length * (1 - minIdentity) + 1e-9);
}

/** Code (A=0, C=1, G=2, T=3, other=4) of each base mask. */
const CODE_OF_MASK = Uint8Array.from({ length: 16 }, (_, mask) => {
  const index = [1, 2, 4, 8].indexOf(mask);
  return index < 0 ? 4 : index;
});

interface SeedRef {
  readonly query: number;
  readonly offset: number;
}

interface DnaQuery {
  readonly signature: FeatureSignature;
  readonly strand: Strand;
  readonly masks: Uint8Array;
  readonly budget: number;
}

interface SeedIndex {
  readonly queries: readonly DnaQuery[];
  /** Per seed length: table from packed k-mer to 1 + index in `refs`, and the queries to try for each. */
  readonly tables: ReadonlyMap<number, { table: Uint16Array; refs: SeedRef[][] }>;
  /** Queries whose pieces hold no usable seed, tried at every position. */
  readonly unseeded: readonly number[];
  readonly longest: number;
}

const indexCache = new WeakMap<readonly FeatureSignature[], SeedIndex>();

/**
 * Splits each query into `budget + 1` pieces. A hit with at most `budget` mismatches must hold one piece intact
 * (pigeonhole), so looking up one seed per piece finds every qualifying hit with no loss of sensitivity.
 */
function buildSeedIndex(catalog: readonly FeatureSignature[]): SeedIndex {
  const cached = indexCache.get(catalog);
  if (cached) return cached;
  const queries: DnaQuery[] = [];
  for (const signature of catalog) {
    if (signature.seqAlphabet !== 'dna') continue;
    const forward = encodeBaseMasks(signature.seq);
    const budget = mismatchBudget(forward.length, signature.minIdentity);
    queries.push({ signature, strand: 1, masks: forward, budget });
    const reverse = reverseComplement(signature.seq.toUpperCase());
    if (reverse !== signature.seq.toUpperCase()) {
      queries.push({ signature, strand: -1, masks: encodeBaseMasks(reverse), budget });
    }
  }
  const tables = new Map<number, { table: Uint16Array; refs: SeedRef[][] }>();
  const unseeded: number[] = [];
  for (const [q, query] of queries.entries()) {
    const length = query.masks.length;
    const pieces = query.budget + 1;
    let seeded = true;
    const seeds: { offset: number; length: number; value: number }[] = [];
    for (let p = 0; p < pieces; p++) {
      const from = Math.floor((p * length) / pieces);
      const to = Math.floor(((p + 1) * length) / pieces);
      const seed = longestPlainRun(query.masks, from, to);
      if (seed.length < SEED_MIN) {
        seeded = false;
        break;
      }
      seeds.push(seed);
    }
    if (!seeded) {
      unseeded.push(q);
      continue;
    }
    for (const seed of seeds) {
      let entry = tables.get(seed.length);
      if (!entry) {
        entry = { table: new Uint16Array(4 ** seed.length), refs: [] };
        tables.set(seed.length, entry);
      }
      let slot = entry.table[seed.value] as number;
      if (slot === 0) {
        entry.refs.push([]);
        slot = entry.refs.length;
        entry.table[seed.value] = slot;
      }
      (entry.refs[slot - 1] as SeedRef[]).push({ query: q, offset: seed.offset });
    }
  }
  const index = { queries, tables, unseeded, longest: Math.max(0, ...queries.map((q) => q.masks.length)) };
  indexCache.set(catalog, index);
  return index;
}

/** Longest stretch of plain bases within `[from, to)`, cut to `SEED_MAX`, with its packed value. */
function longestPlainRun(masks: Uint8Array, from: number, to: number) {
  let bestStart = from;
  let bestLength = 0;
  let runStart = from;
  for (let i = from; i <= to; i++) {
    if (i === to || CODE_OF_MASK[masks[i] as number] === 4) {
      if (i - runStart > bestLength) {
        bestStart = runStart;
        bestLength = i - runStart;
      }
      runStart = i + 1;
    }
  }
  const length = Math.min(bestLength, SEED_MAX);
  let value = 0;
  for (let i = 0; i < length; i++)
    value = value * 4 + (CODE_OF_MASK[masks[bestStart + i] as number] as number);
  return { offset: bestStart, length, value };
}

/** Mismatches between a query and the sequence at `start`, or -1 once more than `budget` are seen. */
function mismatchesAt(seqMasks: Uint8Array, start: number, query: Uint8Array, budget: number): number {
  let mismatches = 0;
  for (let i = 0; i < query.length; i++) {
    const s = seqMasks[start + i] as number;
    const q = query[i] as number;
    if ((s & q) === 0 || (s & (s - 1)) !== 0) {
      mismatches++;
      if (mismatches > budget) return -1;
    }
  }
  return mismatches;
}

interface RawHit {
  readonly signature: FeatureSignature;
  readonly strand: Strand;
  readonly start: number;
  readonly length: number;
  readonly mismatches: number;
}

function findDnaHits(seq: string, circular: boolean, index: SeedIndex): RawHit[] {
  const n = seq.length;
  const extra = circular ? Math.max(0, index.longest - 1) : 0;
  const seqMasks = new Uint8Array(n + extra);
  seqMasks.set(encodeBaseMasks(seq));
  for (let i = 0; i < extra; i++) seqMasks[n + i] = seqMasks[i % n] as number;
  const codes = new Uint8Array(seqMasks.length);
  for (let i = 0; i < codes.length; i++) codes[i] = CODE_OF_MASK[seqMasks[i] as number] as number;

  const found: RawHit[][] = index.queries.map(() => []);
  const seenStarts: Set<number>[] = index.queries.map(() => new Set());
  const test = (q: number, rawStart: number) => {
    const query = index.queries[q] as DnaQuery;
    const length = query.masks.length;
    if (length > n) return;
    let start = rawStart;
    if (circular) start = ((start % n) + n) % n;
    else if (start < 0 || start + length > n) return;
    const seen = seenStarts[q] as Set<number>;
    if (seen.has(start)) return;
    seen.add(start);
    const mismatches = mismatchesAt(seqMasks, start, query.masks, query.budget);
    if (mismatches >= 0) {
      (found[q] as RawHit[]).push({
        signature: query.signature,
        strand: query.strand,
        start,
        length,
        mismatches,
      });
    }
  };

  const lastKmerStart = (k: number) => (circular ? n - 1 : n - k);
  for (const [k, { table, refs }] of index.tables) {
    const mask = 4 ** k - 1;
    let kmer = 0;
    let valid = 0;
    const end = lastKmerStart(k) + k;
    for (let i = 0; i < end && i < codes.length; i++) {
      const code = codes[i] as number;
      if (code === 4) {
        valid = 0;
        kmer = 0;
        continue;
      }
      kmer = ((kmer << 2) | code) & mask;
      if (++valid < k) continue;
      const slot = table[kmer] as number;
      if (slot === 0) continue;
      const kmerStart = i - k + 1;
      for (const ref of refs[slot - 1] as SeedRef[]) test(ref.query, kmerStart - ref.offset);
    }
  }
  for (const q of index.unseeded) {
    const length = (index.queries[q] as DnaQuery).masks.length;
    const last = circular ? n - 1 : n - length;
    for (let start = 0; start <= last; start++) test(q, start);
  }
  return found.flat();
}

/** Residue mismatches between a query and `text` at `start`, or -1 above the budget. */
function proteinMismatches(text: string, start: number, query: string, budget: number): number {
  let mismatches = 0;
  for (let i = 0; i < query.length; i++) {
    if (text.charCodeAt(start + i) !== query.charCodeAt(i)) {
      mismatches++;
      if (mismatches > budget) return -1;
    }
  }
  return mismatches;
}

function findProteinHits(seq: string, circular: boolean, signatures: readonly FeatureSignature[]): RawHit[] {
  if (signatures.length === 0) return [];
  const n = seq.length;
  const longest = Math.max(...signatures.map((s) => s.seq.length));
  const wrap = circular ? Math.min(n - 1, 3 * longest + 2) : 0;
  const text = circular ? seq + seq.slice(0, wrap) : seq;
  const total = text.length;
  const hits: RawHit[] = [];
  const frames = sixFrameTranslation(text);
  for (const signature of signatures) {
    const query = signature.seq.toUpperCase();
    const budget = mismatchBudget(query.length, signature.minIdentity);
    const pieces = budget + 1;
    for (const { frame, protein } of frames) {
      const offset = Math.abs(frame) - 1;
      const seen = new Set<number>();
      for (let p = 0; p < pieces; p++) {
        const from = Math.floor((p * query.length) / pieces);
        const piece = query.slice(from, Math.floor(((p + 1) * query.length) / pieces));
        for (let at = protein.indexOf(piece); at >= 0; at = protein.indexOf(piece, at + 1)) {
          const residueStart = at - from;
          if (residueStart < 0 || seen.has(residueStart)) continue;
          seen.add(residueStart);
          if (residueStart + query.length > protein.length) continue;
          const mismatches = proteinMismatches(protein, residueStart, query, budget);
          if (mismatches < 0) continue;
          const bases = 3 * query.length;
          const strandStart = offset + 3 * residueStart;
          const topStart = frame > 0 ? strandStart : total - strandStart - bases;
          if (topStart < 0 || topStart >= n || (!circular && topStart + bases > n)) continue;
          hits.push({ signature, strand: frame > 0 ? 1 : -1, start: topStart, length: bases, mismatches });
        }
      }
    }
  }
  return hits;
}

/**
 * Keeps the best of each run of overlapping hits of one signature on one strand, so a repeat does not report the
 * same element at every offset. Hits are ranked by identity, then position.
 */
function suppressOverlaps(hits: RawHit[]): RawHit[] {
  const kept: RawHit[] = [];
  const groups = new Map<string, RawHit[]>();
  for (const hit of hits) {
    const key = `${hit.signature.name}\0${hit.signature.seqAlphabet}\0${hit.strand}`;
    const group = groups.get(key);
    if (group) group.push(hit);
    else groups.set(key, [hit]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start);
    let cluster: RawHit[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const ranked = cluster
        .sort((a, b) => a.mismatches - b.mismatches || a.start - b.start)
        .slice(0, CLUSTER_CAP);
      const accepted: RawHit[] = [];
      for (const hit of ranked) {
        if (!accepted.some((a) => hit.start < a.start + a.length && a.start < hit.start + hit.length)) {
          accepted.push(hit);
        }
      }
      kept.push(...accepted);
      cluster = [];
    };
    for (const hit of group) {
      if (cluster.length > 0 && hit.start >= clusterEnd) flush();
      cluster.push(hit);
      clusterEnd = Math.max(clusterEnd, hit.start + hit.length);
    }
    if (cluster.length > 0) flush();
  }
  return kept;
}

/**
 * Finds known cloning-vector parts in a nucleotide sequence, on both strands. DNA signatures are matched without
 * gaps: a seed from each of `budget + 1` pieces of the signature locates candidates, and a candidate counts when its
 * identity reaches the signature's `minIdentity`. This misses no qualifying hit, and its cost grows with the
 * sequence length and the number of seed matches, not with length times catalog size. Protein signatures (short tags)
 * are searched in the six-frame translation, bacterial code. On a circular sequence, hits across the origin are
 * returned with two segments.
 */
export function detectFeatures(seq: string, options: DetectOptions = {}): DetectedFeature[] {
  const circular = options.topology === 'circular';
  const catalog = options.catalog ?? FEATURE_CATALOG;
  const n = seq.length;
  if (n === 0) return [];
  const raw = [
    ...findDnaHits(seq, circular, buildSeedIndex(catalog)),
    ...(options.proteins === false
      ? []
      : findProteinHits(
          seq,
          circular,
          catalog.filter((s) => s.seqAlphabet === 'protein'),
        )),
  ];
  return suppressOverlaps(raw)
    .sort(
      (a, b) => a.start - b.start || a.signature.name.localeCompare(b.signature.name) || a.strand - b.strand,
    )
    .map((hit): DetectedFeature => {
      const location = circular
        ? circularLocation(hit.start, hit.length, n, hit.strand)
        : linearLocation(hit.start, hit.start + hit.length, hit.strand);
      const residues = hit.signature.seqAlphabet === 'protein' ? hit.length / 3 : hit.length;
      const { signature } = hit;
      return {
        id: `detected:${signature.name}:${hit.start}:${hit.strand}`,
        type: signature.type,
        name: signature.name,
        location,
        origin: 'detected',
        identity: (residues - hit.mismatches) / residues,
        ...(signature.description === undefined ? {} : { description: signature.description }),
        ...(signature.source === undefined ? {} : { source: signature.source }),
      };
    });
}
