// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { readSequenceText } from '../formats';
import { workspace } from '../state/documents';
import { updateSettings } from '../state/settings';
import { viewOf } from '../state/view';
import { ExportMenu } from './ExportMenu';

interface Download {
  name: string;
  text: string;
}

let downloads: Download[];
let clipboard: string[];

beforeEach(() => {
  updateSettings({ language: 'en' });
  downloads = [];
  clipboard = [];
  const blobs = new Map<string, Blob>();
  let counter = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:${counter++}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href);
    void blob?.text().then((text) => downloads.push({ name: this.download, text }));
  });
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: { writeText: async (text: string) => void clipboard.push(text) },
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
});

function open(fasta: string) {
  const read = readSequenceText(fasta);
  if (!read.ok || !read.records[0]) throw new Error('fixture failed');
  return workspace.open(read.records[0]);
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Export, copy and save' }));

describe('export menu', () => {
  it('offers only the project actions when no sequence is open', () => {
    render(<ExportMenu />);
    openMenu();
    expect(screen.getByText('Open a sequence to export it.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save project' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'GenBank' })).toBeNull();
  });

  it('saves the active sequence in each sequence format', async () => {
    open('>pTest\nACGTACGTACGT');
    render(<ExportMenu />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'GenBank' }));
    fireEvent.click(screen.getByRole('button', { name: 'FASTA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plain text' }));
    await waitFor(() => expect(downloads).toHaveLength(3));
    expect(downloads.map((d) => d.name).sort()).toEqual(['pTest.fasta', 'pTest.gb', 'pTest.txt']);
    expect(downloads.find((d) => d.name === 'pTest.gb')?.text).toContain('LOCUS');
  });

  it('saves only the selection when the user picks it', async () => {
    const id = open('>pTest\nAAAACCCCGGGGTTTT');
    viewOf(id).select(4, 8);
    render(<ExportMenu />);
    openMenu();
    fireEvent.click(screen.getByRole('radio', { name: 'Selection 5–8' }));
    fireEvent.click(screen.getByRole('button', { name: 'FASTA' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe('pTest_5-8.fasta');
    expect(downloads[0]?.text).toContain('CCCC');
    expect(downloads[0]?.text).not.toContain('AAAA');
  });

  it('copies the sequence, its reverse complement, its translation and the selection', async () => {
    const id = open('>pTest\nATGAAATAGCC');
    viewOf(id).select(0, 3);
    render(<ExportMenu />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Sequence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reverse complement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Translation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selection' }));
    await waitFor(() => expect(clipboard).toHaveLength(4));
    expect(clipboard).toEqual(['ATGAAATAGCC', 'GGCTATTTCAT', 'MK*', 'ATG']);
  });

  it('disables SnapGene and nucleotide actions for a protein', () => {
    open('>prot\nMKVLAAGIVGLLLAQWRTY');
    render(<ExportMenu />);
    openMenu();
    expect((screen.getByRole('button', { name: 'SnapGene' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reverse complement' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'GenBank' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('exports a document table as CSV', async () => {
    open('>pTest\nACGTACGTACGT');
    render(<ExportMenu />);
    openMenu();
    fireEvent.change(screen.getByRole('combobox', { name: 'Table' }), { target: { value: 'composition' } });
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe('pTest-composition.csv');
    expect(downloads[0]?.text).toContain('Letter,Count,Fraction');
  });

  it('lists the charts on screen with their own image buttons, and says so when there are none', () => {
    open('>pTest\nACGTACGTACGT');
    render(<ExportMenu />);
    openMenu();
    expect(screen.getByText('This view shows no chart or map.')).toBeTruthy();
    cleanup();

    document.body.innerHTML =
      '<div class="tab-panel"><div class="chart" aria-label="GC content"><svg class="chart-svg"></svg></div></div>';
    render(<ExportMenu />);
    openMenu();
    expect(screen.getByText('GC content')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Save SVG' })).toHaveLength(1);
  });

  it('closes on Escape and gives the focus back to its button', () => {
    render(<ExportMenu />);
    openMenu();
    expect(screen.getByRole('dialog', { name: 'Export, copy and save' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Export, copy and save' }));
  });

  it('opens the comparison dialog only with two sequences', () => {
    open('>a\nACGTACGT');
    render(<ExportMenu />);
    openMenu();
    expect(
      (screen.getByRole('button', { name: 'Compare two sequences (PDF)' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();
    open('>b\nGGCCGGCC');
    render(<ExportMenu />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Compare two sequences (PDF)' }));
    expect(screen.getByRole('dialog', { name: 'Compare two sequences' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Generate PDF' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
