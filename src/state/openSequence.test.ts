import { loadText, MAX_RECORDS_PER_INPUT } from './openSequence';

describe('loadText', () => {
  it('reads pasted FASTA through the format readers', () => {
    const result = loadText('>pTest demo plasmid\nacgtnnac\nGGCC\n');
    expect(result).toMatchObject({
      ok: true,
      notOpened: 0,
      records: [{ name: 'pTest', description: 'pTest demo plasmid', seq: 'ACGTNNACGGCC', alphabet: 'dna' }],
    });
  });

  it('reads raw sequence text with digits and whitespace', () => {
    expect(loadText('  1 acgt acgt\n 9 ggcc\n')).toMatchObject({
      ok: true,
      records: [{ seq: 'ACGTACGTGGCC', alphabet: 'dna', topology: 'linear' }],
    });
  });

  it('reads a circular GenBank record with its features', () => {
    const genbank = [
      'LOCUS       demo                      12 bp    DNA     circular SYN 01-JAN-2020',
      'DEFINITION  demo record.',
      'FEATURES             Location/Qualifiers',
      '     misc_feature    1..6',
      '                     /label="part"',
      'ORIGIN',
      '        1 acgtnnacgg cc',
      '//',
      '',
    ].join('\n');
    expect(loadText(genbank)).toMatchObject({
      ok: true,
      records: [{ name: 'demo', topology: 'circular', features: [{ name: 'part' }] }],
    });
  });

  it('opens every record of a multi-record file', () => {
    const fasta = ['>a', 'ACGT', '>b', 'TTGG', '>c', 'CCAA', ''].join('\n');
    const result = loadText(fasta);
    expect(result.ok && result.records.map((record) => record.name)).toEqual(['a', 'b', 'c']);
  });

  it('caps a very large multi-record file and reports the rest', () => {
    const count = MAX_RECORDS_PER_INPUT + 7;
    const fasta = Array.from({ length: count }, (_, i) => `>c${i}\nACGTACGT`).join('\n');
    const result = loadText(fasta);
    expect(result).toMatchObject({ ok: true, notOpened: 7 });
    expect(result.ok && result.records).toHaveLength(MAX_RECORDS_PER_INPUT);
  });

  it('reports empty input, unreadable text and bare accessions', () => {
    expect(loadText('  \n')).toEqual({ ok: false, error: 'empty' });
    expect(loadText('L09137.2')).toEqual({ ok: false, error: 'accessionNeedsNetwork' });
    expect(loadText('NC_000913')).toEqual({ ok: false, error: 'accessionNeedsNetwork' });
    expect(loadText('hello, world! 42% of notes are not sequences.')).toEqual({
      ok: false,
      error: 'unknownFormat',
    });
  });

  it('reads a bare peptide, because prose made only of residue letters is a valid paste', () => {
    expect(loadText('MKWVTFISLLFLFSSAYS')).toMatchObject({
      ok: true,
      records: [{ alphabet: 'protein', seq: 'MKWVTFISLLFLFSSAYS' }],
    });
  });
});
