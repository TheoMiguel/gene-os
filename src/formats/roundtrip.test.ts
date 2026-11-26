import type { Feature, SeqRecord } from '../engine/types';
import { keyOf } from './feature-keys';
import { canWrite, readSequenceFile, writeSequenceFile, writeSequenceRecords } from './index';
import { fixture, goldens } from './test-support';
import type { WritableFormat, WriteOutput } from './types';

function bytesOf(output: WriteOutput): Uint8Array {
  return output.kind === 'binary' ? output.bytes : new TextEncoder().encode(output.text);
}

function read(bytes: Uint8Array, fileName: string): readonly SeqRecord[] {
  const result = readSequenceFile(bytes, fileName);
  if (!result.ok) throw new Error(`${fileName}: ${result.error.message}`);
  return result.records;
}

function write(records: readonly SeqRecord[], format: WritableFormat): readonly SeqRecord[] {
  if (format === 'genbank' || format === 'embl' || format === 'fasta') {
    const output = writeSequenceRecords(records, format);
    return read(bytesOf(output), `written.${output.extension}`);
  }
  return records.flatMap((r) => {
    const output = writeSequenceFile(r, format);
    return read(bytesOf(output), `written.${output.extension}`);
  });
}

/** What a format carries of a feature. SnapGene has no partial ends, `order`, or between-base sites. */
function comparableFeature(feature: Feature, format: WritableFormat) {
  const insdc = format === 'genbank' || format === 'embl';
  const qualifiers = { ...feature.qualifiers };
  if (format === 'snapgene') {
    // SnapGene stores the feature name on the feature itself; reading it back adds it as /label.
    delete qualifiers.label;
    delete qualifiers.name;
  }
  return {
    key: keyOf(feature),
    type: feature.type,
    name: feature.name,
    strand: feature.location.strand,
    operator: insdc ? feature.location.operator : undefined,
    segments: feature.location.segments.map((s) => (insdc ? s : { start: s.start, end: s.end })),
    qualifiers,
    origin: feature.origin,
  };
}

/** What a format carries of a record, per the round-trip contract: sequence, topology, features, qualifiers. */
function comparable(record: SeqRecord, format: WritableFormat) {
  const base = { seq: record.seq, alphabet: record.alphabet };
  if (format === 'raw') return base;
  if (format === 'fasta') return { ...base, id: record.id };
  return {
    ...base,
    topology: record.topology,
    description: record.description.replace(/\.$/, ''),
    features: record.features.map((f) => comparableFeature(f, format)),
  };
}

function expectSame(after: readonly SeqRecord[], before: readonly SeqRecord[], format: WritableFormat) {
  expect(after.map((r) => comparable(r, format))).toEqual(before.map((r) => comparable(r, format)));
}

const readable = goldens.filter((g) => g.error === null && g.records.some((r) => !r.undefinedSequence));
const SAME_FORMAT = { genbank: 'genbank', embl: 'embl', snapgene: 'snapgene', fasta: 'fasta' } as const;

describe('read -> write -> read keeps the records', () => {
  test.each(readable.map((g) => [g.file, g.format] as const))('%s in its own format', (file, format) => {
    const before = read(fixture(file), file);
    const target: WritableFormat = format === 'abi' ? 'fasta' : SAME_FORMAT[format];
    const after = write(before, target);
    expectSame(after, before, target);
    if (target === 'genbank' || target === 'fasta') {
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    }
    if (target === 'genbank' || target === 'snapgene') {
      expect(after.map((r) => r.name)).toEqual(before.map((r) => r.name));
    }
    if (format === 'fasta') expect(after.map((r) => r.description)).toEqual(before.map((r) => r.description));
  });

  const insdc = readable.filter((g) => g.format === 'genbank' || g.format === 'embl');
  test.each(insdc.map((g) => [g.file] as const))('%s through the other INSDC format', (file) => {
    const before = read(fixture(file), file);
    const target = before[0]?.metadata.sourceFormat === 'genbank' ? 'embl' : 'genbank';
    expectSame(write(before, target), before, target);
  });

  const dna = readable.filter(
    (g) => g.format !== 'snapgene' && g.records.every((r) => r.alphabet !== 'protein'),
  );
  test.each(dna.map((g) => [g.file] as const))('%s through SnapGene and raw text', (file) => {
    const before = read(fixture(file), file);
    expect(before.every((r) => canWrite(r, 'snapgene'))).toBe(true);
    expectSame(write(before, 'snapgene'), before, 'snapgene');
    expectSame(write(before, 'raw'), before, 'raw');
  });

  test.each(readable.filter((g) => g.format === 'snapgene').map((g) => [g.file] as const))(
    '%s through GenBank',
    (file) => {
      const before = read(fixture(file), file);
      expectSame(write(before, 'genbank'), before, 'genbank');
    },
  );
});

function plasmid(features: Feature[]): SeqRecord {
  return {
    id: 'pTEST.1',
    name: 'pTEST',
    description: 'test plasmid',
    alphabet: 'dna',
    topology: 'circular',
    seq: 'ACGT'.repeat(1000),
    features,
    metadata: {},
  };
}

function userFeature(overrides: Partial<Feature>): Feature {
  return {
    id: 'u1',
    type: 'misc_feature',
    name: 'thing',
    location: { segments: [{ start: 10, end: 20 }], strand: 1 },
    origin: 'user',
    ...overrides,
  };
}

function genbankText(record: SeqRecord): string {
  const output = writeSequenceFile(record, 'genbank');
  return output.kind === 'text' ? output.text : '';
}

describe('writers', () => {
  const across = {
    segments: [
      { start: 3900, end: 4000 },
      { start: 0, end: 50 },
    ],
    strand: 1,
  } as const;
  const acrossReverse = {
    segments: [
      { start: 0, end: 50 },
      { start: 3900, end: 4000 },
    ],
    strand: -1,
  } as const;

  test('an origin-spanning feature is a join on the forward strand and complement(join) on the reverse', () => {
    const record = plasmid([
      userFeature({ id: 'a', name: 'fwd', location: across }),
      userFeature({ id: 'b', name: 'rev', location: acrossReverse }),
    ]);
    const text = genbankText(record);
    expect(text).toContain('misc_feature    join(3901..4000,1..50)');
    expect(text).toContain('misc_feature    complement(join(3901..4000,1..50))');
    for (const format of ['genbank', 'embl', 'snapgene'] as const) {
      const [back] = write([record], format);
      expect(
        back?.features.map((f) => f.location),
        format,
      ).toEqual([across, acrossReverse]);
    }
  });

  test('a user feature gets a /label with its name and its type key', () => {
    const record = plasmid([
      userFeature({
        type: 'resistance',
        name: 'AmpR',
        location: { segments: [{ start: 100, end: 961 }], strand: -1 },
      }),
    ]);
    const text = genbankText(record);
    expect(text).toContain('     CDS             complement(101..961)\n                     /label="AmpR"');
    const [back] = write([record], 'genbank');
    expect(back?.features[0]).toMatchObject({ type: 'CDS', name: 'AmpR', origin: 'file' });
  });

  test('qualifier quotes, long values and valueless qualifiers survive GenBank and EMBL', () => {
    const qualifiers = {
      note: ['He said "hi" to the "lab"', 'word '.repeat(40).trim()],
      translation: ['M'.repeat(150)],
      pseudo: [''],
      codon_start: ['1'],
    };
    const record = plasmid([
      userFeature({ type: 'CDS', name: 'gene X', qualifiers: { label: ['gene X'], ...qualifiers } }),
    ]);
    expect(genbankText(record)).toContain('/note="He said ""hi"" to the ""lab"""');
    for (const format of ['genbank', 'embl'] as const) {
      const [back] = write([record], format);
      expect(back?.features[0]?.qualifiers, format).toEqual({ label: ['gene X'], ...qualifiers });
    }
  });

  test('partial ends, order() and between-base sites are written in INSDC notation', () => {
    const record = plasmid([
      userFeature({
        id: 'p',
        location: {
          segments: [
            { start: 0, end: 30, partialStart: true },
            { start: 40, end: 60, partialEnd: true },
          ],
          strand: -1,
        },
      }),
      userFeature({
        id: 'o',
        location: {
          segments: [
            { start: 5, end: 9 },
            { start: 20, end: 22 },
          ],
          strand: 1,
          operator: 'order',
        },
      }),
      userFeature({
        id: 's',
        location: { segments: [{ start: 99, end: 101, betweenBases: true }], strand: 1 },
      }),
    ]);
    const text = genbankText(record);
    expect(text).toContain('complement(join(41..>60,<1..30))');
    expect(text).toContain('order(6..9,21..22)');
    expect(text).toContain('misc_feature    100^101');
    const [back] = write([record], 'genbank');
    expect(back?.features.map((f) => f.location)).toEqual(record.features.map((f) => f.location));
  });

  test('regulatory features keep their key and read as the class they name', () => {
    const gb = new TextEncoder().encode(
      genbankText(
        plasmid([
          userFeature({
            type: 'promoter',
            sourceKey: 'regulatory',
            name: 'Plac',
            qualifiers: { regulatory_class: ['promoter'], label: ['Plac'] },
          }),
        ]),
      ),
    );
    const [back] = read(gb, 'x.gb');
    expect(back?.features[0]).toMatchObject({ type: 'promoter', sourceKey: 'regulatory', name: 'Plac' });
    expect(new TextDecoder().decode(gb)).toContain('     regulatory      11..20');
  });

  test('FASTA lines hold 60 letters and the writers suggest an extension', () => {
    const record = plasmid([]);
    const fasta = writeSequenceFile(record, 'fasta');
    expect(fasta).toMatchObject({ kind: 'text', extension: 'fasta' });
    const lines = fasta.kind === 'text' ? fasta.text.split('\n') : [];
    expect(lines[0]).toBe('>pTEST.1 test plasmid');
    expect(lines[1]).toHaveLength(60);
    expect(writeSequenceFile(record, 'snapgene')).toMatchObject({ kind: 'binary', extension: 'dna' });
    expect(writeSequenceFile(record, 'genbank').extension).toBe('gb');
    expect(writeSequenceFile(record, 'embl').extension).toBe('embl');
    expect(writeSequenceFile(record, 'raw')).toMatchObject({
      kind: 'text',
      text: `${record.seq}\n`,
      extension: 'txt',
    });
  });

  test('a protein cannot be written as SnapGene', () => {
    const protein: SeqRecord = { ...plasmid([]), alphabet: 'protein', seq: 'MKV' };
    expect(canWrite(protein, 'snapgene')).toBe(false);
    expect(() => writeSequenceFile(protein, 'snapgene')).toThrow(RangeError);
  });
});
