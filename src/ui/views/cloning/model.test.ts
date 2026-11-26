import { EGFP, PUC19_RECORD, templateWith } from '../../../../tests/fixtures/cloning/records';
import { designCloning } from '../../../engine/cloning';
import type { SeqDocument } from '../../../state/documents';
import { angleOf, arcPath, spreadAngles } from './mapGeometry';
import {
  buildRequest,
  type CloningSetup,
  DEFAULT_CLONING_FIELDS,
  orderList,
  resolvePart,
  singleCutters,
} from './model';

const insertRecord = templateWith('egfpT', EGFP, 'EGFP', 11);
const doc = (id: string, record: SeqDocument['record']): SeqDocument => ({
  id,
  record,
  activeTab: 'cloning',
});
const sources = [
  { doc: doc('v', PUC19_RECORD), selection: null },
  { doc: doc('i', insertRecord), selection: { start: 120, end: 120 + EGFP.length, strand: 1 as const } },
];
const setup = (patch: Partial<CloningSetup> = {}): CloningSetup => ({
  ...DEFAULT_CLONING_FIELDS,
  inserts: [{ kind: 'selection', docId: 'i' }],
  vector: { kind: 'doc', docId: 'v' },
  ...patch,
});

describe('resolvePart', () => {
  it('turns a selection into a region of its document', () => {
    const resolved = resolvePart({ kind: 'selection', docId: 'i' }, sources, 'insert');
    expect('part' in resolved && resolved.part.region).toEqual({ start: 120, length: EGFP.length });
  });

  it('reads a pasted vector as circular and names a pasted insert after its FASTA header', () => {
    const vector = resolvePart({ kind: 'paste', text: 'ACGTACGTAC', topology: 'linear' }, sources, 'vector');
    expect('part' in vector && vector.part.record.topology).toBe('circular');
    const insert = resolvePart({ kind: 'paste', text: '>gfp\nACGT', topology: 'linear' }, sources, 'insert');
    expect('part' in insert && insert.part.id).toBe('gfp');
  });

  it('reports the thing to fix', () => {
    expect(resolvePart({ kind: 'paste', text: ' ', topology: 'linear' }, sources, 'insert')).toMatchObject({
      error: { code: 'empty_paste' },
    });
    expect(resolvePart({ kind: 'doc', docId: 'i' }, sources, 'vector')).toMatchObject({
      error: { code: 'vector_linear' },
    });
    expect(resolvePart({ kind: 'doc', docId: 'gone' }, sources, 'insert')).toMatchObject({
      error: { code: 'closed' },
    });
    expect(resolvePart({ kind: 'selection', docId: 'v' }, sources, 'insert')).toMatchObject({
      error: { code: 'no_selection' },
    });
  });
});

describe('buildRequest', () => {
  it('builds a restriction request the engine designs', () => {
    const built = buildRequest(setup(), sources);
    expect(built.ok && designCloning(built.request).ok).toBe(true);
  });

  it('asks for an opening before a homology method runs, then builds it', () => {
    expect(buildRequest(setup({ method: 'gibson' }), sources)).toEqual({
      ok: false,
      error: { kind: 'field', field: 'opening' },
    });
    const built = buildRequest(setup({ method: 'gibson', openEnzymes: ['EcoRI', ''] }), sources);
    expect(built.ok && built.request).toMatchObject({ method: 'gibson', opening: { enzymes: ['EcoRI'] } });
  });

  it('converts a 1-based removal start to the engine 0-based region', () => {
    const built = buildRequest(
      setup({ method: 'in_fusion', opening: 'region', removeStart: '101', removeLength: '5' }),
      sources,
    );
    expect(built.ok && built.request).toMatchObject({ opening: { remove: { start: 100, length: 5 } } });
  });

  it('passes typed Golden Gate overhangs and leaves blank ones to the designer', () => {
    const built = buildRequest(setup({ method: 'golden_gate', goldenOverhangs: 'aatg, ,GCTT' }), sources);
    expect(built.ok && built.request).toMatchObject({ overhangs: ['AATG', undefined, 'GCTT'] });
    const plain = buildRequest(setup({ method: 'golden_gate' }), sources);
    expect(plain.ok && plain.request).not.toHaveProperty('overhangs');
  });

  it('converts the TOPO position and refuses a missing one', () => {
    expect(buildRequest(setup({ method: 'topo' }), sources)).toMatchObject({ ok: false });
    const built = buildRequest(setup({ method: 'topo', topoSite: '10' }), sources);
    expect(built.ok && built.request).toMatchObject({ method: 'topo', site: 9, directional: true });
  });

  it('adds attB sites for a BP reaction with primers and none for LR', () => {
    const bp = buildRequest(setup({ method: 'gateway', gatewayReaction: 'BP' }), sources);
    expect(bp.ok && bp.request).toMatchObject({ inserts: [{ attB: { left: 1, right: 2 } }] });
    const lr = buildRequest(setup({ method: 'gateway' }), sources);
    expect(lr.ok && 'inserts' in lr.request && lr.request.inserts[0]).not.toHaveProperty('attB');
  });

  it('passes primer options only when typed, and rejects nonsense', () => {
    const built = buildRequest(setup({ targetTm: '58', annealMin: '20' }), sources);
    expect(built.ok && built.request).toMatchObject({ targetTm: 58, annealRange: { min: 20, max: 35 } });
    expect(buildRequest(setup({ targetTm: 'hot' }), sources)).toMatchObject({ ok: false });
    expect(buildRequest(setup({ annealMin: '40', annealMax: '20' }), sources)).toMatchObject({ ok: false });
  });

  it('uses only the first insert for a method that takes one', () => {
    const two = setup({
      inserts: [
        { kind: 'selection', docId: 'i' },
        { kind: 'paste', text: '', topology: 'linear' },
      ],
    });
    expect(buildRequest(two, sources).ok).toBe(true);
    expect(buildRequest({ ...two, method: 'gibson', openEnzymes: ['EcoRI', ''] }, sources)).toMatchObject({
      ok: false,
      error: { kind: 'part', error: { code: 'empty_paste', index: 2 } },
    });
  });
});

describe('helpers', () => {
  it('lists the enzymes that cut pUC19 exactly once, as the unique cutters', () => {
    const names = singleCutters(PUC19_RECORD);
    expect(names).toContain('EcoRI');
    expect(names).toContain('HindIII');
  });

  it('writes the order list as name, tab, sequence', () => {
    const primer = {
      id: 'a',
      name: 'a-F',
      seq: 'ACGT',
      annealLength: 4,
      tailLength: 0,
      tm: 10,
      templateId: 't',
    };
    expect(orderList([primer, { ...primer, name: 'a-R', seq: 'TTTT' }])).toBe('a-F\tACGT\na-R\tTTTT\n');
  });
});

describe('map geometry', () => {
  it('puts position 0 at the top and a quarter turn at the right', () => {
    expect(angleOf(0, 100)).toBeCloseTo(-Math.PI / 2);
    expect(angleOf(25, 100)).toBeCloseTo(0);
  });

  it('draws a full-turn arc as two halves and a short arc as one', () => {
    expect(arcPath(0, 0, 10, 0, Math.PI * 2).match(/A/g)).toHaveLength(2);
    expect(arcPath(0, 0, 10, 0, 1).match(/A/g)).toHaveLength(1);
  });

  it('spreads crowded labels apart and keeps the order', () => {
    const spread = spreadAngles([1, 1.01, 1.02, 3], 0.2);
    const sorted = [...spread].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      expect((sorted[i] as number) - (sorted[i - 1] as number)).toBeGreaterThan(0.19);
    expect(spread[0]).toBeLessThan(spread[1] as number);
    expect(spread[1]).toBeLessThan(spread[2] as number);
  });

  it('spreads labels that sit on both sides of the top of the circle', () => {
    const tau = Math.PI * 2;
    const spread = spreadAngles([tau - 0.02, 0.0, 0.02], 0.3);
    const wrapped = spread.map((a) => ((a % tau) + tau) % tau).sort((a, b) => a - b);
    const gaps = wrapped.map((a, i) => ((wrapped[(i + 1) % 3] as number) - a + tau) % tau);
    for (const gap of gaps) expect(gap).toBeGreaterThan(0.29);
  });
});
