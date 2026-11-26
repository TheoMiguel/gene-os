// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { PUC19, randomDna } from '../../../../tests/fixtures/restriction/fixtures';
import type { SeqRecord } from '../../../engine/types';
import { clearAnalysisCache, setAnalysisBackend } from '../../../state/analysis';
import { type SeqDocument, workspace } from '../../../state/documents';
import { updateSettings } from '../../../state/settings';
import { historyOf, viewOf } from '../../../state/view';
import type { AnalysisBackend, AnalysisJob, AnalysisOutcome } from '../../../workers/client';
import { createInlineBackend } from '../../../workers/client';
import { notice } from '../../actions';
import { Panel } from '../summary';

const dna = (seq: string, patch: Partial<SeqRecord> = {}): SeqRecord => ({
  id: 'r1',
  name: 'sample',
  description: 'A sample record',
  alphabet: 'dna',
  topology: 'linear',
  seq,
  features: [],
  metadata: { sourceFormat: 'fasta' },
  ...patch,
});

const PROTEIN = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVV';

/** Renders the Panel for whatever the workspace holds now, so an edit of the record re-renders it. */
function Host({ id }: { id: string }) {
  const doc = workspace.documents.value.find((d) => d.id === id) as SeqDocument;
  return <Panel doc={doc} />;
}

const open = (record: SeqRecord) => {
  const id = workspace.open(record);
  render(<Host id={id} />);
  return id;
};

/** A backend that runs every scan inline except those of `kind`, which fail with `reason`. */
function failing(kind: AnalysisJob['kind'], reason: string): AnalysisBackend {
  const inline = createInlineBackend();
  return {
    start(job, done) {
      if (job.kind !== kind) return inline.start(job, done);
      done({ ok: false, reason });
      return () => {};
    },
  };
}

const card = (id: string) => document.querySelector(`[data-kpi="${id}"]`) as HTMLElement;
const cardValue = (id: string) => card(id).querySelector('.kpi-val')?.textContent?.trim();

function deferredBackend() {
  const jobs: { job: AnalysisJob; done: (o: AnalysisOutcome) => void }[] = [];
  const backend: AnalysisBackend = {
    start(job, done) {
      jobs.push({ job, done });
      return () => {};
    },
  };
  const inline = createInlineBackend();
  const settle = (kind?: AnalysisJob['kind']) => {
    for (const entry of jobs.splice(0)) {
      if (kind && entry.job.kind !== kind) {
        jobs.push(entry);
        continue;
      }
      inline.start(entry.job, entry.done);
    }
  };
  return { backend, settle, jobs };
}

beforeEach(() => {
  updateSettings({ language: 'en', mode: 'default' });
  setAnalysisBackend(createInlineBackend());
});
afterEach(() => {
  cleanup();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
  setAnalysisBackend(null);
  clearAnalysisCache();
  notice.value = null;
});

describe('Summary of a DNA record', () => {
  it('shows length, type, GC, weight and the pI of the longest ORF with units', () => {
    open(dna(PUC19));
    expect(cardValue('length')).toBe('2,686 bp');
    expect(cardValue('type')).toBe('DNA');
    expect(cardValue('gc')).toMatch(/^5\d\.\d%$/);
    expect(cardValue('weight')).toMatch(/kDa$|MDa$/);
    expect(cardValue('pi')).toMatch(/^\d+\.\d\d$/);
    expect(card('pi').textContent).toContain('Longest ORF');
  });

  it('describes the record and says the organism call is an inference', () => {
    open(
      dna(PUC19, {
        description: 'pUC19 cloning vector',
        metadata: { sourceFormat: 'fasta', accession: 'L09137.2' },
      }),
    );
    expect(screen.getByText('pUC19 cloning vector')).toBeTruthy();
    expect(screen.getByText('L09137.2')).toBeTruthy();
    expect(screen.getByText(/not an identification/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Synthetic vector or plasmid' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /circular plasmid/ })).toBeTruthy();
  });

  it('infers a circular topology for a FASTA plasmid, labels it, and writes the choice to the record undoably', () => {
    const id = open(dna(PUC19));
    expect(cardValue('topology')).toBe('Circular');
    expect(card('topology').textContent).toContain('Inferred: vector parts found');
    expect(workspace.documents.value[0]?.record.topology).toBe('linear');
    expect(screen.getByText(/still Linear/)).toBeTruthy();

    fireEvent.click(within(card('topology')).getByRole('button', { name: 'Circular' }));
    expect(workspace.documents.value[0]?.record.topology).toBe('circular');
    expect(card('topology').textContent).toContain('Set by you');

    fireEvent.click(within(card('topology')).getByRole('button', { name: 'Linear' }));
    expect(workspace.documents.value[0]?.record.topology).toBe('linear');
    expect(cardValue('topology')).toBe('Linear');

    act(() => {
      expect(historyOf(id).undo()).toBe(true);
    });
    expect(workspace.documents.value[0]?.record.topology).toBe('circular');
    act(() => {
      expect(historyOf(id).undo()).toBe(true);
    });
    expect(workspace.documents.value[0]?.record.topology).toBe('linear');
    expect(card('topology').textContent).toContain('Inferred');
  });

  it('shows the topology a GenBank file states and offers no override outside advanced mode', () => {
    open(dna(PUC19, { topology: 'circular', metadata: { sourceFormat: 'genbank' } }));
    expect(cardValue('topology')).toBe('Circular');
    expect(card('topology').textContent).toContain('Stated by the file');
    expect(within(card('topology')).queryByRole('button')).toBeNull();
  });

  it('offers the override for a stated topology in advanced mode', () => {
    updateSettings({ mode: 'advanced' });
    open(dna(PUC19, { topology: 'circular', metadata: { sourceFormat: 'genbank' } }));
    expect(within(card('topology')).getAllByRole('button')).toHaveLength(2);
  });

  it('lists the composition as a table and draws the strip and the chart', () => {
    open(dna('AACCGGTTAA'.repeat(10)));
    const table = screen.getByRole('grid', { name: 'Composition table' });
    expect(within(table).getAllByRole('row').length).toBeGreaterThanOrEqual(5);
    expect(
      screen.getByRole('img', { name: /Base composition strip: A 40\.0%, C 20\.0%, G 20\.0%, T 20\.0%/ }),
    ).toBeTruthy();
    expect(screen.getByRole('application', { name: 'Nucleotide composition' })).toBeTruthy();
  });

  it('plots GC content and GC skew, and keeps the window out of default mode', () => {
    open(dna(PUC19));
    expect(screen.getByLabelText('GC content')).toBeTruthy();
    expect(screen.getByLabelText('GC skew')).toBeTruthy();
    expect(screen.queryByLabelText(/Window size/)).toBeNull();
  });

  it('gives advanced mode the window size, with its default derived from the length, and the cumulative skew', () => {
    updateSettings({ mode: 'advanced' });
    open(dna(PUC19));
    const field = screen.getByLabelText('Window size (bp)') as HTMLInputElement;
    expect(field.value).toBe('20');
    fireEvent.input(field, { target: { value: '100' } });
    fireEvent.blur(field);
    expect((screen.getByLabelText('Window size (bp)') as HTMLInputElement).value).toBe('100');
    expect(screen.getByText(/Cumulative GC skew/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Default (20)' }));
    expect((screen.getByLabelText('Window size (bp)') as HTMLInputElement).value).toBe('20');
  });

  it('opens the Sequence view at a detected feature when its row is clicked', async () => {
    const id = open(dna(PUC19));
    const table = await screen.findByRole('grid', { name: 'Detected features' });
    const rows = within(table)
      .getAllByRole('row')
      .filter((row) => row.classList.contains('table-row'));
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0] as HTMLElement);
    expect(workspace.documents.value.find((d) => d.id === id)?.activeTab).toBe('sequence');
    expect(viewOf(id).caret.value).toBeGreaterThanOrEqual(0);
    expect(viewOf(id).revealRequest.value).not.toBeNull();
  });

  it('lets the user pick another ORF for the translation properties', () => {
    open(dna(PUC19));
    const picker = screen.getByLabelText('Translation') as HTMLSelectElement;
    expect(picker.options.length).toBeGreaterThan(1);
    fireEvent.change(picker, { target: { value: '1' } });
    expect(screen.getByRole('grid', { name: 'Protein properties' })).toBeTruthy();
  });

  it('looks right for a 20 bp sequence', () => {
    open(dna('ACGTACGTAAGGCCTTAACG'));
    expect(cardValue('length')).toBe('20 bp');
    expect(screen.getByRole('heading', { name: 'Not enough to tell' })).toBeTruthy();
    expect(screen.getByText(/too short to place by composition/)).toBeTruthy();
    expect(cardValue('pi')).toBe('—');
    expect(screen.getByText(/No ORF of 30 codons or more/)).toBeTruthy();
    expect(screen.getByLabelText('GC content')).toBeTruthy();
  });

  it('says a one-base sequence is too short to chart', () => {
    open(dna('A'));
    expect(screen.getByText('The sequence is too short to chart.')).toBeTruthy();
  });

  it('handles ambiguity codes in the type card and the composition', () => {
    open(dna('ACGTNNNNACGT'.repeat(5)));
    expect(card('type').textContent).toContain('20 other characters');
  });

  it('formats numbers in the interface language', () => {
    updateSettings({ language: 'es' });
    open(dna(PUC19));
    expect(cardValue('length')).toBe('2686 pb'.replace('pb', 'bp'));
  });
});

describe('Summary while scans run and when they fail', () => {
  it('keeps the same cards while values are pending and fills them when the scans finish', async () => {
    const { backend, settle } = deferredBackend();
    setAnalysisBackend(backend);
    open(dna(PUC19));
    const before = [...document.querySelectorAll('[data-kpi]')].map((el) => el.getAttribute('data-kpi'));
    expect(card('gc').getAttribute('aria-busy')).toBe('true');
    expect(card('gc').textContent).toContain('Calculating');
    expect(cardValue('length')).toBe('2,686 bp');
    expect(screen.getByRole('heading', { name: 'Reading the composition' })).toBeTruthy();

    settle();
    await waitFor(() => expect(card('gc').getAttribute('aria-busy')).toBe('false'));
    const after = [...document.querySelectorAll('[data-kpi]')].map((el) => el.getAttribute('data-kpi'));
    expect(after).toEqual(before);
    expect(cardValue('gc')).toMatch(/%$/);
  });

  it('says a failed scan failed and keeps the rest of the view', () => {
    setAnalysisBackend(failing('features', 'worker crashed'));
    open(dna(PUC19));
    expect(screen.getByText(/worker crashed/)).toBeTruthy();
    expect(cardValue('gc')).toMatch(/%$/);
    expect(screen.getByLabelText('GC content')).toBeTruthy();
  });

  it('shows the reason when the organism inference fails and still shows the numbers', () => {
    setAnalysisBackend(failing('organism', 'out of memory'));
    open(dna(randomDna(3000, 5)));
    expect(screen.getByRole('heading', { name: 'Inference unavailable' })).toBeTruthy();
    expect(screen.getByText(/out of memory/)).toBeTruthy();
    expect(cardValue('length')).toBe('3,000 bp');
    expect(card('topology').textContent).toContain('Could not be inferred');
  });

  it('shows the statistics failure without blanking the page', () => {
    setAnalysisBackend(failing('summary', 'no memory'));
    open(dna(PUC19));
    expect(screen.getByText(/statistics could not be calculated: no memory/)).toBeTruthy();
    expect(cardValue('gc')).toBe('—');
    expect(cardValue('length')).toBe('2,686 bp');
  });
});

describe('Summary of a protein record', () => {
  const protein = () => ({
    ...dna(PROTEIN),
    alphabet: 'protein' as const,
    metadata: { sourceFormat: 'fasta' as const },
  });

  it('shows length in aa, the pI, and no topology or GC card', () => {
    open(protein());
    expect(cardValue('length')).toBe(`${PROTEIN.length} aa`);
    expect(cardValue('type')).toBe('Protein');
    expect(cardValue('pi')).toMatch(/^\d+\.\d\d$/);
    expect(card('topology')).toBeNull();
    expect(card('gc')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Protein' })).toBeTruthy();
  });

  it('lists the six protein properties and the amino acid composition', () => {
    open(protein());
    const table = screen.getByRole('grid', { name: 'Protein properties' });
    for (const name of [
      'Molecular weight',
      'Isoelectric point',
      'Extinction coefficient at 280 nm',
      'Instability index',
      'GRAVY (mean hydropathy)',
      'Aromaticity',
    ])
      expect(within(table).getByText(name)).toBeTruthy();
    expect(screen.getByRole('grid', { name: 'Composition table' })).toBeTruthy();
    expect(screen.getByLabelText('Amino acid composition')).toBeTruthy();
  });

  it('draws the hydropathy curve in place of the GC charts', () => {
    open(protein());
    expect(screen.getByLabelText('Kyte-Doolittle hydropathy')).toBeTruthy();
    expect(screen.queryByLabelText('GC content')).toBeNull();
  });
});
