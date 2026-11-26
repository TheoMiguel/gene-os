import enzymeCatalog from '../data/enzymes.json';
import supplierCatalog from '../data/suppliers.json';
import { PATTERN_MASK, reverseComplement, TEMPLATE_MASK } from './alphabet';
import type { CutSite, EndType, Enzyme, Fragment, FragmentEnd, Span, Strand, Topology } from './types';

/** Every commercially available single-cut enzyme in REBASE (scripts/oracle/build_enzyme_catalog.py). */
export const ENZYME_CATALOG: readonly Enzyme[] = enzymeCatalog as readonly Enzyme[];

/** REBASE supplier code -> company name. */
export const SUPPLIERS: Readonly<Record<string, string>> = supplierCatalog;

/**
 * Every site of one enzyme on one molecule, stored in columns so a genome-scale scan over the whole catalog
 * stays compact. Index `i` of each column describes the same cut; cuts are sorted by top-strand position.
 */
export interface EnzymeSites {
  readonly enzyme: Enzyme;
  /** Top-strand cut position (index of the first base after the cut), in `[0, length)` on circular molecules. */
  readonly topCuts: Int32Array;
  /** Start of the recognition site on the top strand, in `[0, length)`. */
  readonly siteStarts: Int32Array;
  /** Strand the recognition site was found on. */
  readonly strands: Int8Array;
}

export interface RestrictionScan {
  readonly length: number;
  readonly topology: Topology;
  /** One entry per scanned enzyme, in the order the enzymes were given. */
  readonly sites: readonly EnzymeSites[];
}

export type CutCountClass = 'non_cutter' | 'unique' | 'double' | 'multiple';

export interface EnzymeFilter {
  readonly endTypes?: readonly EndType[];
  readonly cutCounts?: readonly CutCountClass[];
  /** Keep enzymes sold by at least one of these supplier codes. */
  readonly suppliers?: readonly string[];
}

/** The end an enzyme leaves: blunt, or the strand whose 5' or 3' end overhangs. */
export function endType(enzyme: Enzyme): EndType {
  if (enzyme.topCut === enzyme.bottomCut) return 'blunt';
  return enzyme.topCut < enzyme.bottomCut ? 'five_prime' : 'three_prime';
}

/** Cut-count class used by the enzyme filters: 0, 1, 2, or 3 and more cuts. */
export function cutCountClass(count: number): CutCountClass {
  if (count === 0) return 'non_cutter';
  if (count === 1) return 'unique';
  return count === 2 ? 'double' : 'multiple';
}

// ---------------------------------------------------------------------------
// Site scan
// ---------------------------------------------------------------------------

const PREFIX = 4;
const BASE_INDEX: Readonly<Record<number, number>> = { 1: 0, 2: 1, 4: 2, 8: 3 };

interface Pattern {
  /** PATTERN_MASK value per position. */
  readonly masks: Uint8Array;
  /** Enzymes whose site (strand 1) or reverse-complemented site (strand -1) this pattern is. */
  readonly owners: readonly { readonly enzyme: number; readonly strand: Strand }[];
}

function compilePatterns(enzymes: readonly Enzyme[]): Pattern[] {
  const byText = new Map<string, { enzyme: number; strand: Strand }[]>();
  const add = (text: string, enzyme: number, strand: Strand) => {
    const owners = byText.get(text);
    if (owners) owners.push({ enzyme, strand });
    else byText.set(text, [{ enzyme, strand }]);
  };
  enzymes.forEach((enzyme, index) => {
    const site = enzyme.site.toUpperCase();
    add(site, index, 1);
    const reverse = reverseComplement(site);
    if (reverse !== site) add(reverse, index, -1);
  });
  return [...byText].map(([text, owners]) => ({
    masks: Uint8Array.from(text, (char) => PATTERN_MASK[char.charCodeAt(0) & 0xff] ?? 0),
    owners,
  }));
}

/** Bucket key (4-mer of definite bases) -> patterns whose first PREFIX letters accept that 4-mer. */
function bucketPatterns(patterns: readonly Pattern[]): Int32Array[] {
  const buckets: number[][] = Array.from({ length: 1 << (2 * PREFIX) }, () => []);
  patterns.forEach((pattern, index) => {
    let keys = [0];
    for (let j = 0; j < PREFIX; j++) {
      const mask = pattern.masks[j] ?? 0;
      const next: number[] = [];
      for (let base = 0; base < 4; base++) {
        if (mask & (1 << base)) for (const key of keys) next.push((key << 2) | base);
      }
      keys = next;
    }
    for (const key of keys) buckets[key]?.push(index);
  });
  return buckets.map((bucket) => Int32Array.from(bucket));
}

function matchesAt(text: Uint8Array, p: number, masks: Uint8Array, from: number): boolean {
  for (let j = from; j < masks.length; j++) {
    if (((masks[j] ?? 0) & (text[p + j] ?? 0)) === 0) return false;
  }
  return true;
}

class SiteCollector {
  readonly topCuts: number[] = [];
  readonly siteStarts: number[] = [];
  readonly strands: Strand[] = [];

  constructor(
    private readonly enzyme: Enzyme,
    private readonly length: number,
    private readonly circular: boolean,
  ) {}

  add(siteStart: number, strand: Strand): void {
    const { enzyme, length } = this;
    const siteLength = enzyme.site.length;
    let top = strand === 1 ? siteStart + enzyme.topCut : siteStart + siteLength - enzyme.bottomCut;
    if (this.circular) {
      top = mod(top, length);
    } else {
      const bottom = top + enzyme.bottomCut - enzyme.topCut;
      if (top <= 0 || top >= length || bottom <= 0 || bottom >= length) return;
    }
    this.topCuts.push(top);
    this.siteStarts.push(siteStart);
    this.strands.push(strand);
  }

  build(): EnzymeSites {
    const order = this.topCuts.map((_, i) => i);
    order.sort((a, b) => (this.topCuts[a] ?? 0) - (this.topCuts[b] ?? 0) || a - b);
    return {
      enzyme: this.enzyme,
      topCuts: Int32Array.from(order, (i) => this.topCuts[i] ?? 0),
      siteStarts: Int32Array.from(order, (i) => this.siteStarts[i] ?? 0),
      strands: Int8Array.from(order, (i) => this.strands[i] ?? 1),
    };
  }
}

function mod(value: number, length: number): number {
  const r = value % length;
  return r < 0 ? r + length : r;
}

/**
 * Find every recognition site of `enzymes` on both strands of `seq` and the cut each one makes.
 *
 * Sites are IUPAC patterns; a palindromic site is counted once. On a circular molecule sites that span the
 * origin are found and cut positions wrap into `[0, length)`. On a linear molecule a cut is kept only when both
 * strands are cut inside the molecule, as Bio.Restriction does. Runs in O(length x patterns per 4-mer).
 */
export function scanSites(seq: string, topology: Topology, enzymes: readonly Enzyme[]): RestrictionScan {
  const length = seq.length;
  const circular = topology === 'circular';
  const patterns = compilePatterns(enzymes);
  const buckets = bucketPatterns(patterns);
  const maxSite = patterns.reduce((max, p) => Math.max(max, p.masks.length), PREFIX);
  const collectors = enzymes.map((enzyme) => new SiteCollector(enzyme, length, circular));

  const textLength = circular && length > 0 ? length + maxSite - 1 : length;
  const text = new Uint8Array(textLength);
  for (let i = 0; i < textLength; i++) text[i] = TEMPLATE_MASK[seq.charCodeAt(i % length) & 0xff] ?? 0;

  const record = (pattern: Pattern, p: number) => {
    for (const owner of pattern.owners) collectors[owner.enzyme]?.add(p, owner.strand);
  };
  const fits = (pattern: Pattern, p: number) =>
    circular ? pattern.masks.length <= length : p + pattern.masks.length <= length;

  let key = 0;
  let definiteRun = 0;
  const keyMask = (1 << (2 * PREFIX)) - 1;
  // Each position p is tested once the window [p, p + PREFIX) has been read.
  for (let i = 0; i < textLength + PREFIX - 1; i++) {
    if (i < textLength) {
      const base = BASE_INDEX[text[i] ?? 0];
      if (base === undefined) {
        definiteRun = 0;
      } else {
        definiteRun++;
        key = ((key << 2) | base) & keyMask;
      }
    } else {
      definiteRun = 0;
    }
    const p = i - PREFIX + 1;
    if (p < 0 || p >= length) continue;
    if (definiteRun >= PREFIX) {
      const bucket = buckets[key] ?? new Int32Array();
      for (let b = 0; b < bucket.length; b++) {
        const pattern = patterns[bucket[b] ?? 0] as Pattern;
        if (fits(pattern, p) && matchesAt(text, p, pattern.masks, PREFIX)) record(pattern, p);
      }
    } else {
      for (const pattern of patterns) {
        if (fits(pattern, p) && matchesAt(text, p, pattern.masks, 0)) record(pattern, p);
      }
    }
  }

  return { length, topology, sites: collectors.map((c) => c.build()) };
}

// ---------------------------------------------------------------------------
// Cut sites, summaries and filters
// ---------------------------------------------------------------------------

/** Top-strand slice that may wrap the origin of a circular molecule. */
function sliceWrapped(seq: string, start: number, end: number): string {
  const length = seq.length;
  if (start >= 0 && end <= length) return seq.slice(start, end);
  const parts: string[] = [];
  for (let i = start; i < end; i++) parts.push(seq[mod(i, length)] ?? '');
  return parts.join('');
}

interface CutEnd {
  readonly end: EndType;
  readonly overhang: string;
  readonly bottomCut: number;
}

function cutEnd(seq: string, enzyme: Enzyme, topCut: number, circular: boolean): CutEnd {
  const bottom = topCut + enzyme.bottomCut - enzyme.topCut;
  const overhang = sliceWrapped(seq, Math.min(topCut, bottom), Math.max(topCut, bottom)).toUpperCase();
  return { end: endType(enzyme), overhang, bottomCut: circular ? mod(bottom, seq.length) : bottom };
}

/** Expand one enzyme's compact sites into `CutSite` records with end type and overhang. */
export function cutSites(seq: string, topology: Topology, sites: EnzymeSites): CutSite[] {
  const circular = topology === 'circular';
  const result: CutSite[] = [];
  for (let i = 0; i < sites.topCuts.length; i++) {
    const topCut = sites.topCuts[i] ?? 0;
    const { end, overhang, bottomCut } = cutEnd(seq, sites.enzyme, topCut, circular);
    result.push({
      enzyme: sites.enzyme.name,
      topCut,
      bottomCut,
      siteStart: sites.siteStarts[i] ?? 0,
      siteStrand: (sites.strands[i] ?? 1) as Strand,
      end,
      overhang,
    });
  }
  return result;
}

/** Enzyme names grouped by how many times each cuts (non-cutter, unique, double, multiple). */
export function summarizeCutCounts(scan: RestrictionScan): Record<CutCountClass, string[]> {
  const summary: Record<CutCountClass, string[]> = { non_cutter: [], unique: [], double: [], multiple: [] };
  for (const sites of scan.sites) summary[cutCountClass(sites.topCuts.length)].push(sites.enzyme.name);
  return summary;
}

/** Keep the enzymes that pass every given criterion; an absent criterion keeps everything. */
export function filterSites(sites: readonly EnzymeSites[], filter: EnzymeFilter): EnzymeSites[] {
  const { endTypes, cutCounts, suppliers } = filter;
  return sites.filter(
    ({ enzyme, topCuts }) =>
      (!endTypes || endTypes.includes(endType(enzyme))) &&
      (!cutCounts || cutCounts.includes(cutCountClass(topCuts.length))) &&
      (!suppliers || enzyme.suppliers.some((code) => suppliers.includes(code))),
  );
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

interface Cut {
  readonly position: number;
  readonly end: FragmentEnd;
}

function spansBetween(start: number, end: number, length: number): Span[] {
  if (end > start) return [{ start, end }];
  const spans: Span[] = [{ start, end: length }];
  if (end > 0) spans.push({ start: 0, end });
  return spans;
}

/**
 * Digest a molecule with one or more enzymes at once and return the fragments in order along the top strand.
 *
 * Each fragment carries its two ends: the enzyme, end type and overhang of the cut that made it, or the
 * terminus of a linear molecule. Cuts from different enzymes at the same top-strand position count once (the
 * first enzyme given wins). A circular molecule with n cuts gives n fragments, the last one across the origin;
 * an uncut circular molecule is returned as one fragment of its full length with terminus ends.
 */
export function digest(seq: string, topology: Topology, sites: readonly EnzymeSites[]): Fragment[] {
  const length = seq.length;
  const circular = topology === 'circular';
  const byPosition = new Map<number, Cut>();
  for (const { enzyme, topCuts } of sites) {
    for (const position of topCuts) {
      if (byPosition.has(position)) continue;
      const { end, overhang } = cutEnd(seq, enzyme, position, circular);
      byPosition.set(position, { position, end: { kind: 'cut', enzyme: enzyme.name, end, overhang } });
    }
  }
  const cuts = [...byPosition.values()].sort((a, b) => a.position - b.position);
  const terminus: FragmentEnd = { kind: 'terminus' };
  const fragment = (start: number, end: number, leftEnd: FragmentEnd, rightEnd: FragmentEnd): Fragment => ({
    location: { segments: spansBetween(start, end, length), strand: 1 },
    length: end > start ? end - start : end + length - start,
    leftEnd,
    rightEnd,
  });

  if (cuts.length === 0) return [fragment(0, length, terminus, terminus)];
  const fragments: Fragment[] = [];
  const first = cuts[0] as Cut;
  const last = cuts[cuts.length - 1] as Cut;
  if (!circular) fragments.push(fragment(0, first.position, terminus, first.end));
  for (let i = 0; i + 1 < cuts.length; i++) {
    const left = cuts[i] as Cut;
    const right = cuts[i + 1] as Cut;
    fragments.push(fragment(left.position, right.position, left.end, right.end));
  }
  if (circular) fragments.push(fragment(last.position, first.position, last.end, first.end));
  else fragments.push(fragment(last.position, length, last.end, terminus));
  return fragments;
}
