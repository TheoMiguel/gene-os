// @vitest-environment jsdom
import { reverseComplement } from '../engine/alphabet';
import type { Feature, SeqRecord } from '../engine/types';
import { readSequenceText } from '../formats';
import { fixtureRecord } from '../report/test-support';
import { workspace } from '../state/documents';
import { analysisJson, analysisTables, copyTextOf, sliceRecord } from './export';

const feature = (id: string, segments: { start: number; end: number }[], strand: 1 | -1 = 1): Feature => ({
  id,
  type: 'CDS',
  name: id,
  origin: 'user',
  location: { segments, strand },
});

function record(seq: string, features: Feature[]): SeqRecord {
  const read = readSequenceText(`>pTest\n${seq}\n`);
  if (!read.ok || !read.records[0]) throw new Error('fixture failed');
  return { ...read.records[0], topology: 'circular', features };
}

describe('sliceRecord', () => {
  const source = record('ACGTACGTAC'.repeat(10), [
    feature('inside', [{ start: 20, end: 30 }]),
    feature('cut-left', [{ start: 5, end: 25 }]),
    feature('outside', [{ start: 80, end: 90 }]),
    feature('wraps', [
      { start: 95, end: 100 },
      { start: 0, end: 25 },
    ]),
  ]);
  const slice = sliceRecord(source, { start: 18, end: 40 });

  it('keeps the bases and the features that touch the range, in the range coordinates', () => {
    expect(slice.seq).toBe(source.seq.slice(18, 40));
    expect(slice.topology).toBe('linear');
    expect(slice.name).toBe('pTest_19-40');
    expect(slice.features.map((f) => f.id)).toEqual(['inside', 'cut-left', 'wraps']);
    expect(slice.features[0]?.location.segments).toEqual([{ start: 2, end: 12 }]);
  });

  it('marks a feature that the range cuts as partial at the cut', () => {
    expect(slice.features[1]?.location.segments).toEqual([{ start: 0, end: 7, partialStart: true }]);
    expect(slice.features[2]?.location.segments).toEqual([{ start: 0, end: 7, partialStart: true }]);
  });
});

describe('copyTextOf', () => {
  const dna = record('GAATTCAAATGCC', []);
  it('copies the sequence, its reverse complement and its translation', () => {
    expect(copyTextOf(dna, 'GAATTC', 'sequence')).toBe('GAATTC');
    expect(copyTextOf(dna, 'GAATTCAAA', 'reverseComplement')).toBe(reverseComplement('GAATTCAAA'));
    expect(copyTextOf(dna, 'ATGAAATAA', 'translation')).toBe('MK*');
  });
});

describe('analysis tables', () => {
  const puc19 = { ...fixtureRecord('core/puc19.fasta'), name: 'pUC19', topology: 'circular' as const };

  it('exports features, composition, restriction sites and ORFs of a whole document', async () => {
    const id = workspace.open({ ...puc19, features: [feature('bla', [{ start: 1626, end: 2486 }], -1)] });
    const doc = workspace.documents.value.find((d) => d.id === id);
    if (!doc) throw new Error('document missing');
    const tables = await analysisTables(doc);
    expect(tables.map((t) => t.id)).toEqual(['features', 'composition', 'restriction', 'orfs']);

    const features = tables[0]?.serialize('csv') ?? '';
    expect(features).toContain('Name,Type,Location,Start,End,Length,Strand,Origin,Description');
    expect(features).toContain('bla,CDS,complement(1627..2486),1627,2486,860,-1,user,');

    const composition = JSON.parse(tables[1]?.serialize('json') ?? '[]') as {
      letter: string;
      count: number;
    }[];
    expect(composition.reduce((sum, row) => sum + row.count, 0)).toBe(2686);

    const restriction = JSON.parse(tables[2]?.serialize('json') ?? '[]') as {
      enzyme: string;
      cuts: number;
      positions: string;
    }[];
    const eco = restriction.find((row) => row.enzyme === 'EcoRI');
    expect(eco).toMatchObject({ cuts: 1, positions: '396' });

    expect((tables[3]?.rowCount ?? 0) > 0).toBe(true);
    const combined = JSON.parse(analysisJson(puc19, tables)) as {
      document: { length: number };
      tables: Record<string, unknown[]>;
    };
    expect(combined.document.length).toBe(2686);
    expect(Object.keys(combined.tables)).toEqual(['features', 'composition', 'restriction', 'orfs']);
    workspace.close(id);
  });

  it('leaves the nucleotide-only tables out for a protein', async () => {
    const id = workspace.open({ ...puc19, alphabet: 'protein', seq: 'MKVLAAGIVGLLLAQ', features: [] });
    const doc = workspace.documents.value.find((d) => d.id === id);
    if (!doc) throw new Error('document missing');
    expect((await analysisTables(doc)).map((t) => t.id)).toEqual(['features', 'composition']);
    workspace.close(id);
  });
});
