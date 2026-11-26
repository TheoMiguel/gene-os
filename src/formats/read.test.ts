import { readSequenceFile, readSequenceText } from './index';
import { fixture, goldens } from './test-support';

const encode = (text: string) => new TextEncoder().encode(text);

describe('readSequenceText', () => {
  test('raw sequence with position numbers and spaces becomes one record', () => {
    const result = readSequenceText('1 atgaaa cccggg\n13 ttt\n');
    expect(result).toMatchObject({ ok: true, format: 'raw' });
    expect(result.ok && result.records[0]).toMatchObject({
      seq: 'ATGAAACCCGGGTTT',
      alphabet: 'dna',
      topology: 'linear',
    });
  });

  test('raw protein and raw RNA are told apart from DNA by their letters', () => {
    const protein = readSequenceText('MKVLAAGIVGLLLA');
    expect(protein.ok && protein.records[0]?.alphabet).toBe('protein');
    const rna = readSequenceText('AUGGCCUAA');
    expect(rna.ok && rna.records[0]?.alphabet).toBe('rna');
  });

  test('pasted FASTA and GenBank are recognised by their first line', () => {
    expect(readSequenceText('>seq1 first\nACGT\n>seq2\nGGCC\n')).toMatchObject({
      ok: true,
      format: 'fasta',
      records: [
        { id: 'seq1', description: 'seq1 first', seq: 'ACGT' },
        { id: 'seq2', seq: 'GGCC' },
      ],
    });
    const genbank = new TextDecoder().decode(fixture('pBAD30.gb'));
    expect(readSequenceText(genbank)).toMatchObject({ ok: true, format: 'genbank' });
  });

  test('text that is not a sequence is refused with a typed error', () => {
    expect(readSequenceText('')).toMatchObject({ ok: false, error: { code: 'empty' } });
    expect(readSequenceText('   \n ')).toMatchObject({ ok: false, error: { code: 'empty' } });
    expect(readSequenceText('Hello, world!')).toMatchObject({ ok: false, error: { code: 'unknown_format' } });
  });
});

describe('readSequenceFile', () => {
  test('content wins over a misleading extension', () => {
    expect(readSequenceFile(fixture('pBAD30.gb'), 'plasmid.fasta')).toMatchObject({
      ok: true,
      format: 'genbank',
    });
    expect(readSequenceFile(fixture('sample-e.dna'), 'trace.ab1')).toMatchObject({
      ok: true,
      format: 'snapgene',
    });
    expect(readSequenceFile(fixture('310.ab1'), 'notes.txt')).toMatchObject({ ok: true, format: 'ab1' });
  });

  test('the extension decides when the content does not', () => {
    expect(readSequenceFile(encode('ACGT ACGT\n'), 'x.txt')).toMatchObject({ ok: true, format: 'raw' });
    expect(readSequenceFile(fixture('fake.ab1'), 'fake.ab1')).toMatchObject({
      ok: false,
      format: 'ab1',
      error: { code: 'malformed' },
    });
    expect(readSequenceFile(encode('not a snapgene file'), 'x.dna')).toMatchObject({
      ok: false,
      format: 'snapgene',
      error: { code: 'malformed' },
    });
  });

  test('binary data of no known format is refused', () => {
    expect(readSequenceFile(new Uint8Array([0, 1, 2, 3, 0, 255]), 'blob.bin')).toMatchObject({
      ok: false,
      error: { code: 'unknown_format' },
    });
    expect(readSequenceFile(new Uint8Array(), 'x.gb')).toMatchObject({ ok: false, error: { code: 'empty' } });
  });

  test('a GenBank file without sequence data is a no_sequence error', () => {
    expect(readSequenceFile(fixture('bad_origin_wrap.gb'), 'bad_origin_wrap.gb')).toMatchObject({
      ok: false,
      format: 'genbank',
      error: { code: 'no_sequence' },
    });
  });

  test('repairs are reported as warnings: an origin-spanning location written as start > end', () => {
    const result = readSequenceFile(fixture('bad_origin_wrap_CDS.gb'), 'bad_origin_wrap_CDS.gb');
    expect(result.warnings.map((w) => w.code)).toContain('location_fixed');
    expect(result.warnings.find((w) => w.code === 'location_fixed')?.line).toBeGreaterThan(0);
  });

  test('the file name names records that carry none (AB1 without a sample name)', () => {
    const result = readSequenceFile(fixture('no_smpl1.ab1'), 'folder/no_smpl1.ab1');
    expect(result.ok && result.records[0]).toMatchObject({ id: 'no_smpl1', name: 'no_smpl1' });
  });

  test('an AB1 trace carries channels, peaks and quality aligned with the bases', () => {
    const result = readSequenceFile(fixture('310.ab1'), '310.ab1');
    const record = result.ok ? result.records[0] : undefined;
    expect(record?.trace?.peakPositions).toHaveLength(record?.seq.length ?? -1);
    expect(record?.trace?.quality).toHaveLength(record?.seq.length ?? -1);
    const lengths = new Set(Object.values(record?.trace?.channels ?? {}).map((c) => c.length));
    expect(lengths.size).toBe(1);
  });
});

describe('damaged files never throw', () => {
  // Truncations and byte flips of every fixture, from a fixed seed so failures reproduce.
  function* damaged(bytes: Uint8Array): Generator<Uint8Array> {
    for (const fraction of [0.01, 0.1, 0.33, 0.5, 0.9, 0.999])
      yield bytes.subarray(0, Math.floor(bytes.length * fraction));
    let seed = 12345;
    for (let n = 0; n < 8; n++) {
      const copy = bytes.slice();
      for (let k = 0; k < 16; k++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        copy[seed % copy.length] = seed & 0xff;
      }
      yield copy;
    }
  }

  test.each(goldens.map((g) => [g.file] as const))('%s', (file) => {
    for (const bytes of damaged(fixture(file))) {
      const result = readSequenceFile(bytes, file);
      if (!result.ok)
        expect(['empty', 'unknown_format', 'malformed', 'no_sequence']).toContain(result.error.code);
    }
  });
});
