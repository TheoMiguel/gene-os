import { GOLDEN, sameCircle } from '../../../tests/fixtures/cloning/golden';
import { makeRecord, PUC19, PUC19_RECORD } from '../../../tests/fixtures/cloning/records';
import { reverseComplement } from '../alphabet';
import type { Feature } from '../types';
import { designCloning } from './index';
import type { CloningResult, Construct } from './model';

const vector = { id: 'pUC19', record: PUC19_RECORD };

function constructs(result: CloningResult): readonly Construct[] {
  if (!result.ok) throw new Error(`design failed: ${JSON.stringify(result.problems)}`);
  return result.design.constructs;
}

describe('restriction and ligation vs Bio.Restriction digests joined by hand', () => {
  for (const c of GOLDEN.restriction) {
    it(c.label, () => {
      const insert = {
        id: 'insert',
        record: makeRecord('insert', c.insertSeq, 'linear'),
        ...(c.region ? { region: c.region } : {}),
      };
      const built = constructs(
        designCloning({ method: 'restriction', vector, insert, enzymes: c.enzymes, insertMode: c.mode }),
      );
      const forward = built.find((x) => x.orientation === 'forward');
      expect(forward && sameCircle(forward.record.seq, c.forward)).toBe(true);
      const reverse = built.find((x) => x.orientation === 'reverse');
      if (c.reverse === null) expect(reverse).toBeUndefined();
      else expect(reverse && sameCircle(reverse.record.seq, c.reverse)).toBe(true);
      expect(forward?.record.seq.length).toBe(c.backboneLength + c.insertLength);
    });
  }
});

describe('Gibson and In-Fusion vs string surgery', () => {
  GOLDEN.homology.forEach((c, index) => {
    it(`${c.method} case ${index + 1} (overlap ${c.overlap})`, () => {
      const inserts = c.inserts.map((i, k) => ({
        id: `insert${k + 1}`,
        record: makeRecord(`t${k + 1}`, i.seq, i.topology),
        region: i.region,
      }));
      const result = designCloning({
        method: c.method,
        vector,
        opening: c.vectorEnzymes
          ? { enzymes: c.vectorEnzymes }
          : { remove: c.vectorRemove ?? { start: 0, length: 0 } },
        inserts,
        overlap: c.overlap,
        strands: c.inserts.map((i) => i.strand),
      });
      const built = constructs(result);
      expect(sameCircle(built[0]?.record.seq ?? '', c.expected)).toBe(true);
      if (!result.ok) return;
      // The first insert's forward primer starts with the last `overlap` bases of the vector end.
      const first = result.design.primers[0];
      expect(first?.seq.startsWith(c.backbone.slice(-c.overlap))).toBe(true);
      // The last insert's reverse primer starts with the reverse complement of the vector start.
      const last = result.design.primers[result.design.primers.length - 1];
      expect(last?.seq.startsWith(reverseComplement(c.backbone.slice(0, c.overlap)))).toBe(true);
    });
  });
});

describe('Golden Gate vs Bio.Restriction digests joined by overhang', () => {
  GOLDEN.goldenGate.forEach((c, index) => {
    it(`${c.enzyme} ${c.style} ${c.vectorMode} case ${index + 1}`, () => {
      const result = designCloning({
        method: 'golden_gate',
        enzyme: c.enzyme,
        vector: {
          id: 'vector',
          record: makeRecord('vector', c.vector, 'circular'),
          ...(c.vectorMode === 'pcr' ? { region: c.vectorRegion } : {}),
        },
        vectorMode: c.vectorMode,
        parts: c.parts.map((seq, i) => ({
          id: `part${i + 1}`,
          record: makeRecord(`p${i + 1}`, seq, 'linear'),
        })),
        ...(c.overhangs ? { overhangs: c.overhangs } : {}),
        junctionStyle: c.style,
      });
      const built = constructs(result);
      expect(sameCircle(built[0]?.record.seq ?? '', c.expected)).toBe(true);
    });
  });
});

describe('Gateway vs string surgery', () => {
  const ccdb = (start: number, end: number): Feature => ({
    id: 'ccdb',
    type: 'CDS',
    name: 'ccdB',
    location: { segments: [{ start, end }], strand: 1 },
    origin: 'user',
  });
  const resistance = (): Feature => ({
    id: 'res',
    type: 'resistance',
    name: 'KanR',
    location: { segments: [{ start: 0, end: 100 }], strand: 1 },
    origin: 'user',
  });

  for (const c of GOLDEN.gateway) {
    it(`${c.reaction} reaction`, () => {
      const result = designCloning({
        method: 'gateway',
        reaction: c.reaction,
        vector: {
          id: 'vector',
          record: makeRecord('vector', c.vector.seq, 'circular', [
            ccdb(c.vector.ccdb.start, c.vector.ccdb.end),
          ]),
        },
        inserts: c.inserts.map((i, k) => ({
          part: {
            id: `insert${k + 1}`,
            record: makeRecord(
              `i${k + 1}`,
              i.seq,
              c.reaction === 'BP' ? 'linear' : 'circular',
              c.reaction === 'LR' ? [resistance()] : [],
            ),
            ...(i.region ? { region: i.region } : {}),
          },
          ...(i.attB ? { attB: { left: i.attB[0], right: i.attB[1] } } : {}),
        })),
      });
      const built = constructs(result);
      const record = built[0]?.record;
      expect(sameCircle(record?.seq ?? '', c.expected)).toBe(true);
      expect(record?.features.some((f) => f.name === 'ccdB')).toBe(false);
      if (c.attL1Right && c.geneStart) {
        // Manual (pDONR221 x attB1 entry clone): the attL1 reads ...AAAAAAGCAGGCT then the gene.
        expect(((record?.seq ?? '') + (record?.seq ?? '')).includes(c.attL1Right + c.geneStart)).toBe(true);
      }
    });
  }
});

describe('TOPO vs string surgery', () => {
  for (const c of GOLDEN.topo) {
    it(c.directional ? 'directional (CACC)' : 'TA (3 prime A)', () => {
      const built = constructs(
        designCloning({
          method: 'topo',
          vector,
          site: c.site,
          insert: {
            id: 'insert',
            record: makeRecord('insert', c.insert.seq, 'linear'),
            region: c.insert.region,
          },
          directional: c.directional,
        }),
      );
      expect(built[0]?.record.seq).toBe(c.forward);
      const reverse = built.find((x) => x.orientation === 'reverse');
      if (c.reverse === null) expect(reverse).toBeUndefined();
      else expect(reverse?.record.seq).toBe(c.reverse);
      expect(built[0]?.record.seq.startsWith(PUC19.slice(0, 100))).toBe(true);
    });
  }
});
