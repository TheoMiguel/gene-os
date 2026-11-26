import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOGO } from '../ui/logo';
import { compareSequences, summarize } from './compare';
import { buildReportPdf } from './document';
import { PdfDocument } from './pdf';
import { checkPdfStructure, englishText, fixtureRecord, withSequence } from './test-support';

const puc19 = fixtureRecord('core/puc19.fasta');
const circular = { ...puc19, name: 'pUC19', topology: 'circular' as const };

/** pUC19 with one substitution (position 501), one 5-base insertion before 1001 and one 3-base deletion at 1501. */
function variantOf(seq: string): string {
  const swapped = seq[500] === 'A' ? 'C' : 'A';
  return `${seq.slice(0, 500)}${swapped}${seq.slice(501, 1000)}GATCC${seq.slice(1000, 1500)}${seq.slice(1503)}`;
}

const META = {
  projectName: 'Lab 4: pUC19 variant',
  generated: '2026-11-26T13:00:00.000Z',
  locale: 'en',
  mode: 'global' as const,
};
const variant = withSequence(circular, 'pUC19-variant', variantOf(circular.seq));

describe('comparison data', () => {
  const data = compareSequences(circular, variant);

  it('summarises each sequence', () => {
    expect(data.a).toMatchObject({ name: 'pUC19', length: 2686, alphabet: 'dna', topology: 'circular' });
    expect(data.b.length).toBe(2686 + 5 - 3);
    const counts = data.a.composition.map((entry) => entry.count);
    expect(counts.reduce((x, y) => x + y, 0)).toBe(2686);
    // Reference: Bio.SeqUtils.gc_fraction on tests/fixtures/core/puc19.fasta.
    expect(data.a.gc).toBeCloseTo(0.5063291139240507, 10);
    expect(summarize(variant).composition.at(-1)).toMatchObject({ letter: '*', count: 0 });
  });

  it('finds the three planted differences and reports identity from the aligned columns', () => {
    if (data.alignment.status !== 'ok') throw new Error('expected an alignment');
    const { differences, counts, alignment } = data.alignment;
    expect(differences.map((d) => d.kind)).toEqual(['substitution', 'insertion', 'deletion']);
    expect(differences[0]).toMatchObject({ refStart: 500, ref: circular.seq[500] });
    expect(differences[1]?.alt).toHaveLength(5);
    expect(differences[2]?.ref).toHaveLength(3);
    expect(counts).toMatchObject({
      substitutions: 1,
      insertions: 1,
      deletions: 1,
      insertedResidues: 5,
      deletedResidues: 3,
    });
    expect(counts.transitions + counts.transversions).toBe(1);
    const { stats } = alignment;
    expect(stats.percentIdentity).toBeCloseTo((100 * stats.identical) / stats.length, 10);
    expect(stats.identical).toBe(2686 - 1 - 3);
  });

  it('maps the common enzymes: pUC19 has one EcoRI site, and the variant keeps it', () => {
    const eco = data.restriction?.find((row) => row.enzyme === 'EcoRI');
    expect(eco?.cutsA).toHaveLength(1);
    expect(eco?.cutsB).toHaveLength(1);
  });

  it('measures GC along both sequences in at most 300 windows', () => {
    expect(data.gc?.a.window).toBe(20);
    expect(data.gc?.a.y.length).toBeLessThanOrEqual(300);
    expect(data.gc?.a.y.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('refuses to align a protein against a nucleotide sequence, and skips the nucleotide-only parts', () => {
    const protein = {
      ...circular,
      alphabet: 'protein' as const,
      name: 'prot',
      seq: 'MKVLAAGIVGLLLAQ',
      topology: 'linear' as const,
    };
    const mixed = compareSequences(circular, protein);
    expect(mixed.alignment.status).toBe('incompatible');
    expect(mixed.restriction).toBeNull();
    expect(mixed.gc).toBeNull();
  });
});

describe('the PDF report', () => {
  const data = compareSequences(circular, variant);
  const bytes = buildReportPdf(data, META, englishText);

  it('is a structurally valid PDF with a title page and several pages', () => {
    const check = checkPdfStructure(bytes);
    expect(check.pages).toBeGreaterThanOrEqual(4);
  });

  it('writes valid files with unicode names and parentheses in the text', () => {
    const odd = compareSequences(
      withSequence(circular, 'pUC19 (ñandú) \\ ✓', circular.seq.slice(0, 600)),
      variant,
    );
    checkPdfStructure(buildReportPdf(odd, { ...META, projectName: 'Proyecto (año 2026) \\ ✓' }, englishText));
  });

  it('reports the alignment limit instead of failing when the sequences are too large', () => {
    const tooLarge = { ...data, alignment: { status: 'too-large' as const, cells: 9e9, limit: 4e8 } };
    checkPdfStructure(buildReportPdf(tooLarge, META, englishText));
  });

  it('refuses a document with no page', () => {
    expect(() =>
      new PdfDocument({ title: 't', author: 'a', subject: 's', created: new Date() }).toBytes(),
    ).toThrow(RangeError);
  });

  const hasPoppler = spawnSync('pdftotext', ['-v']).error === undefined;
  it.skipIf(!hasPoppler)(
    'opens in poppler and carries the project name, date, figures and differences as text',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'gene-os-report-'));
      const file = join(dir, 'report.pdf');
      writeFileSync(file, bytes);
      const info = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
      expect(info.status, info.stderr).toBe(0);
      expect(info.stdout).toMatch(/Pages:\s+\d+/);
      const text = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
      expect(text.status, text.stderr).toBe(0);
      for (const expected of [
        'GENE_OS',
        'Lab 4: pUC19 variant',
        '2026-11-26',
        'SEQUENCE COMPARISON REPORT',
        'pUC19-variant',
        'IDENTITY',
        'Substitution',
        'Insertion',
        'Deletion',
        'EcoRI',
        'GC content along each sequence',
        'Statistical summary',
      ])
        expect(text.stdout, expected).toContain(expected);
      expect(text.stdout).toMatch(/Page 2 of \d+/);
    },
  );
});

describe('the mark', () => {
  it('draws the geometry the header logo uses', () => {
    expect(LOGO.ring).toBe('M48.97 15.03A24 24 0 1 0 56 32H39');
    expect(LOGO.strands).toEqual(['M25 17Q39 24.5 25 32T25 47', 'M25 17Q11 24.5 25 32T25 47']);
  });
});
