import { makeRecord, randomDna } from '../../../tests/fixtures/cloning/records';
import { designCloning } from './index';

// Every cloning method scans or joins whole vectors: each must stay near-linear on a 5 Mb vector.
describe('cloning on a 5 Mb vector', { timeout: 60_000 }, () => {
  const size = 5_000_000;
  const clean = randomDna(size, 2026)
    .replaceAll('GAATTC', 'GAATCC')
    .replaceAll('GGATCC', 'GGAGCC')
    .replaceAll('GGTCTC', 'GGTCAC')
    .replaceAll('GAGACC', 'GAGAGC');
  const at = 2_500_000;
  const seq = `${clean.slice(0, at)}GAATTCACGTACGGATCC${clean.slice(at)}`;
  const vector = { id: 'big', record: makeRecord('big', seq, 'circular') };
  const insert = {
    id: 'gene',
    record: makeRecord('geneT', randomDna(1500, 7), 'linear'),
    region: { start: 100, length: 1000 },
  };

  it('Gibson with an enzyme-opened vector', () => {
    const result = designCloning({
      method: 'gibson',
      vector,
      opening: { enzymes: ['EcoRI', 'BamHI'] },
      inserts: [insert],
    });
    expect(result.ok).toBe(true);
    // The 12 base stub between the two cuts is replaced by the 1000 base insert.
    if (result.ok) expect(result.design.constructs[0]?.record.seq.length).toBe(seq.length - 12 + 1000);
  });

  it('restriction and ligation', () => {
    const result = designCloning({ method: 'restriction', vector, insert, enzymes: ['EcoRI', 'BamHI'] });
    expect(result.ok).toBe(true);
  });

  it('Golden Gate with a PCR vector region', () => {
    const result = designCloning({
      method: 'golden_gate',
      enzyme: 'BsaI',
      vector: { ...vector, region: { start: 0, length: 20_000 } },
      vectorMode: 'pcr',
      parts: [insert],
    });
    expect(result.ok).toBe(true);
  });

  it('TOPO and LIC', () => {
    expect(designCloning({ method: 'topo', vector, site: 1000, insert, directional: false }).ok).toBe(true);
    const lic = designCloning({
      method: 'lic',
      vector,
      opening: { remove: { start: 0, length: 0 } },
      insert,
    });
    expect(lic.ok || lic.problems.length > 0).toBe(true);
  });
});
