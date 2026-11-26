import hbb from '../../tests/fixtures/core/hbb-region.fasta?raw';
import pbr322 from '../../tests/fixtures/core/pbr322.fasta?raw';
import pegfp from '../../tests/fixtures/core/pegfp-n1.fasta?raw';
import pgex from '../../tests/fixtures/core/pgex-4t-1.fasta?raw';
import phix from '../../tests/fixtures/core/phix174.fasta?raw';
import puc19 from '../../tests/fixtures/core/puc19.fasta?raw';
import { randomDna, seededRandom } from '../../tests/oracle/core-goldens';
import { cleanSequence, reverseComplement } from './alphabet';
import { inferOrganism } from './organism';

const fixture = (raw: string) => cleanSequence(raw.split('\n').slice(1).join(''));

/**
 * A synthetic gene-dense genome: genes of 200 to 500 codons on random strands, 40 to 120 bases apart. Every base is
 * drawn with the given GC probability, and stop codons inside a gene are redrawn.
 */
function syntheticGenome(length: number, gc: number, seed: number): string {
  const random = seededRandom(seed);
  const base = () =>
    random() < gc ? ('GC'[Math.floor(random() * 2)] as string) : ('AT'[Math.floor(random() * 2)] as string);
  const stops = new Set(['TAA', 'TAG', 'TGA']);
  const parts: string[] = [];
  let total = 0;
  while (total < length) {
    const spacer = Array.from({ length: 40 + Math.floor(random() * 80) }, base).join('');
    const codons = ['ATG'];
    for (let i = 200 + Math.floor(random() * 300); i > 0; i--) {
      let codon = base() + base() + base();
      while (stops.has(codon)) codon = base() + base() + base();
      codons.push(codon);
    }
    codons.push('TAA');
    const gene = codons.join('');
    const placed = random() < 0.5 ? gene : reverseComplement(gene);
    parts.push(spacer, placed);
    total += spacer.length + placed.length;
  }
  return parts.join('').slice(0, length);
}

describe('organism inference on clear cases', () => {
  it.each([
    ['pUC19', puc19],
    ['pBR322', pbr322],
    ['pEGFP-N1', pegfp],
    ['pGEX-4T-1', pgex],
  ])('calls %s a synthetic vector and names the parts', (_name, raw) => {
    const result = inferOrganism(fixture(raw), { topology: 'circular' });
    expect(result.category).toBe('synthetic-vector');
    expect(result.confidence).toBeGreaterThan(0.85);
    expect(result.evidence.join(' ')).toMatch(/vector parts found/);
    expect(result.metrics.vectorParts.length).toBeGreaterThanOrEqual(3);
  });

  it('calls the phiX174 genome a phage or virus: small, gene-dense, no vector parts', () => {
    const result = inferOrganism(fixture(phix), { topology: 'circular' });
    expect(result.category).toBe('phage-virus');
    expect(result.metrics.codingDensity).toBeGreaterThan(0.75);
    expect(result.metrics.vectorParts).toEqual([]);
  });

  it('calls the human beta-globin region a eukaryote: long and sparse in long ORFs', () => {
    const result = inferOrganism(fixture(hbb));
    expect(result.category).toBe('eukaryote');
    expect(result.metrics.codingDensity).toBeLessThan(0.4);
    expect(result.metrics.cpgRatio).toBeLessThan(0.65);
    expect(result.evidence.join(' ')).toMatch(/CpG is depleted/);
  });

  it('calls a gene-dense GC-rich genome of 400 kb a high-GC bacterium', () => {
    const result = inferOrganism(syntheticGenome(400_000, 0.68, 1), { topology: 'circular' });
    expect(result.category).toBe('high-gc-bacterium');
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.metrics.gc3).toBeGreaterThan(0.6);
  });

  it('calls a gene-dense AT-rich genome of 400 kb a low-GC bacterium', () => {
    const result = inferOrganism(syntheticGenome(400_000, 0.32, 2), { topology: 'circular' });
    expect(result.category).toBe('low-gc-bacterium');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('gives a bacterium near the 50% line a lower confidence and says so', () => {
    const near = inferOrganism(syntheticGenome(400_000, 0.5, 3), { topology: 'circular' });
    const far = inferOrganism(syntheticGenome(400_000, 0.68, 1), { topology: 'circular' });
    expect(near.confidence).toBeLessThan(far.confidence);
    expect(near.evidence.join(' ')).toMatch(/close to the 50% line/);
  });

  it('calls a protein a protein', () => {
    const result = inferOrganism('MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVV');
    expect(result.category).toBe('protein');
    expect(result.confidence).toBeGreaterThan(0.9);
  });
});

describe('organism inference limits', () => {
  it('leaves a short fragment unknown', () => {
    const result = inferOrganism('ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG');
    expect(result.category).toBe('unknown');
    expect(result.evidence.join(' ')).toMatch(/too short/);
  });

  it('leaves a lone gene-sized random sequence unknown', () => {
    expect(inferOrganism(randomDna(2000, 9)).category).toBe('unknown');
  });

  it('accepts features computed by the caller and an explicit alphabet', () => {
    const seq = fixture(puc19);
    expect(inferOrganism(seq, { features: [], alphabet: 'dna' }).category).not.toBe('synthetic-vector');
  });

  it('keeps every confidence between 0 and 1 and always gives evidence', () => {
    for (const raw of [puc19, phix, hbb]) {
      const result = inferOrganism(fixture(raw));
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.evidence.length).toBeGreaterThan(1);
    }
  });
});

describe('performance', { timeout: 60_000 }, () => {
  it('infers from a 5 Mb gene-dense genome in a few seconds', () => {
    const genome = syntheticGenome(5_000_000, 0.6, 4);
    const started = performance.now();
    const result = inferOrganism(genome, { topology: 'circular' });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(result.category).toBe('high-gc-bacterium');
  });
});
