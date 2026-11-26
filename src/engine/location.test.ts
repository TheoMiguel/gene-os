import { loadCoreGoldens } from '../../tests/oracle/core-goldens';
import {
  circularLocation,
  extractLocation,
  formatLocation,
  fromDisplayRange,
  isSplit,
  linearLocation,
  locationBounds,
  locationContains,
  locationLength,
  regionStart,
  sliceCircular,
  spanLength,
  toDisplayRange,
} from './location';

const goldens = loadCoreGoldens();

describe('circularLocation', () => {
  it('keeps a region inside the sequence as one segment', () => {
    expect(circularLocation(10, 5, 100, 1)).toEqual({ segments: [{ start: 10, end: 15 }], strand: 1 });
  });

  it('splits a region that crosses the origin, 5 prime segment first on strand 1', () => {
    expect(circularLocation(95, 10, 100, 1).segments).toEqual([
      { start: 95, end: 100 },
      { start: 0, end: 5 },
    ]);
  });

  it('lists the segments of a strand -1 region from its 5 prime end, which is the origin side', () => {
    expect(circularLocation(95, 10, 100, -1).segments).toEqual([
      { start: 0, end: 5 },
      { start: 95, end: 100 },
    ]);
  });

  it('takes the start modulo the length and accepts a full-circle region', () => {
    expect(circularLocation(-5, 10, 100, 1).segments).toEqual([
      { start: 95, end: 100 },
      { start: 0, end: 5 },
    ]);
    expect(locationLength(circularLocation(40, 100, 100, 1))).toBe(100);
  });

  it('rejects a length outside 1..sequence length', () => {
    expect(() => circularLocation(0, 0, 10, 1)).toThrow(RangeError);
    expect(() => circularLocation(0, 11, 10, 1)).toThrow(RangeError);
  });

  it('round-trips the region start', () => {
    for (const strand of [1, -1] as const) {
      for (const start of [0, 3, 95, 99]) {
        expect(regionStart(circularLocation(start, 10, 100, strand))).toBe(start);
      }
    }
  });
});

describe('extractLocation (Biopython SeqFeature.extract)', () => {
  it('matches Biopython for random plain and origin-crossing locations on both strands', () => {
    for (const c of goldens.location) {
      const location = circularLocation(c.start, c.length, c.seq.length, c.strand);
      expect(location.segments.map((s) => [s.start, s.end])).toEqual(c.segments);
      expect(extractLocation(c.seq, location)).toBe(c.extracted);
    }
  });
});

describe('location helpers', () => {
  const split = circularLocation(95, 10, 100, 1);

  it('measures lengths and bounds', () => {
    expect(spanLength({ start: 3, end: 10 })).toBe(7);
    expect(locationLength(split)).toBe(10);
    expect(locationBounds(split)).toEqual({ start: 0, end: 100 });
    expect(isSplit(split)).toBe(true);
    expect(isSplit(linearLocation(1, 2, 1))).toBe(false);
  });

  it('tests which positions a location contains', () => {
    expect(locationContains(split, 97)).toBe(true);
    expect(locationContains(split, 3)).toBe(true);
    expect(locationContains(split, 5)).toBe(false);
    expect(locationContains(split, 94)).toBe(false);
  });

  it('slices a circular sequence across the origin', () => {
    expect(sliceCircular('ABCDEFGH', 6, 4)).toBe('GHAB');
    expect(sliceCircular('ABCDEFGH', -2, 3)).toBe('GHA');
    expect(sliceCircular('ABCDEFGH', 1, 3)).toBe('BCD');
  });

  it('converts between 0-based half-open and 1-based inclusive ranges', () => {
    expect(toDisplayRange({ start: 0, end: 6 })).toEqual({ from: 1, to: 6 });
    expect(fromDisplayRange({ from: 10, to: 20 })).toEqual({ start: 9, end: 20 });
  });

  it('writes GenBank-style location text in 1-based positions', () => {
    expect(formatLocation(linearLocation(9, 20, 1))).toBe('10..20');
    expect(formatLocation(linearLocation(9, 10, 1))).toBe('10');
    expect(formatLocation(split)).toBe('join(96..100,1..5)');
    expect(formatLocation(circularLocation(95, 10, 100, -1))).toBe('complement(join(96..100,1..5))');
  });
});
