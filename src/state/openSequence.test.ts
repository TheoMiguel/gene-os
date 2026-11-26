import { parseRawDna } from './openSequence';

describe('parseRawDna (stub loader until the format readers land)', () => {
  it('builds a linear DNA record from FASTA, named after the header', () => {
    const result = parseRawDna('>pTest demo plasmid\nacgt nnac\n10 GGCC\n');
    expect(result).toMatchObject({
      ok: true,
      record: {
        name: 'pTest',
        description: 'pTest demo plasmid',
        seq: 'ACGTNNACGGCC',
        alphabet: 'dna',
        topology: 'linear',
      },
    });
  });

  it('reads RNA when the sequence has U and no T', () => {
    expect(parseRawDna('ACGUACGU')).toMatchObject({ ok: true, record: { alphabet: 'rna' } });
  });

  it('prefers an explicit name, e.g. the file name', () => {
    expect(parseRawDna('ACGT', 'clone7')).toMatchObject({ ok: true, record: { name: 'clone7' } });
  });

  it('reports empty input, non-nucleotide text and accessions', () => {
    expect(parseRawDna('  \n')).toEqual({ ok: false, error: 'empty' });
    expect(parseRawDna('>only a header')).toEqual({ ok: false, error: 'empty' });
    expect(parseRawDna('hello world')).toEqual({ ok: false, error: 'invalidCharacters' });
    expect(parseRawDna('L09137.2')).toEqual({ ok: false, error: 'accessionNeedsNetwork' });
    expect(parseRawDna('NC_000913')).toEqual({ ok: false, error: 'accessionNeedsNetwork' });
  });
});
