import { compareSequences } from './compare';
import { buildReportPdf } from './document';
import { checkPdfStructure, englishText, fixtureRecord } from './test-support';

/** Deterministic pseudo-random bases, so a run is repeatable. */
function randomBases(length: number, seed: number): string {
  let state = seed;
  const out = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = 'ACGT'[state >>> 30] as string;
  }
  return out.join('');
}

const META = {
  projectName: 'Performance',
  generated: '2026-11-26T00:00:00.000Z',
  locale: 'en',
  mode: 'global' as const,
};
const template = fixtureRecord('core/puc19.fasta');
const record = (name: string, seq: string, topology: 'linear' | 'circular') => ({
  ...template,
  name,
  seq,
  topology,
  features: [],
});

describe('report on large sequences', { timeout: 60_000 }, () => {
  it('compares two unrelated 5 Mb sequences, states the alignment limit and still maps and charts them', () => {
    const a = record('five-mb-a', randomBases(5_000_000, 1), 'circular');
    const b = record('five-mb-b', randomBases(5_000_000, 2), 'linear');
    const started = performance.now();
    const data = compareSequences(a, b);
    const bytes = buildReportPdf(data, META, englishText);
    const seconds = (performance.now() - started) / 1000;
    expect(data.alignment.status).toBe('too-large');
    expect(data.gc?.a.y.length).toBeLessThanOrEqual(300);
    expect(checkPdfStructure(bytes).pages).toBeGreaterThanOrEqual(4);
    expect(seconds).toBeLessThan(40);
  });

  it('aligns two similar 200 kb sequences with a band around the diagonal', () => {
    const seq = randomBases(200_000, 3);
    const edited = `${seq.slice(0, 50_000)}G${seq.slice(50_001, 120_000)}${seq.slice(120_005)}`;
    const data = compareSequences(record('ref', seq, 'linear'), record('edited', edited, 'linear'));
    expect(data.alignment.status).toBe('ok');
    if (data.alignment.status === 'ok')
      expect(data.alignment.counts.substitutions + data.alignment.counts.deletions).toBeGreaterThanOrEqual(1);
  });
});
