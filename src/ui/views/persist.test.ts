// @vitest-environment jsdom
import { effect } from '@preact/signals';
import { PUC19_RECORD } from '../../../tests/fixtures/cloning/records';
import type { DesignedPrimer, PrimerPair } from '../../engine/primers';
import { openProjectText, serializeProject } from '../../project/file';
import { readSections } from '../../project/sections';
import { applyProject, captureProject } from '../../project/snapshot';
import { workspace } from '../../state/documents';
import { cloningPanelOf, sourcesOf } from './cloning/store';
import { primersStateOf } from './primers/state';
import './cloning/persist';
import './primers/persist';

const designed = (seq: string, strand: 1 | -1, start: number): DesignedPrimer => ({
  seq,
  strand,
  span: { start, end: start + seq.length },
  tm: 60.1,
  gcPercent: 50,
  endStability: -8,
  hairpinDg: -0.5,
  selfDimerDg: -1,
  penalty: 0.4,
});

const PAIR: PrimerPair = {
  forward: designed('ACGTACGTACGTACGTACGT', 1, 100),
  reverse: designed('TTGGCCAATTGGCCAATTGG', -1, 480),
  productSize: 400,
  deltaTm: 0.3,
  crossDimerDg: -2,
  penalty: 1.2,
};

const closeAll = () => {
  for (const doc of workspace.documents.value) workspace.close(doc.id);
};

/** Saves the workspace as a project file, closes everything and opens the file again. */
function saveAndReopen() {
  const text = serializeProject(captureProject());
  closeAll();
  expect(openProjectText(text)).toMatchObject({ ok: true });
  return workspace.documents.value.map((doc) => doc.id);
}

beforeEach(closeAll);

describe('primers survive a save and a reopen', () => {
  it('brings back typed primers, settings and the designed pairs', () => {
    const id = workspace.open(PUC19_RECORD);
    const state = primersStateOf(id);
    state.forward.value = 'GTAAAACGACGGCCAGT';
    state.forwardName.value = 'M13 fwd';
    state.mismatches.value = 3;
    state.inputs.value = { ...state.inputs.value, tmOpt: 62 };
    state.design.value = {
      status: 'done',
      pairs: [PAIR],
      constraints: {},
      target: { start: 100, end: 500 },
    };
    state.pair.value = 0;

    const [reopened] = saveAndReopen();
    const back = primersStateOf(reopened as string);
    expect(back.forward.value).toBe('GTAAAACGACGGCCAGT');
    expect(back.forwardName.value).toBe('M13 fwd');
    expect(back.mismatches.value).toBe(3);
    expect(back.inputs.value.tmOpt).toBe(62);
    expect(back.design.value).toMatchObject({
      status: 'done',
      pairs: [PAIR],
      target: { start: 100, end: 500 },
    });
    expect(back.pair.value).toBe(0);
  });

  it('stores nothing for a document whose primers view was never touched', () => {
    workspace.open(PUC19_RECORD);
    expect(captureProject().documents[0]?.sections).toEqual({});
  });

  it('survives a damaged value: it drops what is wrong and keeps the rest', () => {
    const id = workspace.open(PUC19_RECORD);
    const data = captureProject();
    const damaged = {
      ...data,
      documents: [
        {
          ...data.documents[0],
          sections: {
            primers: {
              forward: 'ACGTACGTACGTACGTACGT',
              reverse: 42,
              mismatches: 'many',
              inputs: { tmOpt: 'hot', tmMin: 55 },
              design: { pairs: [{ ...PAIR, productSize: null }, 'junk'], target: { start: 1, end: 9 } },
              pair: 7,
            },
            cloning: { vector: 'nope' },
          },
        },
      ],
    };
    closeAll();
    expect(() => applyProject(JSON.parse(JSON.stringify(damaged)))).not.toThrow();
    const back = primersStateOf(workspace.documents.value[0]?.id as string);
    expect(id).not.toBe(workspace.documents.value[0]?.id);
    expect(back.forward.value).toBe('ACGTACGTACGTACGTACGT');
    expect(back.reverse.value).toBe('');
    expect(back.mismatches.value).toBe(2);
    expect(back.inputs.value.tmMin).toBe(55);
    expect(back.inputs.value.tmOpt).toBe(60);
    expect(back.design.value.status).toBe('idle');
    expect(back.pair.value).toBeNull();
  });
});

describe('cloning strategies survive a save and a reopen', () => {
  it('brings back the form and points its sources at the reopened documents', () => {
    const vector = workspace.open(PUC19_RECORD);
    const insert = workspace.open({ ...PUC19_RECORD, name: 'insert', topology: 'linear' });
    const doc = workspace.documents.value.find((d) => d.id === insert);
    if (!doc) throw new Error('document missing');
    const panel = cloningPanelOf(doc, sourcesOf(workspace.documents.value));
    panel.setup.value = {
      ...panel.setup.value,
      method: 'gibson',
      overlap: '25',
      inserts: [{ kind: 'paste', text: 'ACGTACGTAC', topology: 'linear' }],
      vector: { kind: 'doc', docId: vector },
    };

    const [reopenedVector, reopenedInsert] = saveAndReopen();
    const reopened = workspace.documents.value.find((d) => d.id === reopenedInsert);
    if (!reopened) throw new Error('document missing');
    const back = cloningPanelOf(reopened, sourcesOf(workspace.documents.value)).setup.value;
    expect(back.method).toBe('gibson');
    expect(back.overlap).toBe('25');
    expect(back.inserts).toEqual([{ kind: 'paste', text: 'ACGTACGTAC', topology: 'linear' }]);
    expect(back.vector).toEqual({ kind: 'doc', docId: reopenedVector });
  });
});

describe('autosave', () => {
  it('runs again when a view creates its state after the first save, and when that state changes', () => {
    const id = workspace.open(PUC19_RECORD);
    const seen: unknown[] = [];
    const stop = effect(() => void seen.push(readSections(id)));
    try {
      expect(seen).toHaveLength(1);
      const state = primersStateOf(id);
      state.forward.value = 'ACGTACGTACGTACGTACGT';
      expect(seen.at(-1)).toMatchObject({ primers: { forward: 'ACGTACGTACGTACGTACGT' } });
      state.reverse.value = 'TTGGCCAATTGGCCAATTGG';
      expect(seen.at(-1)).toMatchObject({ primers: { reverse: 'TTGGCCAATTGGCCAATTGG' } });
    } finally {
      stop();
    }
  });
});
