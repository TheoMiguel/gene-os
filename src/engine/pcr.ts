import { BASE_MASK, PATTERN_MASK, reverseComplement } from './dna-internal';
import type { Amplicon, Primer, PrimerBinding, Strand, Topology } from './types';

export interface BindingOptions {
  /** Mismatches allowed in the annealed part. Default 2. */
  readonly maxMismatches?: number;
  /** 3'-terminal bases that must match the template exactly. Default 5. */
  readonly exactThreePrime?: number;
  /** Shortest annealed part, counted from the 3' end. Default 15 (or the whole primer when it is shorter). */
  readonly minAnnealed?: number;
}

export interface PcrOptions extends BindingOptions {
  /** Longest product to report, bp. Default 20 000. */
  readonly maxProductLength?: number;
}

const DEFAULTS = { maxMismatches: 2, exactThreePrime: 5, minAnnealed: 15, maxProductLength: 20_000 };

/**
 * Every place a primer anneals to the template, on both strands.
 *
 * The primer's 3' end must match the template exactly over `exactThreePrime` bases. From there the annealed part
 * grows toward the 5' end while the mismatch count stays within `maxMismatches`, and ends on its last matching
 * base; the rest of the primer is a 5' tail that does not bind (a restriction site, a homology arm). The annealed
 * part must reach `minAnnealed` bases. IUPAC codes in the primer match any base they stand for.
 *
 * `span` is the template region the annealed part covers on the top strand. On a circular template a site may
 * cross the origin; its span then starts in `[0, length)` and ends past `length`.
 */
export function findBindingSites(
  primer: Primer,
  template: string,
  topology: Topology,
  options: BindingOptions = {},
): PrimerBinding[] {
  const n = template.length;
  const length = primer.seq.length;
  if (length === 0 || n === 0) return [];
  const circular = topology === 'circular';
  const maxMismatches = options.maxMismatches ?? DEFAULTS.maxMismatches;
  const exact = Math.min(options.exactThreePrime ?? DEFAULTS.exactThreePrime, length);
  const minAnnealed = Math.min(options.minAnnealed ?? DEFAULTS.minAnnealed, length);
  const reach = circular ? Math.min(length, n) : length;
  // Template base masks with `length` bases of padding on each side: the wrapped sequence on a circular
  // template, no base (mask 0, never matches) on a linear one.
  const pad = length;
  const text = new Uint8Array(n + 2 * pad);
  for (let i = -pad; i < n + pad; i++) {
    const inside = i >= 0 && i < n;
    if (inside || circular) text[i + pad] = BASE_MASK[template.charCodeAt(((i % n) + n) % n) & 0xff] ?? 0;
  }
  const toMask = (s: string) => Uint8Array.from(s, (c) => PATTERN_MASK[c.charCodeAt(0) & 0xff] ?? 0);
  // Primer masks read from the 3' end: strand 1 walks left from the 3' base, strand -1 walks right.
  const fromThreePrime = toMask(primer.seq).reverse();
  const complementFromThreePrime = toMask(reverseComplement(primer.seq));
  const sites: PrimerBinding[] = [];

  const hit = (masks: Uint8Array, origin: number, step: 1 | -1, k: number) =>
    ((masks[k] ?? 0) & (text[origin + step * k] ?? 0)) !== 0;
  /** Anneal from text index `origin` in direction `step`; returns the annealed length (0 if the site fails). */
  const anneal = (masks: Uint8Array, origin: number, step: 1 | -1): number => {
    for (let k = 0; k < exact; k++) if (!hit(masks, origin, step, k)) return 0;
    let mismatches = 0;
    let annealed = exact;
    for (let k = exact; k < reach; k++) {
      if (hit(masks, origin, step, k)) annealed = k + 1;
      else if (mismatches++ === maxMismatches) break;
    }
    return annealed >= minAnnealed ? annealed : 0;
  };
  const add = (
    strand: Strand,
    start: number,
    annealed: number,
    masks: Uint8Array,
    origin: number,
    step: 1 | -1,
  ) => {
    let mismatches = 0;
    for (let k = 0; k < annealed; k++) if (!hit(masks, origin, step, k)) mismatches++;
    const s = circular ? ((start % n) + n) % n : start;
    sites.push({ primerId: primer.id, strand, span: { start: s, end: s + annealed }, mismatches });
  };

  // Strand 1: the primer reads like the top strand; its 3' base sits on template index `end - 1`.
  for (let end = circular ? 0 : 1; end <= (circular ? n - 1 : n); end++) {
    const annealed = anneal(fromThreePrime, end - 1 + pad, -1);
    if (annealed) add(1, end - annealed, annealed, fromThreePrime, end - 1 + pad, -1);
  }
  // Strand -1: the primer reads like the bottom strand; its reverse complement reads like the top strand, with
  // the primer's 3' base complementary to template index `start`.
  for (let start = 0; start < n; start++) {
    const annealed = anneal(complementFromThreePrime, start + pad, 1);
    if (annealed) add(-1, start, annealed, complementFromThreePrime, start + pad, 1);
  }
  return sites.sort((a, b) => a.span.start - b.span.start || b.strand - a.strand);
}

/**
 * Simulate PCR: every product made by a forward-facing site (strand 1) and a downstream reverse-facing site
 * (strand -1) of any of the primers, including a single primer that binds both ways.
 *
 * The product is the forward primer in full (tail included), the template between the two 3' ends, and the
 * reverse complement of the reverse primer in full. On a circular template a product may run across the origin.
 * Colony PCR is this same call on the plasmid that carries the insert. Products are sorted by length.
 */
export function simulatePcr(
  primers: readonly Primer[],
  template: string,
  topology: Topology,
  options: PcrOptions = {},
): Amplicon[] {
  const n = template.length;
  const circular = topology === 'circular';
  const maxLength = options.maxProductLength ?? DEFAULTS.maxProductLength;
  const seqOf = new Map(primers.map((p) => [p.id, p.seq.toUpperCase()]));
  const sites = primers.flatMap((p) => findBindingSites(p, template, topology, options));
  const forwards = sites.filter((s) => s.strand === 1);
  const reverses = sites.filter((s) => s.strand === -1);
  const amplicons: Amplicon[] = [];

  for (const fwd of forwards) {
    for (const rev of reverses) {
      // Template between the two 3' ends, in unwrapped coordinates.
      const from = fwd.span.end;
      let to = rev.span.start;
      if (circular) {
        while (to < from) to += n;
        if (to - from >= n) continue;
      } else if (to < from) {
        continue;
      }
      const forwardSeq = seqOf.get(fwd.primerId) ?? '';
      const reverseSeq = seqOf.get(rev.primerId) ?? '';
      const length = forwardSeq.length + (to - from) + reverseSeq.length;
      if (length > maxLength) continue;
      const middle = circular ? sliceCircular(template, from, to) : template.slice(from, to);
      amplicons.push({
        forward: fwd,
        reverse: rev,
        seq: forwardSeq + middle.toUpperCase() + reverseComplement(reverseSeq),
        length,
        wrapsOrigin: circular && to + (rev.span.end - rev.span.start) > n,
      });
    }
  }
  return amplicons.sort((a, b) => a.length - b.length);
}

/** Template slice in unwrapped coordinates (`0 <= from <= to`, `to - from < length`) of a circular sequence. */
function sliceCircular(template: string, from: number, to: number): string {
  const n = template.length;
  const start = from % n;
  const end = start + (to - from);
  return end <= n ? template.slice(start, end) : template.slice(start) + template.slice(0, end - n);
}
