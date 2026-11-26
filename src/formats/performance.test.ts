import type { Feature, SeqRecord } from '../engine/types';
import { readSequenceFile, writeSequenceFile } from './index';

// A deterministic pseudo-random genome, so the test input is the same on every run.
function genome(length: number): string {
  const bases = 'ACGT';
  const out = new Array<string>(length);
  let x = 2463534242;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = bases[(x >>> 0) & 3] as string;
  }
  return out.join('');
}

function bigRecord(length: number, featureCount: number): SeqRecord {
  const features: Feature[] = [];
  for (let i = 0; i < featureCount; i++) {
    const start = Math.floor((i * length) / featureCount);
    features.push({
      id: `g${i}`,
      type: 'CDS',
      name: `gene${i}`,
      location: { segments: [{ start, end: start + 900 }], strand: i % 2 === 0 ? 1 : -1 },
      origin: 'file',
      qualifiers: { label: [`gene${i}`], note: ['generated feature for the performance test'] },
    });
  }
  return {
    id: 'BIG.1',
    name: 'BIG',
    description: 'generated',
    alphabet: 'dna',
    topology: 'circular',
    seq: genome(length),
    features,
    metadata: {},
  };
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('large inputs parse in linear time', () => {
  const record = bigRecord(8_000_000, 2000);

  test('a 10 MB GenBank file reads back in under 10 s', () => {
    const output = writeSequenceFile(record, 'genbank');
    const bytes = encode(output.kind === 'text' ? output.text : '');
    expect(bytes.length).toBeGreaterThan(10_000_000);
    const started = performance.now();
    const result = readSequenceFile(bytes, 'big.gb');
    const elapsed = performance.now() - started;
    expect(result.ok && result.records[0]?.seq === record.seq).toBe(true);
    expect(result.ok && result.records[0]?.features.length).toBe(2000);
    expect(elapsed).toBeLessThan(10_000);
  });

  test('a 10 MB FASTA file reads back in under 5 s', () => {
    const output = writeSequenceFile({ ...record, seq: genome(10_000_000), features: [] }, 'fasta');
    const bytes = encode(output.kind === 'text' ? output.text : '');
    const started = performance.now();
    const result = readSequenceFile(bytes, 'big.fasta');
    const elapsed = performance.now() - started;
    expect(result.ok && result.records[0]?.seq.length).toBe(10_000_000);
    expect(elapsed).toBeLessThan(5_000);
  });

  test('a 5 Mb SnapGene file writes and reads back in under 5 s', () => {
    const started = performance.now();
    const output = writeSequenceFile(
      { ...record, seq: record.seq.slice(0, 5_000_000), features: record.features.slice(0, 1000) },
      'snapgene',
    );
    const result = readSequenceFile(output.kind === 'binary' ? output.bytes : new Uint8Array(), 'big.dna');
    const elapsed = performance.now() - started;
    expect(result.ok && result.records[0]?.seq.length).toBe(5_000_000);
    expect(elapsed).toBeLessThan(5_000);
  });
});
