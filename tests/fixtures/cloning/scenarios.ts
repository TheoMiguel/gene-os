import type { CloningMethod, CloningRequest } from '../../../src/engine/cloning';
import type { Feature, SeqRecord } from '../../../src/engine/types';
import { GOLDEN } from './golden';
import { makeRecord, PUC19_RECORD } from './records';

/** One golden case turned into an engine request plus the values the reference says it must produce. */
export interface Scenario {
  readonly label: string;
  readonly method: CloningMethod;
  readonly request: CloningRequest;
  /** Orientation -> expected construct sequence (up to rotation); `null` means that orientation must not be offered. */
  readonly expected: Readonly<Record<string, string | null>>;
  /** Insert sequences (top strand) that must occur exactly once in a construct. */
  readonly insertSeqs: readonly string[];
  /** Source records by part id, to compare carried features and to run the PCR round trip. */
  readonly sources: ReadonlyMap<string, SeqRecord>;
  /** Method-specific lengths the property tests check. */
  readonly restriction?: {
    readonly enzymes: readonly string[];
    readonly backboneLength: number;
    readonly insertLength: number;
  };
  readonly homology?: { readonly overlap: number };
  readonly goldenGate?: {
    readonly overhangLength: number;
    readonly scar: boolean;
    readonly vectorLength: number;
  };
}

const vector = { id: 'pUC19', record: PUC19_RECORD };

export function ccdbFeature(start: number, end: number): Feature {
  return {
    id: 'ccdb',
    type: 'CDS',
    name: 'ccdB',
    location: { segments: [{ start, end }], strand: 1 },
    origin: 'user',
  };
}

export function backboneFeature(): Feature {
  return {
    id: 'res',
    type: 'resistance',
    name: 'KanR',
    location: { segments: [{ start: 0, end: 100 }], strand: 1 },
    origin: 'user',
  };
}

function build(): Scenario[] {
  const out: Scenario[] = [];

  for (const c of GOLDEN.restriction) {
    const record = makeRecord('insert', c.insertSeq, 'linear');
    const region = c.region ?? { start: 0, length: c.insertSeq.length };
    out.push({
      label: `restriction: ${c.label}`,
      method: 'restriction',
      request: {
        method: 'restriction',
        vector,
        insert: { id: 'insert', record, ...(c.region ? { region: c.region } : {}) },
        enzymes: c.enzymes,
        insertMode: c.mode,
      },
      expected: { forward: c.forward, reverse: c.reverse },
      insertSeqs: c.mode === 'amplify' ? [c.insertSeq.slice(region.start, region.start + region.length)] : [],
      sources: new Map([
        ['pUC19', PUC19_RECORD],
        ['insert', record],
      ]),
      restriction: { enzymes: c.enzymes, backboneLength: c.backboneLength, insertLength: c.insertLength },
    });
  }

  GOLDEN.homology.forEach((c, index) => {
    const inserts = c.inserts.map((i, k) => ({
      id: `insert${k + 1}`,
      record: makeRecord(`t${k + 1}`, i.seq, i.topology),
      region: i.region,
    }));
    const sources = new Map<string, SeqRecord>([['pUC19', PUC19_RECORD]]);
    for (const part of inserts) sources.set(part.id, part.record);
    out.push({
      label: `${c.method} case ${index + 1} (overlap ${c.overlap})`,
      method: c.method,
      request: {
        method: c.method,
        vector,
        opening: c.vectorEnzymes
          ? { enzymes: c.vectorEnzymes }
          : { remove: c.vectorRemove ?? { start: 0, length: 0 } },
        inserts,
        overlap: c.overlap,
        strands: c.inserts.map((i) => i.strand),
      },
      expected: { forward: c.expected },
      insertSeqs: c.inserts.map((i) => {
        const doubled = i.seq + i.seq;
        const top = doubled.slice(i.region.start, i.region.start + i.region.length);
        return top;
      }),
      sources,
      homology: { overlap: c.overlap },
    });
  });

  GOLDEN.goldenGate.forEach((c, index) => {
    const vectorPart = {
      id: 'vector',
      record: makeRecord('vector', c.vector, 'circular'),
      ...(c.vectorMode === 'pcr' ? { region: c.vectorRegion } : {}),
    };
    const parts = c.parts.map((seq, i) => ({
      id: `part${i + 1}`,
      record: makeRecord(`p${i + 1}`, seq, 'linear'),
    }));
    const sources = new Map<string, SeqRecord>([['vector', vectorPart.record]]);
    for (const part of parts) sources.set(part.id, part.record);
    out.push({
      label: `golden_gate ${c.enzyme} ${c.style} ${c.vectorMode} case ${index + 1}`,
      method: 'golden_gate',
      request: {
        method: 'golden_gate',
        enzyme: c.enzyme,
        vector: vectorPart,
        vectorMode: c.vectorMode,
        parts,
        ...(c.overhangs ? { overhangs: c.overhangs } : {}),
        junctionStyle: c.style,
      },
      expected: { forward: c.expected },
      insertSeqs: c.parts,
      sources,
      goldenGate: {
        overhangLength: c.overhangLength,
        scar: c.style === 'scar',
        vectorLength: c.vector.length,
      },
    });
  });

  for (const c of GOLDEN.gateway) {
    const sources = new Map<string, SeqRecord>();
    const vectorRecord = makeRecord('vector', c.vector.seq, 'circular', [
      ccdbFeature(c.vector.ccdb.start, c.vector.ccdb.end),
    ]);
    sources.set('vector', vectorRecord);
    const inserts = c.inserts.map((i, k) => {
      const record = makeRecord(
        `i${k + 1}`,
        i.seq,
        c.reaction === 'BP' ? 'linear' : 'circular',
        c.reaction === 'LR' ? [backboneFeature()] : [],
      );
      sources.set(`insert${k + 1}`, record);
      return {
        part: { id: `insert${k + 1}`, record, ...(i.region ? { region: i.region } : {}) },
        ...(i.attB ? { attB: { left: i.attB[0], right: i.attB[1] } } : {}),
      };
    });
    out.push({
      label: `gateway ${c.reaction}`,
      method: 'gateway',
      request: {
        method: 'gateway',
        reaction: c.reaction,
        vector: { id: 'vector', record: vectorRecord },
        inserts,
      },
      expected: { forward: c.expected },
      insertSeqs: c.reaction === 'BP' ? c.inserts.map((i) => i.seq) : [],
      sources,
    });
  }

  for (const c of GOLDEN.topo) {
    const record = makeRecord('insert', c.insert.seq, 'linear');
    out.push({
      label: `topo ${c.directional ? 'directional' : 'TA'}`,
      method: 'topo',
      request: {
        method: 'topo',
        vector,
        site: c.site,
        insert: { id: 'insert', record, region: c.insert.region },
        directional: c.directional,
      },
      expected: { forward: c.forward, reverse: c.reverse },
      insertSeqs: [c.insert.seq.slice(c.insert.region.start, c.insert.region.start + c.insert.region.length)],
      sources: new Map([
        ['pUC19', PUC19_RECORD],
        ['insert', record],
      ]),
    });
  }
  return out;
}

export const SCENARIOS: readonly Scenario[] = build();
