import {
  EGFP,
  makeRecord,
  PUC19,
  PUC19_RECORD,
  randomDna,
  templateWith,
} from '../../../tests/fixtures/cloning/records';
import { detectFeatures } from '../features';
import { extractLocation } from '../location';
import type { Feature, SeqRecord } from '../types';
import { designCloning } from './index';
import type { CloningResult } from './model';

const vector = { id: 'pUC19', record: PUC19_RECORD };
const egfpRecord = templateWith('egfpT', EGFP, 'EGFP', 11);
const egfp = { id: 'egfp', record: egfpRecord, region: { start: 120, length: EGFP.length } };

function firstConstruct(result: CloningResult, orientation = 'forward'): SeqRecord {
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  const found = result.design.constructs.find((c) => c.orientation === orientation);
  if (!found) throw new Error(`no ${orientation} construct`);
  return found.record;
}

describe('feature carry-over', () => {
  it('carries the insert feature with shifted coordinates in either orientation', () => {
    const result = designCloning({
      method: 'restriction',
      vector,
      insert: egfp,
      enzymes: ['EcoRI', 'BamHI'],
    });
    const forward = firstConstruct(result);
    const cds = forward.features.find((f) => f.name === 'EGFP');
    expect(cds?.location.strand).toBe(1);
    expect(cds && extractLocation(forward.seq, cds.location)).toBe(EGFP);

    const single = designCloning({
      method: 'restriction',
      vector,
      insert: egfp,
      enzymes: ['HindIII'],
      insertReverse: true,
    });
    const reverse = firstConstruct(single, 'reverse');
    const flipped = reverse.features.find((f) => f.name === 'EGFP');
    expect(flipped?.location.strand).toBe(-1);
    expect(flipped && extractLocation(reverse.seq, flipped.location)).toBe(EGFP);
  });

  it('carries the vector features that survive and checks that some were compared', () => {
    const forward = firstConstruct(
      designCloning({ method: 'restriction', vector, insert: egfp, enzymes: ['EcoRI', 'BamHI'] }),
    );
    let compared = 0;
    for (const feature of forward.features) {
      const id = feature.id.replace(/^pUC19:/, '');
      const source = PUC19_RECORD.features.find((f) => f.id === id.replace(/~\d+$/, ''));
      const partial = feature.location.segments.some((s) => s.partialStart || s.partialEnd);
      if (!feature.id.startsWith('pUC19:') || !source || partial) continue;
      expect(extractLocation(forward.seq, feature.location)).toBe(extractLocation(PUC19, source.location));
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(2);
  });

  it('splits a feature that the insertion interrupts into two partial features', () => {
    const mcs = PUC19_RECORD.features.filter((f) => /MCS/.test(f.name));
    expect(mcs.length).toBeGreaterThan(0);
    const forward = firstConstruct(
      designCloning({ method: 'restriction', vector, insert: egfp, enzymes: ['EcoRI', 'BamHI'] }),
    );
    const pieces = forward.features.filter((f) => /MCS/.test(f.name));
    expect(pieces).toHaveLength(2);
    expect(pieces.every((f) => f.location.segments.some((s) => s.partialStart || s.partialEnd))).toBe(true);
  });

  it('keeps an insert region that crosses the origin of a circular template as one contiguous feature', () => {
    const body = randomDna(1000, 5);
    const core = randomDna(300, 6);
    const seq = core.slice(150) + body + core.slice(0, 150);
    const feature: Feature = {
      id: 'wrap',
      type: 'CDS',
      name: 'wrapped',
      location: {
        segments: [
          { start: seq.length - 150, end: seq.length },
          { start: 0, end: 150 },
        ],
        strand: 1,
      },
      origin: 'user',
    };
    const template = makeRecord('wrapT', seq, 'circular', [feature]);
    const built = firstConstruct(
      designCloning({
        method: 'gibson',
        vector,
        opening: { enzymes: ['EcoRI', 'BamHI'] },
        inserts: [{ id: 'wrap', record: template, region: { start: seq.length - 150, length: 300 } }],
      }),
    );
    const carried = built.features.filter((f) => f.name === 'wrapped');
    expect(carried).toHaveLength(1);
    expect(carried[0]?.location.segments.length).toBeLessThanOrEqual(2);
    expect(carried[0] && extractLocation(built.seq, carried[0].location)).toBe(core);
  });

  it('keeps a vector feature that crosses the vector origin when the vector origin survives', () => {
    const n = PUC19.length;
    const across: Feature = {
      id: 'origin-cds',
      type: 'CDS',
      name: 'across origin',
      location: {
        segments: [
          { start: n - 30, end: n },
          { start: 0, end: 30 },
        ],
        strand: 1,
      },
      origin: 'user',
    };
    const record = makeRecord('pUC19o', PUC19, 'circular', [...PUC19_RECORD.features, across]);
    const built = firstConstruct(
      designCloning({
        method: 'gibson',
        vector: { id: 'vo', record },
        opening: { enzymes: ['EcoRI', 'BamHI'] },
        inserts: [egfp],
      }),
    );
    const carried = built.features.find((f) => f.name === 'across origin');
    expect(carried?.location.segments).toHaveLength(2);
    expect(carried && extractLocation(built.seq, carried.location)).toBe(
      PUC19.slice(n - 30) + PUC19.slice(0, 30),
    );
    expect(built.seq.startsWith(PUC19.slice(0, 200))).toBe(true);
  });

  it('works when the vector opening spans the vector origin', () => {
    const n = PUC19.length;
    const result = designCloning({
      method: 'gibson',
      vector,
      opening: { remove: { start: n - 20, length: 50 } },
      inserts: [egfp],
    });
    const built = firstConstruct(result);
    expect(built.seq.length).toBe(n - 50 + EGFP.length);
    for (const f of built.features) {
      for (const s of f.location.segments) expect(s.end).toBeLessThanOrEqual(built.seq.length);
    }
    expect(built.seq).toContain(EGFP);
  });

  it('re-detecting features on the construct finds the junction-spanning elements the carried ones describe', () => {
    const built = firstConstruct(
      designCloning({ method: 'restriction', vector, insert: egfp, enzymes: ['EcoRI', 'BamHI'] }),
    );
    const detected = detectFeatures(built.seq, { topology: 'circular' }).map((f) => f.name);
    expect(detected).toContain('EGFP');
  });

  it('marks a blunt junction as the site between two bases', () => {
    const insert = {
      id: 'blunt',
      record: makeRecord('blunt', `GTAGTACCCGGG${randomDna(300, 9)}CCCGGGGTAGTA`, 'linear'),
    };
    const result = designCloning({
      method: 'restriction',
      vector,
      insert,
      enzymes: ['SmaI'],
      insertMode: 'digest',
    });
    const record = firstConstruct(result);
    const junction = record.features.find((f) => f.id.startsWith('junction:'));
    expect(junction?.location.segments[0]?.betweenBases).toBe(true);
  });
});
