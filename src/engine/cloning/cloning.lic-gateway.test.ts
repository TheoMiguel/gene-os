import { makeRecord, randomDna } from '../../../tests/fixtures/cloning/records';
import { backboneFeature, ccdbFeature } from '../../../tests/fixtures/cloning/scenarios';
import { reverseComplement } from '../alphabet';
import { simulatePcr } from '../pcr';
import { ATT_SITES, chewBack, designCloning } from './index';

describe('T4 DNA polymerase chew-back', () => {
  // Hand-worked: top ACGTTTGGCCAAT with dATP. The left strand stops at the first T (index 3), the right end
  // at the last A (index 11): the left overhang is ACG and the right overhang is the T after the last A.
  it('stops at the first complement of the dNTP on the left and the last dNTP base on the right', () => {
    expect(chewBack('ACGTTTGGCCAAT', 'A')).toEqual({ left: 3, right: 1 });
  });

  it('has no result without a stop base', () => {
    expect(chewBack('CCCCCC', 'A')).toBeUndefined();
    expect(chewBack('AAAAAA', 'A')).toBeUndefined();
  });
});

describe('ligation-independent cloning', () => {
  // A vector whose opening point sits between a 12 base right overhang and a 12 base left overhang, built so
  // that dCTP leaves them exactly: the left overhang has no G, the right overhang has no C.
  const leftOverhang = 'ACTACTACAACT';
  const rightOverhang = 'GATTAGATAGTT';
  const body = randomDna(900, 77).replaceAll('AAAAAA', 'AAAGAA');
  const circle = `${leftOverhang}G${body}C${rightOverhang}`;
  const vector = { id: 'licVec', record: makeRecord('licVec', circle, 'circular') };
  const insertSeq = `ATG${randomDna(300, 78)}TAA`;
  const insert = {
    id: 'gene',
    record: makeRecord('geneT', `${randomDna(50, 79)}${insertSeq}${randomDna(50, 80)}`, 'linear'),
    region: { start: 50, length: insertSeq.length },
  };

  const result = designCloning({
    method: 'lic',
    vector,
    opening: { remove: { start: 0, length: 0 } },
    insert,
    vectorDntp: 'C',
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  const { design } = result;

  it('gives the vector the overhangs the design started from', () => {
    expect(design.fragments[0]).toMatchObject({ kind: 'chew_back', dntp: 'C' });
    expect(design.constructs[0]?.junctions.map((j) => j.length)).toEqual([12, 12]);
  });

  it('puts the vector right overhang and the vector left overhang on the insert primers', () => {
    const [forward, reverse] = design.primers;
    expect(forward?.seq.startsWith(rightOverhang)).toBe(true);
    expect(reverse?.seq.startsWith(reverseComplement(leftOverhang))).toBe(true);
  });

  it('joins the chewed vector and the chewed insert into one circle that holds the gene once', () => {
    const record = design.constructs[0]?.record;
    const seq = record?.seq ?? '';
    expect(seq.split(insertSeq).length - 1).toBe(1);
    // The chewed vector and insert share their overhangs; the insert adds at most one stop base per side.
    const added = seq.length - circle.length - insertSeq.length;
    expect(added).toBeGreaterThanOrEqual(0);
    expect(added).toBeLessThanOrEqual(2);
  });

  it('round trip: the engine PCR gives the insert product the strategy expects', () => {
    const fragment = design.fragments[1];
    const amplicons = simulatePcr(design.primers, insert.record.seq, 'linear');
    expect(amplicons.some((a) => a.seq === fragment?.product)).toBe(true);
  });
});

describe('Gateway ccdB cassette', () => {
  const att = (variant: number) => ATT_SITES.get(variant)?.attB ?? '';
  const window = (variant: number) => att(variant).slice(9, 18);
  const flank = (n: number) => randomDna(30, 600 + n).replaceAll(/TA[CT]A/g, 'GGCG');
  const vectorSeq = `${randomDna(500, 90)}${flank(1)}${window(1)}${flank(2)}${randomDna(150, 91)}${flank(3)}${reverseComplement(window(2))}${flank(4)}${randomDna(500, 92)}`;
  const gene = randomDna(300, 93);
  const insert = {
    part: { id: 'gene', record: makeRecord('geneT', gene, 'linear'), region: { start: 0, length: 300 } },
    attB: { left: 1, right: 2 },
  };
  const start = 560;
  const end = vectorSeq.indexOf(reverseComplement(window(2))) - 30;

  it('removes the cassette arc and keeps the backbone', () => {
    const marked = makeRecord('donor', vectorSeq, 'circular', [ccdbFeature(start, end)]);
    const result = designCloning({
      method: 'gateway',
      reaction: 'BP',
      vector: { id: 'donor', record: marked },
      inserts: [insert],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    const built = result.design.constructs[0]?.record;
    expect(built?.features.some((f) => f.name === 'ccdB')).toBe(false);
    expect(result.design.warnings.some((w) => w.code === 'no_counterselection')).toBe(false);
    expect(built?.seq).toContain(gene);
    expect(result.design.constructs[0]?.junctions.map((j) => j.label)).toEqual(['attL1', 'attL2']);
  });

  it('warns when the donor has no ccdB to select against, and drops the shorter arc', () => {
    const plain = makeRecord('donor', vectorSeq, 'circular', [backboneFeature()]);
    const result = designCloning({
      method: 'gateway',
      reaction: 'BP',
      vector: { id: 'donor', record: plain },
      inserts: [insert],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.design.warnings).toContainEqual({ code: 'no_counterselection', part: 'donor' });
  });

  it('names the LR junctions attB', () => {
    const entrySeq = `${randomDna(400, 95)}${flank(5)}${window(1)}${flank(6)}${gene}${flank(7)}${reverseComplement(window(2))}${flank(8)}${randomDna(400, 96)}`;
    const entry = makeRecord('entry', entrySeq, 'circular', [
      { ...backboneFeature(), location: { segments: [{ start: 0, end: 100 }], strand: 1 } },
    ]);
    const dest = makeRecord('dest', vectorSeq, 'circular', [ccdbFeature(start, end)]);
    const result = designCloning({
      method: 'gateway',
      reaction: 'LR',
      vector: { id: 'dest', record: dest },
      inserts: [{ part: { id: 'entry', record: entry } }],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.design.constructs[0]?.junctions.map((j) => j.label)).toEqual(['attB1', 'attB2']);
    expect(result.design.constructs[0]?.record.seq).toContain(gene);
  });
});
