import { loadCoreGoldens, randomDna } from '../../tests/oracle/core-goldens';
import { reverseComplement } from './alphabet';
import { locationLength } from './location';
import { searchSequence } from './search';

const goldens = loadCoreGoldens().search;

const starts = (hits: { start: number; strand: 1 | -1 }[], strand: 1 | -1) =>
  hits.filter((h) => h.strand === strand).map((h) => h.start);

describe('IUPAC motif search (Bio.SeqUtils.nt_search, forward and reverse-complement pattern)', () => {
  it('matches Biopython on both strands, linear and circular', () => {
    expect(goldens.motif.length).toBeGreaterThan(100);
    for (const c of goldens.motif) {
      const result = searchSequence(c.seq, c.pattern, { mode: 'motif', circular: c.circular });
      expect(starts(result.hits, 1)).toEqual(c.forward);
      expect(starts(result.hits, -1).sort((a, b) => a - b)).toEqual([...c.reverse].sort((a, b) => a - b));
      expect(result.total).toBe(c.forward.length + c.reverse.length);
    }
  });

  it('reports a palindromic site once, on strand 1', () => {
    const result = searchSequence('AAGAATTCAA', 'GAATTC', { mode: 'motif' });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ start: 2, length: 6, strand: 1 });
  });

  it('searches the top strand only when asked', () => {
    const seq = `AAAC${reverseComplement('GGTCTC')}TT`;
    expect(searchSequence(seq, 'GGTCTC', { mode: 'motif' }).hits[0]).toMatchObject({ strand: -1, start: 4 });
    expect(searchSequence(seq, 'GGTCTC', { mode: 'motif', bothStrands: false }).hits).toHaveLength(0);
  });

  it('rejects letters that are not IUPAC codes', () => {
    expect(() => searchSequence('ACGT', 'AQT', { mode: 'motif' })).toThrow(RangeError);
  });
});

describe('text search', () => {
  it('finds overlapping matches case-insensitively and ignores whitespace in the query', () => {
    const result = searchSequence('aaaa', 'AA', { mode: 'text', bothStrands: false });
    expect(result.hits.map((h) => h.start)).toEqual([0, 1, 2]);
    expect(searchSequence('GGATCC', 'gga tcc').hits).toHaveLength(1);
  });

  it('gives a match across the origin two segments in feature order', () => {
    const result = searchSequence('CCATGGGGGG', 'GGCC', { circular: true });
    const [hit] = result.hits;
    expect(hit).toMatchObject({ start: 8, length: 4, strand: 1 });
    expect(hit?.location.segments).toEqual([
      { start: 8, end: 10 },
      { start: 0, end: 2 },
    ]);
  });

  it('does not find a wrapped match on a linear sequence', () => {
    expect(searchSequence('CCATGGGGGG', 'GGCC', { bothStrands: false }).hits).toHaveLength(0);
  });

  it('returns nothing for an empty query or a query longer than the sequence', () => {
    expect(searchSequence('ACGT', '').total).toBe(0);
    expect(searchSequence('ACGT', 'ACGTACGT').total).toBe(0);
  });

  it('finds the bottom-strand match of a text query with its top-strand span', () => {
    const [hit, ...rest] = searchSequence('AAAGAGACCTT', 'GGTCTC').hits;
    expect(rest).toHaveLength(0);
    expect(hit).toMatchObject({ strand: -1, start: 3, length: 6 });
    expect(hit?.location).toEqual({ segments: [{ start: 3, end: 9 }], strand: -1 });
  });
});

describe('regex search', () => {
  it('matches Python re on random DNA, with the same non-overlapping spans', () => {
    for (const c of goldens.regex) {
      const result = searchSequence(c.seq, c.regex, { mode: 'regex', bothStrands: false });
      expect(result.hits.map((h) => [h.start, h.length])).toEqual(c.matches);
    }
  });

  it('also searches the bottom strand and maps the span to the top strand', () => {
    const seq = `AAAA${reverseComplement('GGTTTCC')}AAAA`;
    const hit = searchSequence(seq, 'GG+T+CC', { mode: 'regex' }).hits.find((h) => h.strand === -1);
    expect(hit).toMatchObject({ start: 4, length: 7 });
  });

  it('finds matches that cross the origin on a circular sequence', () => {
    const result = searchSequence('TTGAAAAACC', 'CCTT', {
      mode: 'regex',
      circular: true,
      bothStrands: false,
    });
    expect(result.hits[0]).toMatchObject({ start: 8, length: 4 });
    expect(result.hits[0] ? locationLength(result.hits[0].location) : 0).toBe(4);
  });

  it('survives a zero-length pattern and rejects an invalid expression', () => {
    expect(searchSequence('ACGT', 'A*', { mode: 'regex', bothStrands: false }).hits).toHaveLength(1);
    expect(() => searchSequence('ACGT', '(', { mode: 'regex' })).toThrow(SyntaxError);
  });
});

describe('protein search', () => {
  it('matches Python re on protein motifs with X, [..] and {..}', () => {
    for (const c of goldens.protein) {
      const result = searchSequence(c.seq, c.motif, { mode: 'motif', alphabet: 'protein' });
      expect(result.hits.map((h) => h.start)).toEqual(c.starts);
      for (const hit of result.hits) expect(hit).toMatchObject({ length: c.length, strand: 1 });
    }
  });

  it('searches text on the given strand only and rejects a broken motif', () => {
    expect(searchSequence('MKKAKKM', 'KK', { alphabet: 'protein' }).hits.map((h) => h.start)).toEqual([1, 4]);
    expect(() => searchSequence('MKV', '[KV', { mode: 'motif', alphabet: 'protein' })).toThrow(RangeError);
  });
});

describe('result cap and performance', () => {
  const seq = randomDna(5_000_000, 17);

  it('caps hits but reports the true total for a pattern that matches everywhere', () => {
    const started = performance.now();
    const text = searchSequence(seq, 'A', { maxHits: 100 });
    const motif = searchSequence(seq, 'NNNN', { mode: 'motif', maxHits: 100, circular: true });
    const regex = searchSequence(seq, '[ACGT]', { mode: 'regex', maxHits: 100 });
    const elapsed = performance.now() - started;
    expect(text.hits).toHaveLength(100);
    expect(text.truncated).toBe(true);
    expect(text.total).toBeGreaterThan(2_000_000);
    expect(motif.total).toBe(5_000_000);
    expect(regex.total).toBe(2 * 5_000_000);
    expect(elapsed).toBeLessThan(15000);
  });

  it('finds a long exact motif and its reverse complement in 5 Mb', () => {
    const site = 'GGTCTCAGCTTACCGGA';
    const planted = `${seq.slice(0, 1_000_000)}${site}${seq.slice(1_000_017, 3_000_000)}${reverseComplement(site)}${seq.slice(3_000_017)}`;
    const result = searchSequence(planted, site, { mode: 'motif' });
    expect(result.hits.filter((h) => h.start === 1_000_000 && h.strand === 1)).toHaveLength(1);
    expect(result.hits.filter((h) => h.start === 3_000_000 && h.strand === -1)).toHaveLength(1);
  });
});
