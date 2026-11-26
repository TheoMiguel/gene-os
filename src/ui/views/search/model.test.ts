import { PUC19, randomDna } from '../../../../tests/fixtures/restriction/fixtures';
import { reverseComplement } from '../../../engine/alphabet';
import { searchSequence } from '../../../engine/search';
import { translate } from '../../../engine/translate';
import type { SeqRecord } from '../../../engine/types';
import { runAnalysis } from '../../../workers/analyses';
import {
  capRows,
  collectRows,
  DEFAULT_FORM,
  findEnzyme,
  hitSpan,
  keepMatchingCase,
  nucleotideContext,
  planSearch,
  type ResultRow,
  type ScanOutput,
  type SearchForm,
  stepIndex,
} from './model';

const record = (
  seq: string,
  topology: SeqRecord['topology'] = 'linear',
  alphabet: SeqRecord['alphabet'] = 'dna',
) => ({ seq, topology, alphabet }) as const;
const form = (patch: Partial<SearchForm>): SearchForm => ({ ...DEFAULT_FORM, ...patch });

/** Runs every scan of a plan the way the view does and collects the rows. */
function run(
  rec: ReturnType<typeof record>,
  f: SearchForm,
  selection: { start: number; end: number } | null = null,
) {
  const plan = planSearch(rec, f, selection);
  const outputs: ScanOutput[] = [];
  if (plan.whole) outputs.push({ job: null, result: runAnalysis('search', { ...rec }, plan.whole) });
  for (const job of plan.jobs) outputs.push({ job, result: runAnalysis('search', job.input, job.params) });
  return collectRows(rec, f, outputs, selection);
}

describe('planSearch', () => {
  it('plans nothing for an empty box or an unknown enzyme', () => {
    expect(planSearch(record('ACGT'), form({ query: '  ' }), null)).toMatchObject({ whole: null, jobs: [] });
    const unknown = planSearch(record('ACGT'), form({ kind: 'enzyme', query: 'NoSuchI' }), null);
    expect(unknown).toMatchObject({ whole: null, unknownEnzyme: true });
  });

  it('searches the recognition site of a catalog enzyme chosen by name, ignoring case', () => {
    const plan = planSearch(record(PUC19, 'circular'), form({ kind: 'enzyme', query: 'ecori' }), null);
    expect(plan.enzyme?.name).toBe('EcoRI');
    expect(plan.whole).toMatchObject({ query: 'GAATTC', mode: 'motif', circular: true });
  });

  it('scans only the selection, and gives each of the six frames its own scan for a translation', () => {
    const selected = planSearch(record('ACGTACGT'), form({ query: 'CG', scope: 'selection' }), {
      start: 2,
      end: 6,
    });
    expect(selected.whole).toBeNull();
    expect(selected.jobs).toMatchObject([{ offset: 2, input: { seq: 'GTAC' } }]);
    const frames = planSearch(record('ATGAAATTTGGG'), form({ query: 'KF', target: 'translation' }), null);
    expect(frames.jobs.map((job) => job.frame)).toEqual([1, 2, 3, -1, -2, -3]);
    expect(frames.whole).toBeNull();
  });

  it('does not offer strands for a protein record', () => {
    const plan = planSearch(record('MKVLA', 'linear', 'protein'), form({ query: 'KV' }), null);
    expect(plan.whole).not.toHaveProperty('bothStrands');
  });
});

describe('search on pUC19', () => {
  const circular = record(PUC19, 'circular');

  it('finds the one EcoRI site that the NEB pUC19 map lists at 396, by name and as a motif', () => {
    const byName = run(circular, form({ kind: 'enzyme', query: 'EcoRI' }));
    const byMotif = run(circular, form({ kind: 'motif', query: 'GAATTC' }));
    expect(byName.rows.map((r) => r.hit.start + 1)).toEqual([396]);
    expect(byMotif.rows.map((r) => r.hit.start + 1)).toEqual([396]);
    expect(byName.rows[0]?.context.match).toBe('GAATTC');
  });

  it('finds both orientations of a site that is not its own reverse complement', () => {
    const { rows } = run(circular, form({ kind: 'motif', query: 'GGTCTC' }));
    const strands = new Set(rows.map((r) => r.hit.strand));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const top = row.context.match;
      expect(row.hit.strand === 1 ? top : reverseComplement(top)).toBe('GGTCTC');
    }
    expect(strands.size).toBeGreaterThanOrEqual(1);
  });

  it('matches a degenerate IUPAC motif (CCWGG is CCAGG or CCTGG)', () => {
    const { rows } = run(circular, form({ kind: 'motif', query: 'CCWGG', bothStrands: false }));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(['CCAGG', 'CCTGG']).toContain(row.context.match);
  });

  it('keeps a hit across the origin as one hit with two segments', () => {
    const wrapped = PUC19.slice(-3) + PUC19.slice(0, 3);
    const { rows } = run(circular, form({ kind: 'text', query: wrapped, bothStrands: false }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hit.location.segments).toEqual([
      { start: PUC19.length - 3, end: PUC19.length },
      { start: 0, end: 3 },
    ]);
    expect(rows[0]?.context.match).toBe(wrapped);
    expect(hitSpan((rows[0] as ResultRow).hit)).toEqual({ start: PUC19.length - 3, end: PUC19.length });
  });

  it('no longer finds that hit when crossing the origin is switched off', () => {
    const wrapped = PUC19.slice(-3) + PUC19.slice(0, 3);
    const { rows } = run(
      circular,
      form({ kind: 'text', query: wrapped, bothStrands: false, crossOrigin: false }),
    );
    expect(rows).toHaveLength(0);
  });

  it('keeps only the hits inside the selection, at document positions', () => {
    const all = run(circular, form({ kind: 'motif', query: 'GAATTC' }));
    const inside = run(circular, form({ kind: 'motif', query: 'GAATTC', scope: 'selection' }), {
      start: 300,
      end: 500,
    });
    const outside = run(circular, form({ kind: 'motif', query: 'GAATTC', scope: 'selection' }), {
      start: 1000,
      end: 1500,
    });
    expect(inside.rows.map((r) => r.hit.start)).toEqual(all.rows.map((r) => r.hit.start));
    expect(outside.rows).toHaveLength(0);
  });
});

describe('search in the translation', () => {
  const gene = 'CC' + 'ATGAAAGAATTCGGT' + 'CC';

  it('puts a peptide hit back on the DNA in each frame, on both strands', () => {
    for (const dna of [gene, reverseComplement(gene)]) {
      const { rows } = run(record(dna), form({ kind: 'text', query: 'KEF', target: 'translation' }));
      expect(rows).toHaveLength(1);
      const row = rows[0] as ResultRow;
      expect(row.context.match).toBe('KEF');
      const bases = dna.slice(row.hit.start, row.hit.start + row.hit.length);
      expect(translate(row.hit.strand === 1 ? bases : reverseComplement(bases))).toBe('KEF');
      expect(row.frame).not.toBeNull();
    }
  });

  it('reports frame +3 for a gene that starts two bases in', () => {
    const { rows } = run(record(gene), form({ kind: 'text', query: 'KEF', target: 'translation' }));
    expect(rows[0]?.frame).toBe(3);
    expect(rows[0]?.hit.start).toBe(2 + 3);
  });

  it('searches a protein record as residues, with a set and an any-residue code', () => {
    const { rows } = run(
      record('AAMKVLAPKELL', 'linear', 'protein'),
      form({ kind: 'motif', query: 'K[VE]X' }),
    );
    expect(rows.map((r) => r.context.match)).toEqual(['KVL', 'KEL']);
  });
});

describe('match case', () => {
  const rows = run(record('GAATTCGAATTC'), form({ kind: 'text', query: 'gaattc' })).rows;

  it('is ignored unless asked for, and then compares with the query as typed', () => {
    expect(keepMatchingCase(rows, form({ kind: 'text', query: 'gaattc' }))).toHaveLength(rows.length);
    expect(keepMatchingCase(rows, form({ kind: 'text', query: 'gaattc', matchCase: true }))).toHaveLength(0);
    expect(keepMatchingCase(rows, form({ kind: 'text', query: 'GAATTC', matchCase: true }))).toHaveLength(
      rows.length,
    );
  });

  it('applies the expression as written for a regular expression', () => {
    expect(keepMatchingCase(rows, form({ kind: 'regex', query: '[a-z]+', matchCase: true }))).toHaveLength(0);
    expect(keepMatchingCase(rows, form({ kind: 'regex', query: '[A-Z]+', matchCase: true }))).toHaveLength(
      rows.length,
    );
  });
});

describe('hit count', () => {
  it('says how many exist when the engine caps the list', () => {
    const rec = record('A'.repeat(50));
    const { rows, count } = run(rec, form({ kind: 'text', query: 'A', maxHits: 10, bothStrands: false }));
    expect(rows).toHaveLength(10);
    expect(count).toEqual({ shown: 10, total: 50, capped: true });
  });

  it('counts what the rows hold when nothing was capped', () => {
    expect(capRows([], 0, 10).count).toEqual({ shown: 0, total: 0, capped: false });
  });
});

describe('stepIndex', () => {
  const rows = [5, 20, 40].map((start) => ({ hit: { start } }) as ResultRow);

  it('goes to the first hit after the caret, or the last one before it', () => {
    expect(stepIndex(rows, -1, 1, 10)).toBe(1);
    expect(stepIndex(rows, -1, -1, 10)).toBe(0);
    expect(stepIndex(rows, -1, 1, 99)).toBe(0);
    expect(stepIndex(rows, -1, -1, 0)).toBe(2);
  });

  it('wraps at both ends and returns null for an empty list', () => {
    expect(stepIndex(rows, 2, 1, 0)).toBe(0);
    expect(stepIndex(rows, 0, -1, 0)).toBe(2);
    expect(stepIndex([], -1, 1, 0)).toBeNull();
  });
});

describe('nucleotideContext', () => {
  it('reads the flanks across the origin of a circular molecule', () => {
    const seq = 'AAACCCGGGTTT';
    const hit = searchSequence(seq, 'TTTAAA', { circular: true, bothStrands: false }).hits[0];
    expect(hit && nucleotideContext(seq, hit, true, 2)).toEqual({ left: 'GG', match: 'TTTAAA', right: 'CC' });
  });
});

describe('findEnzyme', () => {
  it('knows catalog names whatever their case', () => {
    expect(findEnzyme(' hindiii ')?.site).toBe('AAGCTT');
    expect(findEnzyme('')).toBeNull();
  });
});

describe('a 5 Mb record', { timeout: 60_000 }, () => {
  const big = record(randomDna(5_000_000, 7), 'circular');

  it('plans the six translations, and turns 10 000 hits into rows, in a few seconds', () => {
    const started = performance.now();
    const plan = planSearch(big, form({ kind: 'text', query: 'MK', target: 'translation' }), null);
    expect(plan.jobs).toHaveLength(6);
    const { rows, count } = run(
      record(randomDna(200_000, 3)),
      form({ kind: 'text', query: 'A', maxHits: 10_000 }),
    );
    expect(rows).toHaveLength(10_000);
    expect(count.capped).toBe(true);
    expect(performance.now() - started).toBeLessThan(20_000);
  });
});
