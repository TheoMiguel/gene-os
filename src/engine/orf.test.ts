import { loadCoreGoldens, randomDna } from '../../tests/oracle/core-goldens';
import { reverseComplement } from './alphabet';
import { locationLength, regionStart } from './location';
import { findOrfs, type Orf } from './orf';

const goldens = loadCoreGoldens().orf;

function summarize(orfs: Orf[]) {
  return orfs
    .map((o) => ({
      strand: o.location.strand,
      frame: o.frame,
      start: regionStart(o.location),
      length: locationLength(o.location),
      aa: o.lengthAa,
      protein: o.protein,
      startCodon: o.startCodon,
      stopCodon: o.stopCodon,
    }))
    .sort((a, b) => a.start - b.start || b.strand - a.strand || a.length - b.length);
}

describe('ORF scan against an independent per-start scan (proteins from Biopython translate cds=True)', () => {
  it('has golden cases for linear and circular sequences and both reporting modes', () => {
    expect(goldens.some((c) => c.circular)).toBe(true);
    expect(goldens.some((c) => !c.circular)).toBe(true);
    expect(goldens.some((c) => c.allStarts)).toBe(true);
    expect(goldens.reduce((sum, c) => sum + c.orfs.length, 0)).toBeGreaterThan(50);
  });

  it.each(goldens.map((c, i) => [i, c] as const))('golden case %i', (_i, c) => {
    const orfs = findOrfs(c.seq, {
      minCodons: c.minCodons,
      table: c.table,
      startCodons: c.starts,
      circular: c.circular,
      longestOnly: !c.allStarts,
    });
    expect(summarize(orfs)).toEqual(c.orfs.map((e) => ({ ...e, strand: e.strand })));
  });
});

describe('ORF behavior', () => {
  const orf = `ATG${'GCT'.repeat(5)}TAA`;
  const flank = 'CCCCCCCCCCCC';

  it('finds a forward ORF with location, frame, protein and codons', () => {
    const [found, ...rest] = findOrfs(flank + orf + flank, { minCodons: 3 });
    expect(rest).toHaveLength(0);
    expect(found).toMatchObject({
      frame: 1,
      lengthAa: 6,
      protein: 'MAAAAA',
      startCodon: 'ATG',
      stopCodon: 'TAA',
      location: { strand: 1, segments: [{ start: 12, end: 12 + orf.length }] },
    });
  });

  it('finds the same ORF on the reverse strand and gives the top-strand span', () => {
    const seq = flank + reverseComplement(orf) + flank;
    const [found] = findOrfs(seq, { minCodons: 3 });
    expect(found).toMatchObject({
      frame: -1,
      protein: 'MAAAAA',
      location: { strand: -1, segments: [{ start: 12, end: 12 + orf.length }] },
    });
  });

  it('numbers frames by the first base position modulo 3', () => {
    expect(findOrfs(`C${orf}`, { minCodons: 3 })[0]?.frame).toBe(2);
    expect(findOrfs(`CC${orf}`, { minCodons: 3 })[0]?.frame).toBe(3);
    expect(findOrfs(`${orf}CC`, { minCodons: 3 })[0]?.frame).toBe(1);
  });

  it('honours the minimum length and the frame filter', () => {
    expect(findOrfs(orf, { minCodons: 7 })).toHaveLength(0);
    expect(findOrfs(orf, { minCodons: 6 })).toHaveLength(1);
    expect(findOrfs(orf, { minCodons: 3, frames: [2, 3, -1] })).toHaveLength(0);
    expect(findOrfs(orf, { minCodons: 3, frames: [1] })).toHaveLength(1);
  });

  it('reports the longest ORF per stop, or one ORF per start', () => {
    const nested = `ATGGCTATGGCTTAA`;
    expect(findOrfs(nested, { minCodons: 1 }).map((o) => o.lengthAa)).toEqual([4]);
    expect(findOrfs(nested, { minCodons: 1, longestOnly: false }).map((o) => o.lengthAa)).toEqual([4, 2]);
  });

  it('uses alternative start codons from the set or the genetic code, and writes M for the first residue', () => {
    const seq = `GTGGCTGCTTAA`;
    expect(findOrfs(seq, { minCodons: 1 })).toHaveLength(0);
    expect(findOrfs(seq, { minCodons: 1, startCodons: 'atg-gtg-ttg' })[0]).toMatchObject({
      protein: 'MAA',
      startCodon: 'GTG',
    });
    expect(findOrfs(seq, { minCodons: 1, startCodons: 'table', table: 11 })).toHaveLength(1);
    expect(findOrfs(seq, { minCodons: 1, startCodons: 'table', table: 1 })).toHaveLength(0);
    expect(findOrfs(seq, { minCodons: 1, startCodons: ['gtg'] })).toHaveLength(1);
    expect(() => findOrfs(seq, { startCodons: ['AT'] })).toThrow(RangeError);
  });

  it('stops at the stop codons of the chosen genetic code', () => {
    const seq = 'ATGGCTTGAGCTTAA';
    expect(findOrfs(seq, { minCodons: 1 })[0]?.protein).toBe('MA');
    expect(findOrfs(seq, { minCodons: 1, table: 4 })[0]?.protein).toBe('MAWA');
  });

  it('reports open-ended ORFs only on request', () => {
    const seq = 'CCATGGCTGCT';
    expect(findOrfs(seq, { minCodons: 2 })).toHaveLength(0);
    const [open] = findOrfs(seq, { minCodons: 2, openEnded: true });
    expect(open).toMatchObject({ protein: 'MAA', stopCodon: null, lengthAa: 3 });
  });

  it('finds an ORF across the origin of a circular sequence as two segments', () => {
    const rotated = `${orf.slice(15)}GGGGGGGGGGGG${orf.slice(0, 15)}`;
    expect(findOrfs(rotated, { minCodons: 3 })).toHaveLength(0);
    const [wrapped] = findOrfs(rotated, { minCodons: 3, circular: true });
    expect(wrapped?.protein).toBe('MAAAAA');
    expect(wrapped?.location.segments).toHaveLength(2);
    expect(locationLength(wrapped?.location ?? { segments: [], strand: 1 })).toBe(orf.length);
  });

  it('never reports an ORF longer than the circle', () => {
    expect(findOrfs('ATGGCT'.repeat(10), { minCodons: 1, circular: true })).toHaveLength(0);
  });

  it('handles empty and tiny sequences', () => {
    expect(findOrfs('', { minCodons: 1 })).toEqual([]);
    expect(findOrfs('AT', { minCodons: 1, circular: true })).toEqual([]);
  });
});

describe('performance', () => {
  it('scans 5 Mb on both strands, linear and circular, in a few seconds', () => {
    const seq = randomDna(5_000_000, 13);
    const started = performance.now();
    const linear = findOrfs(seq, { minCodons: 60 });
    const circular = findOrfs(seq, { minCodons: 60, circular: true });
    const elapsed = performance.now() - started;
    expect(linear.length).toBeGreaterThan(0);
    expect(circular.length).toBeGreaterThanOrEqual(linear.length);
    expect(elapsed).toBeLessThan(8000);
  });
});
