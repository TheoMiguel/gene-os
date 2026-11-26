import { PUC19, randomDna } from '../../tests/fixtures/restriction/fixtures';
import { codonUsage, cumulativeGcSkew, nucleotideSeries } from '../engine/composition';
import { findOrfs } from '../engine/orf';
import { hydropathyProfile } from '../engine/protein';
import { ENZYME_CATALOG, scanSites } from '../engine/restriction';
import { translateFrame } from '../engine/translate';
import { runAnalysis } from './analyses';
import { type AnalysisInput, stableKey, transferablesOf } from './protocol';

const circularInput: AnalysisInput = { seq: PUC19, topology: 'circular', alphabet: 'dna' };
const linearInput: AnalysisInput = { ...circularInput, topology: 'linear' };

describe('runAnalysis gives what the engine gives', () => {
  it('scans ORFs with the record topology as the default', () => {
    expect(runAnalysis('orfs', circularInput, { minCodons: 50 })).toEqual(
      findOrfs(PUC19, { minCodons: 50, circular: true }),
    );
    expect(runAnalysis('orfs', linearInput, { minCodons: 50 })).toEqual(findOrfs(PUC19, { minCodons: 50 }));
  });

  it('lets a parameter override the topology default', () => {
    expect(runAnalysis('orfs', circularInput, { minCodons: 50, circular: false })).toEqual(
      findOrfs(PUC19, { minCodons: 50 }),
    );
  });

  it('scans the named enzymes, or the whole catalog', () => {
    const named = runAnalysis('restriction', circularInput, { enzymes: ['EcoRI', 'BamHI'] });
    expect(named.sites.map((s) => s.enzyme.name).sort()).toEqual(['BamHI', 'EcoRI']);
    expect(named.sites.find((s) => s.enzyme.name === 'EcoRI')?.topCuts.length).toBe(1);
    const all = runAnalysis('restriction', circularInput, {});
    expect(all.sites.length).toBe(scanSites(PUC19, 'circular', ENZYME_CATALOG).sites.length);
  });

  it('builds window series and the cumulative skew', () => {
    const series = runAnalysis('nucleotideSeries', linearInput, { kind: 'gc', window: 100, step: 50 });
    expect(series).toEqual(nucleotideSeries(PUC19, 'gc', { window: 100, step: 50, circular: false }));
    expect(runAnalysis('cumulativeGcSkew', linearInput, { window: 200 })).toEqual(
      cumulativeGcSkew(PUC19, 200),
    );
  });

  it('counts codons of one frame', () => {
    expect(runAnalysis('codonUsage', linearInput, { frame: 1 })).toEqual(codonUsage(PUC19, { frame: 1 }));
  });

  it('profiles hydropathy of a translated frame, or of a protein record as it is', () => {
    expect(runAnalysis('hydropathy', linearInput, { window: 9, frame: 2 })).toEqual(
      hydropathyProfile(translateFrame(PUC19, 2), 9),
    );
    const protein: AnalysisInput = { seq: 'MKTAYIAKQRQISFVKSHFSRQ', topology: 'linear', alphabet: 'protein' };
    expect(runAnalysis('hydropathy', protein, { window: 5 })).toEqual(hydropathyProfile(protein.seq, 5));
  });

  it('searches both strands of a circular record across the origin', () => {
    const input: AnalysisInput = { seq: 'CGTAAAAAAATT', topology: 'circular', alphabet: 'dna' };
    expect(runAnalysis('search', input, { query: 'TTCG' }).total).toBe(1);
    expect(runAnalysis('search', { ...input, topology: 'linear' }, { query: 'TTCG' }).total).toBe(0);
  });

  it('detects known elements', () => {
    const names = runAnalysis('features', circularInput, {}).map((f) => f.name);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe('protocol helpers', () => {
  it('lists each typed-array buffer of a result once', () => {
    const series = runAnalysis('nucleotideSeries', linearInput, { kind: 'gc', window: 100 });
    expect(transferablesOf(series)).toEqual([series.starts.buffer, series.values.buffer]);
    const scan = runAnalysis('restriction', circularInput, { enzymes: ['EcoRI'] });
    expect(transferablesOf(scan).length).toBe(3);
    expect(transferablesOf('text')).toEqual([]);
  });

  it('makes one key for parameters written in any key order', () => {
    expect(stableKey({ a: 1, b: { d: 1, c: 2 } })).toBe(stableKey({ b: { c: 2, d: 1 }, a: 1 }));
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }));
  });
});

describe('performance', { timeout: 60_000 }, () => {
  it('runs a window series, ORF scan and codon count on 5 Mb', () => {
    const input: AnalysisInput = { seq: randomDna(5_000_000, 11), topology: 'linear', alphabet: 'dna' };
    const t0 = performance.now();
    runAnalysis('nucleotideSeries', input, { kind: 'gc', window: 1000, step: 100 });
    runAnalysis('codonUsage', input, {});
    runAnalysis('orfs', input, { minCodons: 100 });
    expect(performance.now() - t0).toBeLessThan(30_000);
  });
});
