import { PUC19, randomDna } from '../../../../tests/fixtures/restriction/fixtures';
import type { DetectedFeature } from '../../../engine/features';
import type { Orf } from '../../../engine/orf';
import type { OrganismInference } from '../../../engine/organism';
import type { SeqRecord } from '../../../engine/types';
import {
  clampWindow,
  compositionRows,
  defaultHydropathyWindow,
  defaultWindow,
  endsOverlap,
  featureRows,
  featureTypeCounts,
  formatMass,
  formatPercent,
  longestOrfs,
  minOrfCodons,
  OTHER_LETTER,
  readTopology,
  roughSize,
  statesTopology,
  stripSegments,
  windowStep,
} from './model';

const record = (patch: Partial<SeqRecord> = {}): SeqRecord => ({
  id: 'r',
  name: 'r',
  description: '',
  alphabet: 'dna',
  topology: 'linear',
  seq: randomDna(500, 1),
  features: [],
  metadata: { sourceFormat: 'fasta' },
  ...patch,
});

const inference = (category: OrganismInference['category']): OrganismInference => ({
  category,
  confidence: 0.9,
  evidence: [],
  metrics: { length: 500, vectorParts: [] },
});

describe('window sizes', () => {
  it('derives about 1% of the length, snapped to 1, 2 or 5 times a power of ten', () => {
    expect(defaultWindow(20)).toBe(10);
    expect(defaultWindow(2686)).toBe(20);
    expect(defaultWindow(5386)).toBe(50);
    expect(defaultWindow(50_000)).toBe(500);
    expect(defaultWindow(5_000_000)).toBe(50_000);
  });

  it('never exceeds the sequence and is 0 for an empty one', () => {
    expect(defaultWindow(4)).toBe(4);
    expect(defaultWindow(0)).toBe(0);
  });

  it('steps by a tenth of the window, at least one base', () => {
    expect(windowStep(50_000)).toBe(5_000);
    expect(windowStep(10)).toBe(1);
    expect(windowStep(3)).toBe(1);
  });

  it('keeps a typed window inside 2..length and falls back to the default for garbage', () => {
    expect(clampWindow(1, 500)).toBe(2);
    expect(clampWindow(9_999, 500)).toBe(500);
    expect(clampWindow(33.6, 500)).toBe(34);
    expect(clampWindow(Number.NaN, 500)).toBe(defaultWindow(500));
    expect(clampWindow(5, 1)).toBe(1);
  });

  it('uses 9 residues for hydropathy, or the whole of a shorter protein', () => {
    expect(defaultHydropathyWindow(300)).toBe(9);
    expect(defaultHydropathyWindow(5)).toBe(5);
  });
});

describe('number formatting', () => {
  it('picks Da, kDa or MDa so the number stays readable', () => {
    expect(formatMass(512.3, 'en')).toBe('512.3 Da');
    expect(formatMass(831_420, 'en')).toBe('831.42 kDa');
    expect(formatMass(3_300_000, 'en')).toBe('3.30 MDa');
  });

  it('groups digits and decimals by the interface language', () => {
    expect(formatPercent(0.5269, 'en')).toBe('52.7%');
    expect(formatPercent(0.5269, 'es')).toBe('52,7%');
  });

  it('gives a rough size only for a long sequence', () => {
    expect(roughSize(999, 'en')).toBeNull();
    expect(roughSize(2686, 'en')).toBe('2.69 kb');
    expect(roughSize(4_641_652, 'en')).toBe('4.64 Mb');
  });
});

describe('composition', () => {
  it('lists the four bases and one row for ambiguity codes when there are some', () => {
    const rows = compositionRows({ A: 5, C: 3, G: 1, T: 0, N: 1 }, 'dna', 10);
    expect(rows.map((r) => [r.letter, r.count])).toEqual([
      ['A', 5],
      ['C', 3],
      ['G', 1],
      ['T', 0],
      [OTHER_LETTER, 1],
    ]);
    expect(rows.reduce((sum, r) => sum + r.fraction, 0)).toBeCloseTo(1, 12);
  });

  it('uses U for RNA, adds no other row for clean input, and lists 20 residues for a protein', () => {
    expect(compositionRows({ A: 1, U: 1 }, 'rna', 2).map((r) => r.letter)).toEqual(['A', 'C', 'G', 'U']);
    expect(compositionRows({ A: 1, C: 1, G: 1, T: 1 }, 'dna', 4)).toHaveLength(4);
    const protein = compositionRows({ M: 1, K: 2, '*': 1 }, 'protein', 4);
    expect(protein).toHaveLength(21);
    expect(protein.find((r) => r.letter === 'K')?.name).toBe('Lys');
  });

  it('survives an empty sequence', () => {
    expect(compositionRows({}, 'dna', 0).every((r) => r.fraction === 0)).toBe(true);
  });

  it('lays the strip out left to right with offsets that add up', () => {
    const rows = compositionRows({ A: 1, C: 1, G: 1, T: 1 }, 'dna', 4);
    const segments = stripSegments(rows);
    expect(segments.map((s) => s.offset)).toEqual([0, 0.25, 0.5, 0.75]);
  });
});

describe('topology', () => {
  it('trusts a file that states it', () => {
    const genbank = record({ topology: 'circular', metadata: { sourceFormat: 'genbank' } });
    expect(statesTopology(genbank)).toBe(true);
    expect(readTopology(genbank, false, 'pending')).toEqual({ topology: 'circular', basis: 'stated' });
    expect(statesTopology(record())).toBe(false);
    expect(statesTopology(record({ metadata: {} }))).toBe(false);
  });

  it('finds overlapping ends of at least 20 bases, and none in a random or short sequence', () => {
    const body = randomDna(400, 7);
    expect(endsOverlap(body + body.slice(0, 40))).toBe(40);
    expect(endsOverlap(randomDna(400, 3))).toBe(0);
    expect(endsOverlap('ACGT'.repeat(10))).toBe(0);
  });

  it('infers circular from overlapping ends before the organism scan finishes', () => {
    const body = randomDna(400, 7);
    const seq = body + body.slice(0, 30);
    expect(readTopology(record({ seq }), false, 'pending')).toEqual({
      topology: 'circular',
      basis: 'overlap',
    });
  });

  it('waits for the organism scan when nothing else decides, then follows its vector call', () => {
    expect(readTopology(record(), false, 'pending').basis).toBe('pending');
    expect(readTopology(record(), false, inference('synthetic-vector'))).toEqual({
      topology: 'circular',
      basis: 'vector',
    });
    expect(readTopology(record(), false, inference('eukaryote'))).toEqual({
      topology: 'linear',
      basis: 'assumed',
    });
    expect(readTopology(record(), false, 'failed').basis).toBe('unavailable');
  });

  it('lets the user override everything but a file that states it', () => {
    const chosen = record({ topology: 'linear' });
    expect(readTopology(chosen, true, inference('synthetic-vector'))).toEqual({
      topology: 'linear',
      basis: 'chosen',
    });
  });

  it('finds no overlapping ends in pUC19, so only its vector parts can call it circular', () => {
    expect(endsOverlap(PUC19)).toBe(0);
  });
});

describe('ORFs and features', () => {
  const orf = (lengthAa: number, frame: Orf['frame'] = 1): Orf => ({
    lengthAa,
    frame,
    location: { segments: [{ start: 0, end: 3 }], strand: 1 },
    protein: 'M',
    startCodon: 'ATG',
    stopCodon: 'TAA',
  });

  it('lowers the ORF threshold for a short sequence', () => {
    expect(minOrfCodons(1200)).toBe(30);
    expect(minOrfCodons(5000)).toBe(100);
  });

  it('keeps the longest few ORFs, longest first, whatever the input order', () => {
    const lengths = [50, 400, 120, 400, 90, 700, 10];
    expect(
      longestOrfs(
        lengths.map((n) => orf(n)),
        3,
      ).map((o) => o.lengthAa),
    ).toEqual([700, 400, 400]);
    expect(longestOrfs([], 3)).toEqual([]);
  });

  const feature = (name: string, start: number, type: DetectedFeature['type']): DetectedFeature => ({
    id: name,
    name,
    type,
    origin: 'detected',
    identity: 1,
    location: { segments: [{ start, end: start + 30 }], strand: 1 },
  });

  it('orders feature rows by position and counts types, most frequent first', () => {
    const found = [
      feature('b', 300, 'promoter'),
      feature('a', 10, 'resistance'),
      feature('c', 600, 'promoter'),
    ];
    expect(featureRows(found).map((r) => r.feature.name)).toEqual(['a', 'b', 'c']);
    expect(featureRows(found)[0]?.location).toBe('11..40');
    expect(featureTypeCounts(found)).toEqual([
      ['promoter', 2],
      ['resistance', 1],
    ]);
  });

  it('opens an origin-crossing feature at the first base of its region', () => {
    const wrapping: DetectedFeature = {
      ...feature('wrap', 0, 'rep_origin'),
      location: {
        segments: [
          { start: 2680, end: 2686 },
          { start: 0, end: 20 },
        ],
        strand: 1,
      },
    };
    expect(featureRows([wrapping])[0]?.position).toBe(2680);
  });
});

describe('model on a 5 Mb sequence', { timeout: 60_000 }, () => {
  it('checks the ends for overlap and picks the longest ORFs without a slow pass', () => {
    const seq = randomDna(5_000_000, 11);
    const orfs = Array.from({ length: 300_000 }, (_, i) => ({
      lengthAa: (i * 7919) % 10_007,
      frame: 1,
      location: { segments: [{ start: 0, end: 3 }], strand: 1 },
    })) as unknown as Orf[];
    const start = performance.now();
    expect(endsOverlap(seq)).toBe(0);
    expect(longestOrfs(orfs, 10)).toHaveLength(10);
    expect(performance.now() - start).toBeLessThan(5_000);
  });
});
