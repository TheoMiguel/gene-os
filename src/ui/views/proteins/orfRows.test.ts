import { proteinWeight } from '../../../engine/composition';
import { findOrfs } from '../../../engine/orf';
import { gravy, isoelectricPoint } from '../../../engine/protein';
import { frameLabel, orfKey, orfRows, orfSpan } from './orfRows';
import { DEFAULT_ORF_SETTINGS, resolveSelectedOrf, scanParams } from './orfSession';

const cds = (codons: number) => `ATG${'GCT'.repeat(codons - 1)}TAA`;

describe('ORF rows', () => {
  it('number ORFs by position and show 1-based coordinates with the protein properties', () => {
    const seq = `CC${cds(12)}GG`;
    const rows = orfRows(findOrfs(seq, { minCodons: 10, frames: [1, 2, 3] }), seq.length);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.id).toBe('ORF1');
    expect(row?.start).toBe(3);
    expect(row?.end).toBe(2 + cds(12).length);
    expect(row?.lengthAa).toBe(12);
    expect(row?.weight).toBeCloseTo(proteinWeight(row?.orf.protein ?? ''), 9);
    expect(row?.pI).toBeCloseTo(isoelectricPoint(row?.orf.protein ?? ''), 9);
    expect(row?.gravy).toBeCloseTo(gravy(row?.orf.protein ?? ''), 9);
    expect(frameLabel(-2)).toBe('-2');
    expect(frameLabel(3)).toBe('+3');
  });

  it('shows an ORF that crosses the origin of a circular sequence with its end before its start', () => {
    const body = cds(12);
    const seq = body.slice(20) + body.slice(0, 20);
    const orfs = findOrfs(seq, { minCodons: 10, frames: [1, 2, 3], circular: true });
    const rows = orfRows(orfs, seq.length);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.start).toBe(seq.length - 20 + 1);
    expect(row?.end).toBe(body.length - 20);
    expect((row?.end ?? 0) < (row?.start ?? 0)).toBe(true);
    const span = orfSpan(orfs[0] as (typeof orfs)[number]);
    expect(span.strand).toBe(1);
    expect(span.start).toBe(seq.length - 20);
    expect(span.end).toBe(seq.length);
  });
});

describe('ORF selection', () => {
  const seq = `${cds(12)}AAAA${cds(15)}`;
  const orfs = findOrfs(seq, { minCodons: 10, frames: [1, 2, 3] });

  it('follows the shared selection when it covers an ORF exactly, else the picked one', () => {
    expect(orfs).toHaveLength(2);
    const [first, second] = orfs as [(typeof orfs)[number], (typeof orfs)[number]];
    const span = orfSpan(second);
    expect(resolveSelectedOrf(orfs, orfKey(first), span)).toBe(second);
    expect(resolveSelectedOrf(orfs, orfKey(first), null)).toBe(first);
    expect(resolveSelectedOrf(orfs, orfKey(first), { start: 1, end: 5, strand: 1 })).toBe(first);
    expect(resolveSelectedOrf(orfs, null, null)).toBeNull();
  });

  it('keys an ORF by frame, first base and length, which survives a rescan', () => {
    const again = findOrfs(seq, { minCodons: 10, frames: [1, 2, 3] });
    expect(again.map(orfKey)).toEqual(orfs.map(orfKey));
  });
});

describe('scan parameters', () => {
  it('leave out what is default, so equal searches share one scan', () => {
    expect(scanParams(DEFAULT_ORF_SETTINGS)).toEqual({ minCodons: 100, startCodons: 'atg', table: 1 });
    expect(
      scanParams({ ...DEFAULT_ORF_SETTINGS, frames: [1, -1], longestOnly: false, openEnded: true }),
    ).toEqual({
      minCodons: 100,
      startCodons: 'atg',
      table: 1,
      frames: [1, -1],
      longestOnly: false,
      openEnded: true,
    });
  });
});
