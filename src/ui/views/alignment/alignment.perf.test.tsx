// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { SeqRecord } from '../../../engine/types';
import { workspace } from '../../../state/documents';
import { updateSettings } from '../../../state/settings';
import { Panel } from '../alignment';
import { AlignmentGrid } from './AlignmentGrid';
import {
  buildItems,
  classRuns,
  DEFAULT_SETUP,
  differenceColumns,
  matchLine,
  residueColumns,
  toFasta,
} from './model';

const randomDna = (n: number, seed: number) => {
  let x = seed;
  const bases = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    bases[i] = 'ACGT'[(x >>> 8) % 4] as string;
  }
  return bases.join('');
};

const record = (name: string, seq: string): SeqRecord => ({
  id: name,
  name,
  description: '',
  alphabet: 'dna',
  topology: 'linear',
  seq,
  features: [],
  metadata: {},
});

// The display and its helpers touch every column only through a window, and the exports touch each once.
describe('alignment view on a 5 Mb sequence', { timeout: 60_000 }, () => {
  const size = 5_000_000;
  const seq = randomDna(size, 5);

  afterEach(() => {
    cleanup();
    workspace.documents.value = [];
  });

  it('prepares the inputs, the column map and the exports in linear time', () => {
    const items = buildItems(
      { ...DEFAULT_SETUP, picked: ['a'], pasted: seq },
      [{ id: 'a', name: 'a', seq, protein: false, selection: null }],
      'Pasted',
    );
    expect(items.map((i) => i.seq.length)).toEqual([size, size]);
    expect(residueColumns(seq)).toHaveLength(size);
    expect(toFasta(['a'], [seq]).length).toBeGreaterThan(size);
    const classes = new Uint8Array(size).fill(0);
    classes[4_000_000] = 2;
    expect(classRuns(classes, 3_999_990, 4_000_010)).toHaveLength(3);
    expect(matchLine(classes, 0, 200)).toHaveLength(200);
    expect(
      differenceColumns(
        {
          kind: 'deletion',
          refStart: 3,
          refEnd: 5,
          altStart: 3,
          altEnd: 3,
          ref: 'AC',
          alt: '',
          terminal: false,
        },
        residueColumns('AAAAAAA'),
        residueColumns('AAA--AA'),
        0,
        0,
      ),
    ).toEqual({ from: 3, to: 5 });
  });

  it('draws only the columns on screen for a million-column alignment', () => {
    const length = 1_000_000;
    const rows = [seq.slice(0, length), seq.slice(7, length + 7)];
    const display = {
      kind: 'pair' as const,
      labels: ['a', 'b'],
      rows,
      classes: new Uint8Array(length).fill(1),
      length,
      starts: [0, 0],
    };
    const { container } = render(<AlignmentGrid display={display} reveal={null} imageName="x" />);
    const drawn = [...container.querySelectorAll('.aln-row')].reduce(
      (sum, row) => sum + (row.textContent?.length ?? 0),
      0,
    );
    expect(drawn).toBeLessThan(2_000);
    const body = container.querySelector('.aln-body') as HTMLElement;
    expect(Number.parseFloat(body.style.width)).toBeGreaterThan(1_000_000);
  });

  it('shows the limit, not a freeze, for two 5 Mb sequences', async () => {
    updateSettings({ language: 'en', mode: 'default' });
    const id = workspace.open(record('genome A', seq));
    workspace.open(record('genome B', randomDna(size, 9)));
    const doc = workspace.documents.value.find((d) => d.id === id);
    if (!doc) throw new Error('document missing');
    render(<Panel doc={doc} />);
    fireEvent.click(screen.getByLabelText(/^genome B/));
    fireEvent.click(screen.getByLabelText(/^Overlap/));
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => expect(screen.getByText('This alignment is over the size limit')).toBeTruthy(), {
      timeout: 30_000,
    });
  });
});
