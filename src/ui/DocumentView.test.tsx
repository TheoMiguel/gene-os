// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/preact';
import { readSequenceText } from '../formats';
import { workspace } from '../state/documents';
import { updateSettings } from '../state/settings';
import { DocumentView } from './DocumentView';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

beforeEach(() => updateSettings({ language: 'en' }));

afterEach(() => {
  cleanup();
  for (const doc of workspace.documents.value) workspace.close(doc.id);
});

function metaOf(fasta: string, topology?: 'circular') {
  const read = readSequenceText(fasta);
  if (!read.ok || !read.records[0]) throw new Error('fixture failed');
  const record = topology ? { ...read.records[0], topology } : read.records[0];
  const id = workspace.open(record);
  const doc = workspace.documents.value.find((d) => d.id === id);
  if (!doc) throw new Error('document missing');
  const view = render(<DocumentView doc={doc} />);
  return view.container.querySelector('.doc-meta')?.textContent?.replace(/\s+/g, ' ').trim();
}

describe('document header', () => {
  it('gives a protein in amino acids and shows no topology', () => {
    expect(metaOf('>prot\nMKVLAAGIVGLLLAQPSMA')).toBe('19 aa · Protein');
  });

  it('gives a nucleotide record in bp with its topology', () => {
    expect(metaOf('>plas\nACGTACGTACGTACGTAAGG', 'circular')).toBe('20 bp · Circular · DNA');
  });
});
