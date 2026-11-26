import { describe, expect, it } from 'vitest';
import globinFasta from '../../tests/fixtures/align/globins.fasta?raw';
import variants from '../../tests/fixtures/align/variants.json';
import golden from '../../tests/oracle/align.json';
import type { AlignMode, ScoringOptions } from './align';
import {
  alignMultiple,
  alignPair,
  buildScorer,
  ColumnClass,
  consensus,
  dropSharedGaps,
  findDifferences,
  msaDifferences,
  scoreAlignedPair,
  toNewick,
} from './align';
import { alignGlobalLinear, alignHirschberg } from './align/hirschberg';
import { pairRows, renderOps } from './align/pairwise';
import { encodeFor } from './align/scoring';

interface GoldenCase {
  label: string;
  alphabet: 'dna' | 'protein';
  mode: AlignMode;
  scores: ScoringOptions & { matrix?: never };
  a: string;
  b: string;
  score: number;
  optimalCount: number | null;
  unique?: { alignedA: string; alignedB: string; range: number[] };
}

const cases = golden.cases as unknown as GoldenCase[];

function degap(row: string): string {
  return row.replaceAll('-', '');
}

describe('pairwise alignment against Biopython PairwiseAligner', () => {
  it.each(
    cases.map((c, i) => [i, `${c.mode} ${c.alphabet} ${c.label} ${JSON.stringify(c.scores)}`] as const),
  )('case %i: %s', (index) => {
    const c = cases[index] as GoldenCase;
    const options = { ...c.scores, alphabet: c.alphabet, mode: c.mode } as ScoringOptions & {
      mode: AlignMode;
    };
    const result = alignPair(c.a, c.b, options);
    if (result.status !== 'ok') throw new Error('too large');
    const { alignment } = result;
    expect(alignment.score).toBe(c.score);
    expect(degap(alignment.alignedA)).toBe(c.a.slice(alignment.startA, alignment.endA));
    expect(degap(alignment.alignedB)).toBe(c.b.slice(alignment.startB, alignment.endB));
    const scorer = buildScorer(c.alphabet, options);
    expect(scoreAlignedPair(scorer, alignment.alignedA, alignment.alignedB, c.mode === 'overlap')).toBe(
      c.score,
    );
    if (c.unique) {
      expect([alignment.alignedA, alignment.alignedB]).toEqual([c.unique.alignedA, c.unique.alignedB]);
    }
  });
});

/** Deterministic generator so a failing trial can be replayed. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomSeq(next: () => number, n: number, letters: string): string {
  let out = '';
  for (let i = 0; i < n; i++) out += letters[Math.floor(next() * letters.length)];
  return out;
}

function mutate(next: () => number, seq: string, letters: string, subs = 0.08, indels = 0.03): string {
  let out = '';
  for (const ch of seq) {
    const r = next();
    if (r < subs) out += letters[Math.floor(next() * letters.length)];
    else if (r < subs + indels) continue;
    else if (r < subs + 2 * indels) out += ch + letters[Math.floor(next() * letters.length)];
    else out += ch;
  }
  return out;
}

describe('Hirschberg linear-space global alignment', () => {
  it('scores like the quadratic traceback and returns an alignment that reproduces the score, at every split depth', () => {
    const next = lcg(7);
    for (let trial = 0; trial < 150; trial++) {
      const protein = trial % 2 === 1;
      const letters = protein ? 'ACDEFGHIKLMNPQRSTVWY' : 'ACGT';
      const a = randomSeq(next, 5 + Math.floor(next() * 120), letters);
      const b =
        trial % 3 === 0 ? randomSeq(next, 5 + Math.floor(next() * 120), letters) : mutate(next, a, letters);
      const options: ScoringOptions = {
        alphabet: protein ? 'protein' : 'dna',
        gapOpen: [1, 5, 10][trial % 3] as number,
        gapExtend: [1, 0.5, 2][trial % 3] as number,
        ...(protein ? {} : { match: 1, mismatch: -([1, 4, 10][trial % 3] as number) }),
      };
      const quadratic = alignPair(a, b, options);
      if (quadratic.status !== 'ok') throw new Error('unexpected too-large');
      const scorer = buildScorer(protein ? 'protein' : 'dna', options);
      const rows = pairRows(scorer, encodeFor(scorer, a), encodeFor(scorer, b));
      for (const baseCells of [1, 16, 400]) {
        const path = alignHirschberg(
          { rows, n: a.length, m: b.length, go: scorer.openScore, ge: scorer.extendScore },
          baseCells,
        );
        if (!path) throw new Error('no path');
        expect(path.score).toBe(quadratic.alignment.score);
        const [rowA, rowB] = renderOps(path.ops, a, b, 0, 0);
        expect(scoreAlignedPair(scorer, rowA, rowB)).toBe(path.score);
        expect(degapped(rowA)).toBe(a);
        expect(degapped(rowB)).toBe(b);
      }
    }
  });

  it('returns the same alignment as the quadratic traceback when the optimum is unique', () => {
    const next = lcg(11);
    let compared = 0;
    for (let trial = 0; trial < 60; trial++) {
      const a = randomSeq(next, 60 + Math.floor(next() * 80), 'ACDEFGHIKLMNPQRSTVWY');
      const b = mutate(next, a, 'ACDEFGHIKLMNPQRSTVWY', 0.05, 0.02);
      const quadratic = alignPair(a, b, { alphabet: 'protein' });
      if (quadratic.status !== 'ok') throw new Error('unexpected too-large');
      const scorer = buildScorer('protein', {});
      const rows = pairRows(scorer, encodeFor(scorer, a), encodeFor(scorer, b));
      const path = alignHirschberg(
        { rows, n: a.length, m: b.length, go: scorer.openScore, ge: scorer.extendScore },
        64,
      );
      if (!path) throw new Error('no path');
      const [rowA, rowB] = renderOps(path.ops, a, b, 0, 0);
      if (rowA === quadratic.alignment.alignedA && rowB === quadratic.alignment.alignedB) compared++;
      else expect(path.score).toBe(quadratic.alignment.score);
    }
    expect(compared).toBeGreaterThan(40);
  });

  it('banded search ends with the true optimum for similar sequences of 3 kb', () => {
    const next = lcg(23);
    const a = randomSeq(next, 3000, 'ACGT');
    const b = mutate(next, a, 'ACGT', 0.01, 0.002);
    const banded = alignPair(a, b, { mode: 'global' });
    if (banded.status !== 'ok') throw new Error('unexpected too-large');
    expect(banded.alignment.method).toBe('banded-hirschberg');
    const scorer = buildScorer('dna', {});
    const rows = pairRows(scorer, encodeFor(scorer, a), encodeFor(scorer, b));
    const full = alignHirschberg({
      rows,
      n: a.length,
      m: b.length,
      go: scorer.openScore,
      ge: scorer.extendScore,
    });
    expect(banded.alignment.score).toBe(full?.score);
  });

  it('reports too-large instead of computing a lattice past the limit', () => {
    const outcome = alignGlobalLinear(
      { rows: { row: () => new Float64Array(0) }, n: 200_000, m: 200_000, go: -5, ge: -2 },
      2,
      1e5,
    );
    expect(outcome.status).toBe('too-large');
    const result = alignPair('ACGT'.repeat(3000), 'TGCA'.repeat(3000), { mode: 'local', maxCells: 1e6 });
    expect(result.status).toBe('too-large');
  });
});

function degapped(row: string): string {
  return row.replaceAll('-', '');
}

const variantRefs = variants.references as {
  name: string;
  alphabet: 'dna' | 'protein';
  reference: string;
  variant: string;
  edits: {
    kind: string;
    refStart: number;
    refEnd: number;
    altStart: number;
    altEnd: number;
    ref: string;
    alt: string;
  }[];
}[];

describe('difference list', () => {
  it.each(variantRefs.map((v) => [v.name, v] as const))(
    'recovers every seeded edit of %s with both coordinates',
    (_name, v) => {
      const result = alignPair(v.reference, v.variant, { alphabet: v.alphabet });
      if (result.status !== 'ok') throw new Error('too large');
      expect(result.alignment.differences).toEqual(v.edits.map((e) => ({ ...e, terminal: false })));
    },
  );

  it('uses 0-based half-open ranges: an insertion is empty on the reference, a deletion empty on the variant', () => {
    const diffs = findDifferences('ACGT--ACGT', 'ACGTGGAC-T');
    expect(diffs).toEqual([
      {
        kind: 'insertion',
        refStart: 4,
        refEnd: 4,
        altStart: 4,
        altEnd: 6,
        ref: '',
        alt: 'GG',
        terminal: false,
      },
      {
        kind: 'deletion',
        refStart: 6,
        refEnd: 7,
        altStart: 8,
        altEnd: 8,
        ref: 'G',
        alt: '',
        terminal: false,
      },
    ]);
  });

  it('flags overhangs of an overlap alignment as terminal and counts identity over the overlap only', () => {
    const reference = 'TTTTTTTTTTACGTACGGTCAGTCAGGATCCATTTTTTTTTT';
    const read = 'ACGTACGGTCAGTCAGGATCCA';
    const result = alignPair(reference, read, { mode: 'overlap' });
    if (result.status !== 'ok') throw new Error('too large');
    const { alignment } = result;
    expect(alignment.differences.every((d) => d.terminal)).toBe(true);
    expect(alignment.stats.percentIdentity).toBe(100);
    expect(alignment.startB).toBe(0);
    expect(alignment.endB).toBe(read.length);
  });
});

describe('alignment result', () => {
  it('classifies each column and reports identity, similarity and gaps', () => {
    const result = alignPair('MKVLAAGIV', 'MKILAA-IV', { alphabet: 'protein' });
    if (result.status !== 'ok') throw new Error('too large');
    const { alignment } = result;
    expect(alignment.alignedA).toBe('MKVLAAGIV');
    expect(alignment.alignedB).toBe('MKILAA-IV');
    expect([...alignment.classes]).toEqual([
      ColumnClass.Identical,
      ColumnClass.Identical,
      ColumnClass.Similar,
      ColumnClass.Identical,
      ColumnClass.Identical,
      ColumnClass.Identical,
      ColumnClass.Gap,
      ColumnClass.Identical,
      ColumnClass.Identical,
    ]);
    expect(alignment.stats).toMatchObject({
      length: 9,
      identical: 7,
      similar: 1,
      mismatches: 0,
      gapColumns: 1,
      gapRuns: 1,
    });
    expect(alignment.stats.percentIdentity).toBeCloseTo(77.78, 1);
    expect(alignment.stats.percentSimilarity).toBeCloseTo(88.89, 1);
  });

  it('returns an empty local alignment with score 0 for sequences that share nothing', () => {
    const result = alignPair('AAAA', 'TTTT', { mode: 'local' });
    if (result.status !== 'ok') throw new Error('too large');
    expect(result.alignment.score).toBe(0);
    expect(result.alignment.alignedA).toBe('');
  });

  it('treats RNA as DNA and lower case as upper case', () => {
    const result = alignPair('acguacgu', 'ACGTACGT');
    if (result.status !== 'ok') throw new Error('too large');
    expect(result.alignment.stats.percentIdentity).toBe(100);
  });
});

describe('multiple sequence alignment', () => {
  const next = lcg(99);
  const family = (n: number, letters: string, length: number) => {
    const root = randomSeq(next, length, letters);
    return Array.from({ length: n }, () => mutate(next, root, letters, 0.06, 0.01));
  };
  const alignedRows = (seqs: string[], options = {}) => {
    const result = alignMultiple(seqs, options);
    if (result.status !== 'ok') throw new Error('too large');
    return result.alignment;
  };

  it.each([
    ['DNA', 'ACGT'],
    ['protein', 'ACDEFGHIKLMNPQRSTVWY'],
  ])('keeps every %s sequence and gives the rows one length', (_name, letters) => {
    const seqs = family(7, letters, 150);
    const msa = alignedRows(seqs);
    expect(msa.rows.map(degapped)).toEqual(seqs);
    expect(new Set(msa.rows.map((r) => r.length))).toEqual(new Set([msa.length]));
    expect(msa.classes.length).toBe(msa.length);
  });

  it('adds no gaps when the sequences are identical', () => {
    const s = randomSeq(next, 200, 'ACGT');
    const msa = alignedRows([s, s, s, s]);
    expect(msa.rows).toEqual([s, s, s, s]);
    expect(msa.percentIdentity).toBe(100);
  });

  it('does not lower the score when a copy of a present sequence is added', () => {
    const seqs = family(5, 'ACDEFGHIKLMNPQRSTVWY', 120);
    const base = alignedRows(seqs);
    for (const k of [0, 2, 4]) {
      const more = alignedRows([...seqs, seqs[k] as string]);
      expect(more.score).toBeGreaterThanOrEqual(base.score);
    }
  });

  it('is deterministic', () => {
    const seqs = family(6, 'ACGT', 300);
    expect(alignedRows(seqs).rows).toEqual(alignedRows(seqs).rows);
  });

  it('gives the same result with the k-mer distance and the alignment distance on a close family', () => {
    const seqs = family(6, 'ACGT', 400);
    const viaKmer = alignedRows(seqs, { distance: 'kmer' });
    const viaAlignment = alignedRows(seqs, { distance: 'alignment' });
    expect(viaKmer.rows.map(degapped)).toEqual(seqs);
    expect(Math.abs(viaKmer.percentIdentity - viaAlignment.percentIdentity)).toBeLessThan(5);
  });

  it('writes a Newick guide tree over the input labels', () => {
    const msa = alignedRows(family(4, 'ACGT', 100));
    const newick = toNewick(msa.guideTree, ['a', 'b', 'c', 'd']);
    expect(newick).toMatch(/^\(.*\);$/);
    for (const label of ['a', 'b', 'c', 'd']) expect(newick).toContain(`${label}:`);
  });

  it('lists differences of each sequence against the first', () => {
    const msa = alignedRows(['ACGTACGTACGTACGTACGT', 'ACGTACGTTCGTACGTACGT', 'ACGTACGTACGTACGTACGT']);
    const diffs = msaDifferences(msa);
    expect(diffs[0]?.differences).toMatchObject([
      { kind: 'substitution', refStart: 8, altStart: 8, ref: 'A', alt: 'T' },
    ]);
    expect(diffs[1]?.differences).toEqual([]);
  });

  describe('globins from UniProt', () => {
    const entries = globinFasta
      .split('>')
      .slice(1)
      .map((block) => {
        const [header, ...rest] = block.split('\n');
        return [(header as string).split(' ')[0] as string, rest.join('')] as const;
      });
    const msa = alignedRows(entries.map((e) => e[1]));
    const identityOf = (x: string, y: string) => {
      const [a, b] = dropSharedGaps(
        msa.rows[entries.findIndex((e) => e[0] === x)] as string,
        msa.rows[entries.findIndex((e) => e[0] === y)] as string,
      );
      let same = 0;
      for (let c = 0; c < a.length; c++) if (a[c] === b[c]) same++;
      return (100 * same) / a.length;
    };

    it('puts human alpha and beta globin near the 43% that the literature reports, and the species pairs far higher', () => {
      expect(identityOf('HBA_HUMAN', 'HBB_HUMAN')).toBeGreaterThan(38);
      expect(identityOf('HBA_HUMAN', 'HBB_HUMAN')).toBeLessThan(50);
      expect(identityOf('HBA_HUMAN', 'HBA_HORSE')).toBeGreaterThan(85);
      expect(identityOf('MYG_HUMAN', 'MYG_PHYMC')).toBeGreaterThan(80);
    });

    it('agrees with Biopython pairwise identity on the well-conserved pairs', () => {
      const identity = golden.globins.identity as Record<string, { identities: number; length: number }>;
      for (const key of [
        'HBA_HUMAN|HBB_HUMAN',
        'HBA_HUMAN|HBA_HORSE',
        'HBB_HUMAN|HBB_HORSE',
        'MYG_HUMAN|MYG_PHYMC',
      ]) {
        const [x, y] = key.split('|') as [string, string];
        const reference = identity[key] as { identities: number; length: number };
        expect(Math.abs(identityOf(x, y) - (100 * reference.identities) / reference.length)).toBeLessThan(2);
      }
    });

    it('conserves the heme-binding histidines in the alpha and beta chains', () => {
      const alpha = msa.rows[entries.findIndex((e) => e[0] === 'HBA_HUMAN')] as string;
      const horse = msa.rows[entries.findIndex((e) => e[0] === 'HBA_HORSE')] as string;
      const proximal = alpha.replaceAll('-', '').indexOf('HAGEY');
      expect(proximal).toBeGreaterThan(0);
      expect(degapped(horse)).toContain('HAGEY');
    });
  });

  it('builds a consensus with a configurable identity threshold', () => {
    const rows = ['ACGTA', 'ACGTA', 'ACCTA', 'A-GTT'];
    expect(consensus(rows, 'dna', { threshold: 0.5 })).toBe('ACGTA');
    expect(consensus(rows, 'dna', { threshold: 0.8 })).toBe('ANNTN');
    expect(consensus(['AC-T', 'AC-T', 'AC-T'], 'dna')).toBe('ACT');
    expect(consensus(['AC-T', 'AC-T', 'AC-T'], 'dna', { keepGapColumns: true })).toBe('AC-T');
    expect(consensus(['MK', 'MR'], 'protein', { threshold: 0.9 })).toBe('MX');
  });

  it('classifies MSA columns and reports conservation', () => {
    const msa = alignedRows(['ACGT', 'ACGT', 'ACTT']);
    expect(msa.classes[0]).toBe(ColumnClass.Identical);
    expect(msa.classes[2]).toBe(ColumnClass.Mismatch);
    expect(msa.conservation[2]).toBeCloseTo(2 / 3);
  });

  it('returns too-large when one merge would exceed the limit', () => {
    const result = alignMultiple([randomSeq(next, 500, 'ACGT'), randomSeq(next, 500, 'ACGT')], {
      maxCells: 1000,
    });
    expect(result.status).toBe('too-large');
  });
});

describe('performance', { timeout: 60_000 }, () => {
  it('global: two 100 kb sequences that differ by a few per mille align in linear space', () => {
    const next = lcg(1);
    const a = randomSeq(next, 100_000, 'ACGT');
    const b = mutate(next, a, 'ACGT', 0.002, 0.0002);
    const result = alignPair(a, b, { mode: 'global' });
    if (result.status !== 'ok') throw new Error('too large');
    expect(result.alignment.method).toBe('banded-hirschberg');
    expect(degapped(result.alignment.alignedA)).toBe(a);
    expect(degapped(result.alignment.alignedB)).toBe(b);
    const scorer = buildScorer('dna', {});
    expect(scoreAlignedPair(scorer, result.alignment.alignedA, result.alignment.alignedB)).toBe(
      result.alignment.score,
    );
  });

  it('global: two unrelated 8 kb sequences use the full lattice in linear space', () => {
    const next = lcg(2);
    const result = alignPair(randomSeq(next, 8000, 'ACGT'), randomSeq(next, 8000, 'ACGT'), {
      mode: 'global',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.alignment.method).toBe('hirschberg');
  });

  it('local: a 6 kb by 6 kb pair finishes and a pair past the limit returns too-large at once', () => {
    const next = lcg(3);
    const shared = randomSeq(next, 800, 'ACGT');
    const a = randomSeq(next, 2600, 'ACGT') + shared + randomSeq(next, 2600, 'ACGT');
    const b =
      randomSeq(next, 2600, 'ACGT') +
      mutate(next, shared, 'ACGT', 0.02, 0.002) +
      randomSeq(next, 2600, 'ACGT');
    const result = alignPair(a, b, { mode: 'local' });
    if (result.status !== 'ok') throw new Error('too large');
    expect(result.alignment.endA - result.alignment.startA).toBeGreaterThan(700);
    const big = alignPair('A'.repeat(20_000), 'A'.repeat(20_000), { mode: 'local' });
    expect(big.status).toBe('too-large');
  });

  it('overlap: a 2 kb read against a 40 kb reference', () => {
    const next = lcg(4);
    const reference = randomSeq(next, 40_000, 'ACGT');
    const read = mutate(next, reference.slice(20_000, 22_000), 'ACGT', 0.01, 0.001);
    const result = alignPair(reference, read, { mode: 'overlap' });
    if (result.status !== 'ok') throw new Error('too large');
    expect(result.alignment.stats.percentIdentity).toBeGreaterThan(95);
    expect([result.alignment.startB, result.alignment.endB]).toEqual([0, read.length]);
  });

  it('MSA: 50 sequences of 2 kb align in a few seconds', () => {
    const next = lcg(5);
    const root = randomSeq(next, 2000, 'ACGT');
    const seqs = Array.from({ length: 50 }, () => mutate(next, root, 'ACGT', 0.03, 0.004));
    const started = performance.now();
    const result = alignMultiple(seqs);
    const seconds = (performance.now() - started) / 1000;
    if (result.status !== 'ok') throw new Error('too large');
    expect(result.alignment.rows.map(degapped)).toEqual(seqs);
    expect(seconds).toBeLessThan(20);
  });
});

describe('degenerate input', () => {
  it('aligns an empty sequence as one gap in every mode', () => {
    for (const mode of ['global', 'local', 'overlap'] as const) {
      const result = alignPair('', 'ACGT', { mode });
      if (result.status !== 'ok') throw new Error('too large');
      expect(degapped(result.alignment.alignedB)).toBe(mode === 'local' ? '' : 'ACGT');
    }
    const global = alignPair('', 'ACGT');
    if (global.status !== 'ok') throw new Error('too large');
    expect(global.alignment.score).toBe(-(5 + 2 * 3));
  });

  it('aligns one sequence to itself and two sequences as a pair', () => {
    const one = alignMultiple(['ACGT']);
    if (one.status !== 'ok') throw new Error('too large');
    expect(one.alignment.rows).toEqual(['ACGT']);
    const two = alignMultiple(['ACGTACGT', 'ACGACGT']);
    if (two.status !== 'ok') throw new Error('too large');
    expect(two.alignment.rows.map(degapped)).toEqual(['ACGTACGT', 'ACGACGT']);
  });
});
