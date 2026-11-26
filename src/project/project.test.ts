// @vitest-environment jsdom

import type { Feature, SeqRecord } from '../engine/types';
import { readSequenceText } from '../formats';
import { workspace } from '../state/documents';
import { viewOf } from '../state/view';
import { openProjectText, projectFileName, serializeProject } from './file';
import { parseProject, parseProjectText, parseRecord } from './parse';
import { registerProjectSection } from './sections';
import { applyProject, captureProject, projectName } from './snapshot';
import { PROJECT_FORMAT, PROJECT_VERSION } from './types';

const feature = (
  id: string,
  origin: Feature['origin'],
  segments: { start: number; end: number }[],
): Feature => ({
  id,
  type: 'CDS',
  name: id,
  origin,
  location: { segments, strand: -1 },
  qualifiers: { note: ['made by the test'] },
});

function record(
  name: string,
  seq: string,
  topology: SeqRecord['topology'],
  features: Feature[] = [],
): SeqRecord {
  const read = readSequenceText(`>${name}\n${seq}\n`);
  if (!read.ok || !read.records[0]) throw new Error('fixture failed');
  return { ...read.records[0], topology, features };
}

const PLASMID = record('pTest', 'ACGT'.repeat(50), 'circular', [
  // Crosses the origin: two segments.
  feature('wrap', 'user', [
    { start: 190, end: 200 },
    { start: 0, end: 12 },
  ]),
  feature('auto', 'detected', [{ start: 20, end: 40 }]),
  feature('file', 'file', [{ start: 50, end: 80 }]),
]);

beforeEach(() => {
  for (const doc of workspace.documents.value) workspace.close(doc.id);
  projectName.value = '';
});

describe('project file', () => {
  it('saves and reopens every document with its annotations, tab and view', () => {
    const a = workspace.open(PLASMID);
    const b = workspace.open(record('read', 'GATTACA'.repeat(10), 'linear'));
    workspace.setActiveTab(a, 'features');
    const view = viewOf(a);
    view.select(10, 30, -1);
    view.search.value = { query: 'GAATTC', mode: 'motif' };
    view.overlays.value = { feature: true, restriction: false, search: true, primer: true };
    view.lineLength.value = 80;
    workspace.activate(b);
    projectName.value = 'My cloning project';

    const text = serializeProject(captureProject());
    for (const doc of workspace.documents.value) workspace.close(doc.id);
    expect(openProjectText(text)).toEqual({ ok: true, documents: 2, skipped: 0 });

    const [first, second] = workspace.documents.value;
    expect(workspace.documents.value).toHaveLength(2);
    expect(first?.activeTab).toBe('features');
    expect(first?.record.seq).toBe(PLASMID.seq);
    expect(first?.record.topology).toBe('circular');
    expect(first?.record.features.map((f) => f.id)).toEqual(['wrap', 'file']);
    expect(first?.record.features[0]?.location.segments).toEqual([
      { start: 190, end: 200 },
      { start: 0, end: 12 },
    ]);
    const restored = viewOf(first?.id as string);
    expect(restored.selection.value).toEqual({ start: 10, end: 30, strand: -1 });
    expect(restored.search.value).toEqual({ query: 'GAATTC', mode: 'motif' });
    expect(restored.overlays.value.restriction).toBe(false);
    expect(restored.lineLength.value).toBe(80);
    expect(workspace.activeId.value).toBe(second?.id);
    expect(projectName.value).toBe('My cloning project');
  });

  it('keeps automatically detected features out of the file', () => {
    workspace.open(PLASMID);
    const data = captureProject();
    expect(data.documents[0]?.record.features.some((f) => f.origin === 'detected')).toBe(false);
  });

  it('adds the documents after the ones already open', () => {
    workspace.open(record('already', 'ACGTACGT', 'linear'));
    const text = serializeProject(captureProject());
    openProjectText(text);
    expect(workspace.documents.value.map((d) => d.record.name)).toEqual(['already', 'already']);
  });

  it('names the file after the project, the first document, or a default', () => {
    workspace.open(PLASMID);
    expect(projectFileName(captureProject(workspace, 'My: project'))).toBe('My_ project.geneos');
    expect(projectFileName(captureProject(workspace, ''))).toBe('pTest.geneos');
    for (const doc of workspace.documents.value) workspace.close(doc.id);
    expect(projectFileName(captureProject(workspace, ''))).toBe('gene-os.geneos');
  });

  it('round trips a 5 Mb sequence', () => {
    const big = 'ACGTTGCA'.repeat(625_000);
    workspace.open(record('big', big, 'linear'));
    const text = serializeProject(captureProject());
    for (const doc of workspace.documents.value) workspace.close(doc.id);
    expect(openProjectText(text).ok).toBe(true);
    expect(workspace.documents.value[0]?.record.seq.length).toBe(5_000_000);
  });
});

describe('reading a project safely', () => {
  const project = (extra: Record<string, unknown> = {}) => ({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    documents: [{ record: PLASMID, activeTab: 'summary' }],
    ...extra,
  });

  it('refuses a newer version with its number, and changes nothing', () => {
    const result = openProjectText(JSON.stringify(project({ version: PROJECT_VERSION + 1 })));
    expect(result).toEqual({ ok: false, reason: 'newerVersion', version: PROJECT_VERSION + 1 });
    expect(workspace.documents.value).toHaveLength(0);
  });

  it('refuses text that is not a project', () => {
    expect(parseProjectText('not json {')).toEqual({ ok: false, reason: 'notJson' });
    expect(parseProjectText('{"hello":1}')).toEqual({ ok: false, reason: 'notProject' });
    expect(parseProject([1, 2])).toEqual({ ok: false, reason: 'notProject' });
    expect(parseProject(project({ version: 0 }))).toMatchObject({ ok: false, reason: 'unsupportedVersion' });
  });

  it('skips a damaged document and counts it', () => {
    const result = parseProject(
      project({
        documents: [
          { record: PLASMID },
          { record: { seq: 42 } },
          { record: { ...PLASMID, seq: 'AC GT\u0000' } },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: true, skipped: 2 });
    expect(result.ok && result.data.documents).toHaveLength(1);
  });

  it('refuses a project whose documents are all damaged', () => {
    expect(parseProject(project({ documents: [{ record: null }] }))).toMatchObject({
      ok: false,
      reason: 'damaged',
    });
  });

  it('drops a feature that does not fit the sequence and keeps the record', () => {
    const bad = {
      ...PLASMID,
      features: [
        feature('past-the-end', 'user', [{ start: 150, end: 999 }]),
        feature('ok', 'user', [{ start: 1, end: 5 }]),
      ],
    };
    expect(parseRecord(bad)?.features.map((f) => f.id)).toEqual(['ok']);
  });

  it('puts a wrong view configuration back to defaults instead of failing', () => {
    const result = parseProject(
      project({
        documents: [
          {
            record: PLASMID,
            activeTab: 'nonsense',
            view: {
              selection: { start: 5, end: 99999, strand: 1 },
              caret: -4,
              lineLength: 3,
              overlays: { feature: false },
            },
          },
        ],
      }),
    );
    const doc = result.ok ? result.data.documents[0] : undefined;
    expect(doc?.activeTab).toBe('summary');
    expect(doc?.view.selection).toEqual({ start: 5, end: PLASMID.seq.length, strand: 1 });
    expect(doc?.view.caret).toBe(0);
    expect(doc?.view.lineLength).toBe(60);
    expect(doc?.view.overlays).toEqual({ feature: false, restriction: true, search: true, primer: true });
  });
});

describe('sections other views register', () => {
  it('stores and restores their per-document data, and survives one that throws', () => {
    const primers = new Map<string, unknown>();
    const stops = [
      registerProjectSection({
        key: 'primers',
        read: (id) => primers.get(id),
        write: (id, value) => void primers.set(id, value),
      }),
      registerProjectSection({
        key: 'broken',
        read: () => 'x',
        write: () => {
          throw new Error('cannot restore');
        },
      }),
    ];
    try {
      const id = workspace.open(PLASMID);
      primers.set(id, [{ name: 'fwd', seq: 'ACGTACGTACGTACGTACGT' }]);
      const data = captureProject();
      expect(data.documents[0]?.sections).toMatchObject({ primers: [{ name: 'fwd' }] });
      const [newId] = applyProject(JSON.parse(JSON.stringify(data)) as typeof data);
      expect(primers.get(newId as string)).toEqual([{ name: 'fwd', seq: 'ACGTACGTACGTACGTACGT' }]);
    } finally {
      for (const stop of stops) stop();
    }
  });
});
