import pbr322 from '../../tests/fixtures/core/pbr322.fasta?raw';
import pegfp from '../../tests/fixtures/core/pegfp-n1.fasta?raw';
import pgex from '../../tests/fixtures/core/pgex-4t-1.fasta?raw';
import puc19 from '../../tests/fixtures/core/puc19.fasta?raw';
import { randomDna, seededRandom } from '../../tests/oracle/core-goldens';
import { cleanSequence, reverseComplement } from './alphabet';
import { type DetectedFeature, detectFeatures, FEATURE_CATALOG } from './features';
import { formatLocation, locationLength, regionStart } from './location';
import { translate } from './translate';
import { FEATURE_TYPES, type FeatureSignature } from './types';

const fixture = (raw: string) => cleanSequence(raw.split('\n').slice(1).join(''));
const signature = (name: string) => FEATURE_CATALOG.find((s) => s.name === name) as FeatureSignature;
const hit = (features: DetectedFeature[], name: string) => features.find((f) => f.name === name);
const span = (f: DetectedFeature | undefined) => (f ? formatLocation(f.location) : undefined);

/** Substitutes `count` distinct positions of `seq` with a different base, deterministically. */
function mutate(seq: string, count: number, random: () => number): string {
  const chars = [...seq];
  const positions = new Set<number>();
  while (positions.size < count) positions.add(Math.floor(random() * chars.length));
  for (const p of positions) {
    const others = [...'ACGT'].filter((b) => b !== chars[p]);
    chars[p] = others[Math.floor(random() * 3)] as string;
  }
  return chars.join('');
}

describe('feature catalog', () => {
  it('has more than 60 valid, uniquely named entries, each with a source accession', () => {
    expect(FEATURE_CATALOG.length).toBeGreaterThan(60);
    expect(new Set(FEATURE_CATALOG.map((s) => s.name)).size).toBe(FEATURE_CATALOG.length);
    for (const s of FEATURE_CATALOG) {
      expect(FEATURE_TYPES).toContain(s.type);
      expect(s.source).toMatch(/^[A-Z]{1,2}\d{5,6}\.\d+$/);
      expect(s.minIdentity).toBeGreaterThan(0.8);
      expect(s.seq).toMatch(s.seqAlphabet === 'dna' ? /^[ACGT]+$/ : /^[ACDEFGHIKLMNPQRSTVWY]+$/);
    }
  });

  it('still holds every element of the V1.2.0 catalog', () => {
    for (const name of [
      'T7 promoter',
      'lacUV5 promoter',
      'lac operator',
      'CMV promoter',
      'Kozak sequence',
      '6xHis tag',
      'FLAG tag',
      'T7 terminator',
      'SV40 polyA signal',
      'pUC origin',
      'AmpR (bla)',
    ]) {
      expect(signature(name), name).toBeDefined();
    }
    expect(FEATURE_CATALOG.some((s) => s.type === 'RBS')).toBe(true);
  });

  it('keeps each protein tag identical to the translation of its annotated source', () => {
    expect(signature('6xHis tag').seq).toBe('HHHHHH');
    expect(signature('FLAG tag').seq).toBe('DYKDDDDK');
    expect(signature('HA tag').seq).toBe('YPYDVPDYA');
    expect(signature('Myc tag').seq).toBe('EQKLISEEDL');
  });

  it('keeps the AmpR signature a real TEM-1 beta-lactamase gene (Biopython-free check by translation)', () => {
    const protein = translate(signature('AmpR (bla)').seq, { table: 11 });
    expect(protein.startsWith('MSIQHFRVALIPFFAAFCLPVFA')).toBe(true);
    expect(protein.endsWith('*')).toBe(true);
    expect(protein.slice(0, -1)).not.toContain('*');
  });
});

describe('detection on real vectors, against the annotations of their GenBank records', () => {
  it('pBR322 (J01749): tet, rop and bla at their annotated positions and strands', () => {
    const features = detectFeatures(fixture(pbr322), { topology: 'circular' });
    expect(span(hit(features, 'TetR (tet)'))).toBe('86..1276');
    expect(span(hit(features, 'rop'))).toBe('1915..2106');
    expect(span(hit(features, 'AmpR (bla)'))).toBe('complement(3293..4153)');
    expect(hit(features, 'AmpR (bla)')?.identity).toBeGreaterThan(0.99);
    expect(hit(features, 'AmpR (bla)')?.source).toBe(signature('AmpR (bla)').source);
  });

  it('pUC19 (L09137): AmpR, pUC origin and the lac elements', () => {
    const features = detectFeatures(fixture(puc19), { topology: 'circular' });
    expect(span(hit(features, 'AmpR (bla)'))).toBe('complement(1626..2486)');
    expect(span(hit(features, 'pUC origin'))).toBe('complement(867..1455)');
    expect(hit(features, 'lac operator')).toBeDefined();
    expect(hit(features, 'lac promoter')?.location.strand).toBe(-1);
    expect(hit(features, 'pUC/pGEM MCS')?.location.strand).toBe(1);
  });

  it('pGEX-4T-1 (U13853): GST, tac promoter, thrombin site and bla at their annotated positions', () => {
    const features = detectFeatures(fixture(pgex), { topology: 'circular' });
    expect(span(hit(features, 'GST'))).toBe('258..977');
    expect(span(hit(features, 'tac promoter'))).toBe('185..213');
    expect(span(hit(features, 'Thrombin site'))).toBe('918..935');
    expect(span(hit(features, 'AmpR (bla)'))).toBe('1377..2237');
    expect(span(hit(features, 'lacI'))).toBe('3318..4400');
  });

  it('pEGFP-N1 (U55762): EGFP, NeoR, and the CMV enhancer across the origin as two segments', () => {
    const features = detectFeatures(fixture(pegfp), { topology: 'circular' });
    expect(span(hit(features, 'EGFP'))).toBe('679..1398');
    expect(span(hit(features, 'NeoR/KanR (nptII)'))).toBe('2629..3423');
    const enhancer = hit(features, 'CMV enhancer');
    expect(enhancer?.location.segments).toHaveLength(2);
    expect(enhancer ? locationLength(enhancer.location) : 0).toBe(380);
    const linear = detectFeatures(fixture(pegfp));
    expect(hit(linear, 'CMV enhancer')).toBeUndefined();
    expect(hit(linear, 'EGFP')).toBeDefined();
  });

  it('only reports detected features', () => {
    for (const f of detectFeatures(fixture(puc19), { topology: 'circular' }))
      expect(f.origin).toBe('detected');
  });
});

describe('sensitivity and specificity', () => {
  const ampR = signature('AmpR (bla)');
  const budget = Math.floor(ampR.seq.length * (1 - ampR.minIdentity));

  it('finds a signature with exactly the allowed number of mismatches on either strand, and not one more', () => {
    const random = seededRandom(42);
    for (const strand of [1, -1] as const) {
      const background = randomDna(20_000, 5);
      const place = (copy: string) => {
        const insert = strand === 1 ? copy : reverseComplement(copy);
        return background.slice(0, 7000) + insert + background.slice(7000 + insert.length);
      };
      const found = hit(detectFeatures(place(mutate(ampR.seq, budget, random))), 'AmpR (bla)');
      expect(found?.location).toMatchObject({
        strand,
        segments: [{ start: 7000, end: 7000 + ampR.seq.length }],
      });
      expect(found?.identity).toBeCloseTo(1 - budget / ampR.seq.length, 6);
      expect(hit(detectFeatures(place(mutate(ampR.seq, budget + 1, random))), 'AmpR (bla)')).toBeUndefined();
    }
  });

  it('finds every planted copy of short signatures at random positions, strands and mismatch counts', () => {
    const random = seededRandom(7);
    const custom: FeatureSignature[] = [
      {
        name: 'probe',
        type: 'misc_feature',
        seq: 'GATTACAGATTACAGATTACAGATTACAGATTACAGATTACA',
        seqAlphabet: 'dna',
        minIdentity: 0.9,
      },
    ];
    const probe = (custom[0] as FeatureSignature).seq;
    for (let trial = 0; trial < 40; trial++) {
      const circular = trial % 2 === 0;
      const strand = trial % 4 < 2 ? 1 : -1;
      const copy = mutate(probe, Math.floor(random() * 5), random);
      const insert = strand === 1 ? copy : reverseComplement(copy);
      const at = Math.floor(random() * 2000);
      const background = randomDna(2000, 100 + trial);
      let seq = background.slice(0, at) + insert + background.slice(at + insert.length);
      let expectedStart = at;
      if (circular) {
        const rotate = Math.floor(random() * seq.length);
        seq = seq.slice(rotate) + seq.slice(0, rotate);
        expectedStart = (at - rotate + seq.length) % seq.length;
      }
      const hits = detectFeatures(seq, { catalog: custom, topology: circular ? 'circular' : 'linear' });
      expect(hits, `trial ${trial}`).toHaveLength(1);
      expect(hits[0]?.location.strand).toBe(strand);
      expect(hits[0] ? regionStart(hits[0].location) : -1).toBe(expectedStart);
    }
  });

  it('reports nothing for a random sequence from any signature of 20 bases or more', () => {
    const features = detectFeatures(randomDna(200_000, 21), { topology: 'circular' });
    expect(features.filter((f) => locationLength(f.location) >= 20)).toEqual([]);
  });

  it('counts N and other ambiguity codes as mismatches', () => {
    const t7 = signature('T7 promoter');
    const seq = `${randomDna(300, 3)}${t7.seq.slice(0, 5)}N${t7.seq.slice(6)}${randomDna(300, 4)}`;
    expect(hit(detectFeatures(seq), 'T7 promoter')?.identity).toBeCloseTo(0.95, 6);
    expect(hit(detectFeatures(seq.toLowerCase()), 'T7 promoter')).toBeDefined();
  });

  it('reports one hit for a repeat instead of one at every offset', () => {
    const custom: FeatureSignature[] = [
      { name: 'A10', type: 'misc_feature', seq: 'AAAAAAAAAA', seqAlphabet: 'dna', minIdentity: 1 },
    ];
    const hits = detectFeatures(`CCCC${'A'.repeat(30)}CCCC`, { catalog: custom });
    expect(hits.filter((f) => f.location.strand === 1).map((f) => regionStart(f.location))).toEqual([
      4, 14, 24,
    ]);
  });

  it('returns nothing for an empty sequence and skips signatures longer than the sequence', () => {
    expect(detectFeatures('')).toEqual([]);
    expect(detectFeatures('ACGT', { topology: 'circular' })).toEqual([]);
  });
});

describe('protein tags in the six-frame translation', () => {
  const his = 'CATCACCATCATCACCAC';
  const flag = 'GACTACAAGGACGACGATGACAAG';

  it('finds a tag on the top strand in each frame', () => {
    for (const offset of [0, 1, 2]) {
      const seq = `${'GGC'.repeat(30)}${'G'.repeat(offset)}${his}${'GGC'.repeat(30)}`;
      const found = hit(detectFeatures(seq), '6xHis tag');
      expect(found?.location.strand).toBe(1);
      expect(regionStart(found?.location ?? { segments: [], strand: 1 })).toBe(90 + offset);
      expect(found?.identity).toBe(1);
    }
  });

  it('finds a tag on the bottom strand with its top-strand span', () => {
    const seq = `${'GGC'.repeat(30)}${reverseComplement(flag)}${'GGC'.repeat(30)}`;
    const found = hit(detectFeatures(seq), 'FLAG tag');
    expect(found?.location).toEqual({ segments: [{ start: 90, end: 90 + flag.length }], strand: -1 });
  });

  it('finds a tag that crosses the origin of a circular sequence', () => {
    const body = `${'GGC'.repeat(30)}${flag}${'GGC'.repeat(30)}`;
    const seq = body.slice(100) + body.slice(0, 100);
    const found = hit(detectFeatures(seq, { topology: 'circular' }), 'FLAG tag');
    expect(found?.location.segments).toHaveLength(2);
    expect(hit(detectFeatures(seq), 'FLAG tag')).toBeUndefined();
  });

  it('can leave protein signatures out', () => {
    const seq = `${'GGC'.repeat(30)}${his}${'GGC'.repeat(30)}`;
    expect(hit(detectFeatures(seq, { proteins: false }), '6xHis tag')).toBeUndefined();
  });
});

describe('performance', () => {
  it('annotates a 5 Mb sequence with the full catalog in a few seconds', () => {
    const seq = randomDna(5_000_000, 31);
    const gst = signature('GST').seq;
    const planted = seq.slice(0, 2_500_000) + gst + seq.slice(2_500_000 + gst.length);
    const started = performance.now();
    const features = detectFeatures(planted, { topology: 'circular' });
    const elapsed = performance.now() - started;
    expect(hit(features, 'GST')).toBeDefined();
    expect(elapsed).toBeLessThan(10_000);
  });
});
