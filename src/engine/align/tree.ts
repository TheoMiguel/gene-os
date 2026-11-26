import { AMINO_ACIDS } from '../alphabet';
import type { AlignAlphabet } from './types';

/** A rooted guide tree: leaves are input indices. `height` is half the distance at which the two clusters joined. */
export type GuideTree =
  | { readonly leaf: number }
  | { readonly left: GuideTree; readonly right: GuideTree; readonly height: number };

const DNA_CODE: Readonly<Record<string, number>> = { A: 0, C: 1, G: 2, T: 3, U: 3 };
const K_DNA = 6;
const K_PROTEIN = 3;

/** Counts of every k-mer of a sequence over the plain alphabet; windows with another letter are skipped. */
function kmerCounts(seq: string, alphabet: AlignAlphabet): { counts: Uint16Array; total: number } {
  const dna = alphabet === 'dna';
  const radix = dna ? 4 : 20;
  const k = dna ? K_DNA : K_PROTEIN;
  const counts = new Uint16Array(radix ** k);
  let total = 0;
  let code = 0;
  let valid = 0;
  const top = radix ** (k - 1);
  for (let i = 0; i < seq.length; i++) {
    const letter = seq[i] as string;
    const value = dna ? (DNA_CODE[letter] ?? -1) : AMINO_ACIDS.indexOf(letter);
    if (value < 0) {
      valid = 0;
      code = 0;
      continue;
    }
    code = (code % top) * radix + value;
    if (valid < k) valid++;
    if (valid === k) {
      counts[code] = Math.min(65535, (counts[code] as number) + 1);
      total++;
    }
  }
  return { counts, total };
}

/**
 * Distance matrix from shared k-mers: one minus the share of the shorter sequence's k-mers that the other holds.
 * It is 0 for identical sequences and near 1 for unrelated ones, and costs one pass per pair over a fixed table.
 */
export function kmerDistances(seqs: readonly string[], alphabet: AlignAlphabet): Float64Array {
  const n = seqs.length;
  const profiles = seqs.map((s) => kmerCounts(s, alphabet));
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = profiles[i] as ReturnType<typeof kmerCounts>;
      const b = profiles[j] as ReturnType<typeof kmerCounts>;
      const denominator = Math.min(a.total, b.total);
      let d = 1;
      if (denominator > 0) {
        let shared = 0;
        for (let w = 0; w < a.counts.length; w++)
          shared += Math.min(a.counts[w] as number, b.counts[w] as number);
        d = 1 - shared / denominator;
      } else if (seqs[i] === seqs[j]) d = 0;
      out[i * n + j] = d;
      out[j * n + i] = d;
    }
  }
  return out;
}

/** UPGMA over a symmetric `n * n` distance matrix. Ties go to the lowest pair of cluster indices, so the tree is deterministic. */
export function upgma(distances: Float64Array, n: number): GuideTree {
  const dist = Float64Array.from(distances);
  const nodes: (GuideTree | null)[] = Array.from({ length: n }, (_, leaf) => ({ leaf }));
  const sizes = new Array<number>(n).fill(1);
  for (let step = 0; step < n - 1; step++) {
    let bi = -1;
    let bj = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      if (!nodes[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (nodes[j] && (dist[i * n + j] as number) < best) {
          best = dist[i * n + j] as number;
          bi = i;
          bj = j;
        }
      }
    }
    const si = sizes[bi] as number;
    const sj = sizes[bj] as number;
    for (let k = 0; k < n; k++) {
      if (!nodes[k] || k === bi || k === bj) continue;
      const d = ((dist[bi * n + k] as number) * si + (dist[bj * n + k] as number) * sj) / (si + sj);
      dist[bi * n + k] = d;
      dist[k * n + bi] = d;
    }
    nodes[bi] = { left: nodes[bi] as GuideTree, right: nodes[bj] as GuideTree, height: best / 2 };
    nodes[bj] = null;
    sizes[bi] = si + sj;
  }
  return nodes.find((node) => node !== null) as GuideTree;
}

/** Newick text of a tree, with `labels[i]` for leaf `i` and branch lengths from the cluster heights. */
export function toNewick(tree: GuideTree, labels: readonly string[]): string {
  const heightOf = (t: GuideTree): number => ('leaf' in t ? 0 : t.height);
  const walk = (t: GuideTree, parentHeight: number): string => {
    const length = `:${(parentHeight - heightOf(t)).toFixed(4)}`;
    if ('leaf' in t) return `${labels[t.leaf]}${length}`;
    return `(${walk(t.left, t.height)},${walk(t.right, t.height)})${length}`;
  };
  if ('leaf' in tree) return `${labels[tree.leaf]};`;
  return `(${walk(tree.left, tree.height)},${walk(tree.right, tree.height)});`;
}
