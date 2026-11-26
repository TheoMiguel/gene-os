import { alignMultiple, alignPair, ColumnClass } from '../../../engine/align';
import {
  alphabetOf,
  buildItems,
  classRuns,
  DEFAULT_SETUP,
  differenceColumns,
  layoutTree,
  matchLine,
  msaDisplay,
  parsePasted,
  parseScores,
  residueColumns,
  residueNumber,
  rulerTicks,
  toClustal,
  toFasta,
  uniqueNames,
} from './model';

const setup = (patch: Partial<typeof DEFAULT_SETUP> & { picked: string[] }) => ({
  ...DEFAULT_SETUP,
  ...patch,
});

describe('pasted text', () => {
  it('reads plain letters and drops numbers, spaces and gaps', () => {
    expect(parsePasted('acg t\n12 gg-a*')).toEqual({ label: 'Pasted', seq: 'ACGTGGA' });
  });

  it('names the sequence after the first FASTA header word', () => {
    expect(parsePasted('>seq1 some description\nACGT\nACGT')).toEqual({ label: 'seq1', seq: 'ACGTACGT' });
  });

  it('gives nothing for text without letters', () => {
    expect(parsePasted('  123 \n')).toBeNull();
  });
});

describe('buildItems', () => {
  const sources = [
    { id: 'a', name: 'Alpha', seq: 'AAAACCCCGGGG', selection: { start: 4, end: 8, strand: 1 as const } },
    { id: 'b', name: 'Beta', seq: 'TTTT', selection: null },
  ];

  it('lists the picked documents in order, then the pasted sequence', () => {
    const items = buildItems(setup({ picked: ['b', 'a'], pasted: 'ACGT' }), sources);
    expect(items.map((i) => i.label)).toEqual(['Beta', 'Alpha', 'Pasted']);
  });

  it('cuts a document to its selection when asked, and names the range', () => {
    const items = buildItems(setup({ picked: ['a'], regionOnly: ['a'] }), sources);
    expect(items).toEqual([{ key: 'a', label: 'Alpha:5-8', seq: 'CCCC' }]);
  });

  it('skips a document that was closed', () => {
    expect(buildItems(setup({ picked: ['gone', 'b'] }), sources)).toHaveLength(1);
  });
});

describe('alphabetOf', () => {
  it('tells DNA, protein and a mix apart', () => {
    const item = (seq: string) => ({ key: seq, label: seq, seq });
    expect(alphabetOf([item('ACGTACGT'), item('ACGAACGT')])).toBe('dna');
    expect(alphabetOf([item('MKVLAAGIVGLLLAQ'), item('MKVLAGIVGLLLAQ')])).toBe('protein');
    expect(alphabetOf([item('ACGTACGT'), item('MKVLAAGIVGLLLAQ')])).toBe('mixed');
  });
});

describe('parseScores', () => {
  it('leaves empty fields to the engine and reads the typed ones', () => {
    const parsed = parseScores(setup({ picked: [], gapOpen: '7', match: '1' }), 'dna');
    expect(parsed).toEqual({ ok: true, options: { alphabet: 'dna', gapOpen: 7, match: 1 } });
  });

  it('refuses a negative gap penalty and a word', () => {
    const parsed = parseScores(setup({ picked: [], gapOpen: '-1', gapExtend: 'x' }), 'dna');
    expect(parsed).toEqual({ ok: false, invalid: ['gapOpen', 'gapExtend'] });
  });

  it('passes the matrix for protein only', () => {
    const parsed = parseScores(setup({ picked: [], matrix: 'PAM250' }), 'protein');
    expect(parsed.ok && parsed.options.matrix).toBe('PAM250');
  });
});

describe('column helpers', () => {
  it('collapses equal classes into runs inside a window', () => {
    const classes = Uint8Array.from([0, 0, 2, 2, 2, 3, 0]);
    expect(classRuns(classes, 1, 6)).toEqual([
      { from: 1, to: 2, cls: 0 },
      { from: 2, to: 5, cls: 2 },
      { from: 5, to: 6, cls: 3 },
    ]);
    expect(classRuns(classes, 3, 3)).toEqual([]);
  });

  it('labels every tenth column with its 1-based number', () => {
    expect(rulerTicks(0, 25)).toEqual([9, 19]);
    expect(rulerTicks(10, 20)).toEqual([19]);
  });

  it('draws the match line from the classes', () => {
    expect(matchLine(Uint8Array.from([0, 1, 2, 3]), 0, 4)).toBe('|:. ');
  });

  it('numbers residues around gaps', () => {
    expect(residueNumber('AC--GT', 4)).toBe(3);
    expect(residueNumber('AC--GT', 2)).toBeNull();
    expect(residueNumber('AC--GT', 4, 100)).toBe(103);
    expect(Array.from(residueColumns('AC--GT'))).toEqual([0, 1, 4, 5]);
  });
});

describe('differences to columns', () => {
  const a = 'ACGTACGTAAGGCC';
  const b = 'ACGTTCGTACCAAGGCC';
  const result = alignPair(a, b, { mode: 'global' });
  if (result.status !== 'ok') throw new Error('expected an alignment');
  const { alignment } = result;
  const colsA = residueColumns(alignment.alignedA);
  const colsB = residueColumns(alignment.alignedB);

  it('finds the column of every difference in the aligned rows', () => {
    expect(alignment.differences.length).toBeGreaterThan(0);
    for (const d of alignment.differences) {
      const { from, to } = differenceColumns(d, colsA, colsB, alignment.startA, alignment.startB);
      expect(to).toBeGreaterThan(from);
      const refSlice = alignment.alignedA.slice(from, to);
      const altSlice = alignment.alignedB.slice(from, to);
      if (d.kind === 'substitution') expect([refSlice, altSlice]).toEqual([d.ref, d.alt]);
      if (d.kind === 'insertion') expect([refSlice, altSlice]).toEqual(['-'.repeat(d.alt.length), d.alt]);
      if (d.kind === 'deletion') expect([refSlice, altSlice]).toEqual([d.ref, '-'.repeat(d.ref.length)]);
    }
  });
});

describe('text exports', () => {
  const rows = ['AC-GT', 'ACAGT', 'ACAGA'];
  const classes = Uint8Array.from([0, 0, 3, 0, 2]);

  it('writes FASTA with unique safe names', () => {
    expect(toFasta(['seq one', 'seq one', 'x'], rows)).toBe(
      '>seq_one\nAC-GT\n>seq_one_2\nACAGT\n>x\nACAGA\n',
    );
  });

  it('wraps FASTA lines at 60 columns', () => {
    const long = 'A'.repeat(130);
    expect(
      toFasta(['a'], [long])
        .split('\n')
        .map((l) => l.length),
    ).toEqual([2, 60, 60, 10, 0]);
  });

  it('writes Clustal blocks with a conservation line', () => {
    const text = toClustal(['a', 'b', 'c'], rows, classes);
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^CLUSTAL/);
    expect(lines[2]).toBe(`${'a'.padEnd(17)}AC-GT`);
    expect(lines[5]).toBe(`${' '.repeat(17)}** * `);
  });

  it('makes names unique even when they collide after truncation', () => {
    const long = 'x'.repeat(40);
    const names = uniqueNames([long, long]);
    expect(new Set(names).size).toBe(2);
    expect(names.every((n) => n.length <= 30)).toBe(true);
  });
});

describe('multiple alignment display', () => {
  it('adds a consensus the same length as the alignment, and conservation per column', () => {
    const result = alignMultiple(['ACGTACGTAC', 'ACGTACGTAC', 'ACGAACGTAC'], { alphabet: 'dna' });
    if (result.status !== 'ok') throw new Error('expected an alignment');
    const display = msaDisplay(result.alignment, ['a', 'b', 'c']);
    expect(display.consensus).toHaveLength(display.length);
    expect(display.conservation).toHaveLength(display.length);
    expect(display.classes.filter((c) => c === ColumnClass.Identical).length).toBe(9);
  });
});

describe('layoutTree', () => {
  it('draws one bar per internal node and one leaf per sequence, with the root at the left', () => {
    const result = alignMultiple(['ACGTACGTACGT', 'ACGTACGTACGA', 'TTTTACGTAGGG', 'TTTTACGTAGGC'], {
      alphabet: 'dna',
    });
    if (result.status !== 'ok') throw new Error('expected an alignment');
    const layout = layoutTree(result.alignment.guideTree);
    expect(layout.paths).toHaveLength(3);
    expect(layout.leaves.map((l) => l.index).sort()).toEqual([0, 1, 2, 3]);
    expect(new Set(layout.leaves.map((l) => l.x)).size).toBe(1);
    expect(layout.leaves.map((l) => l.y)).toEqual([...layout.leaves.map((l) => l.y)].sort((x, y) => x - y));
  });
});
