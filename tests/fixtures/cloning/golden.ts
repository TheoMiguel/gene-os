import goldenJson from '../../oracle/cloning.json';

/** Shape of `tests/oracle/cloning.json`, written by `scripts/oracle/cloning_goldens.py`. */
export interface CloningGoldens {
  clamp: string;
  restriction: {
    label: string;
    enzymes: string[];
    mode: 'digest' | 'amplify';
    insertSeq: string;
    region: { start: number; length: number } | null;
    forward: string;
    reverse: string | null;
    backboneLength: number;
    insertLength: number;
  }[];
  homology: {
    method: 'gibson' | 'in_fusion';
    overlap: number;
    vectorEnzymes?: string[];
    vectorRemove?: { start: number; length: number };
    inserts: {
      seq: string;
      topology: 'linear' | 'circular';
      region: { start: number; length: number };
      strand: 1 | -1;
    }[];
    expected: string;
    backbone: string;
  }[];
  goldenGate: {
    enzyme: string;
    style: 'scar' | 'native';
    vectorMode: 'pcr' | 'digest';
    overhangs: string[] | null;
    vector: string;
    vectorRegion: { start: number; length: number };
    parts: string[];
    expected: string;
    overhangLength: number;
  }[];
  gateway: {
    reaction: 'BP' | 'LR';
    vector: { seq: string; ccdb: { start: number; end: number } };
    inserts: { seq: string; attB?: [number, number]; region?: { start: number; length: number } }[];
    expected: string;
    attL1Right?: string;
    geneStart?: string;
  }[];
  topo: {
    directional: boolean;
    site: number;
    insert: { seq: string; region: { start: number; length: number } };
    forward: string;
    reverse: string | null;
  }[];
}

export const GOLDEN = goldenJson as unknown as CloningGoldens;

/** True when `a` and `b` are the same circular molecule read from different starting points (same strand). */
export function sameCircle(a: string, b: string): boolean {
  return a.length === b.length && (a + a).includes(b);
}
