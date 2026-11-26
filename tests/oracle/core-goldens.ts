import core from './core.json';

/** Shape of `tests/oracle/core.json`, written by `scripts/oracle/core_goldens.py` (Biopython). */
export interface CoreGoldens {
  biopython: string;
  geneticCodes: Record<string, { name: string; aa: string; starts: string[] }>;
  alphabet: {
    dna: { seq: string; rc: string; complement: string }[];
    rna: { seq: string; rc: string; complement: string }[];
  };
  translate: {
    cases: { table: number; seq: string; protein: string }[];
    toStop: { seq: string; protein: string }[];
    sixFrame: { seq: string; table: number; frames: Record<string, string> }[];
  };
  composition: {
    gc: { seq: string; remove: number; ignore: number; weighted: number }[];
    rnaGc: { seq: string; remove: number }[];
    skewWhole: { seq: string; skew: number }[];
    mw: ({ seq: string } & Record<string, number | string>)[];
    singleBase: Record<string, number>;
    singleBaseRna: Record<string, number>;
    proteinMw: { seq: string; mw: number }[];
    series: {
      kind: 'gc' | 'at' | 'gcSkew' | 'purine' | 'pyrimidine' | 'complexity' | 'tm';
      seq: string;
      window: number;
      step: number;
      circular: boolean;
      points: [number, number][];
    }[];
    partialSkew: { seq: string; window: number; skew: number[]; cumulative: number[] }[];
    codonUsage: {
      seq: string;
      table: number;
      frame: 0 | 1 | 2;
      total: number;
      counts: Record<string, number>;
      rscu: Record<string, number>;
    }[];
  };
  protein: {
    cases: {
      seq: string;
      pi: number;
      charge74: number;
      charge5: number;
      charge10: number;
      reduced: number;
      cystine: number;
      instability: number;
      gravy: number;
      aromaticity: number;
    }[];
    termini: { seq: string; pi: number; charge74: number }[];
    dipeptides: { seq: string; instability: number }[];
    residues: { seq: string; gravy: number }[];
    profiles: { seq: string; window: number; values: number[] }[];
  };
  orf: {
    seq: string;
    circular: boolean;
    table: number;
    starts: string[];
    minCodons: number;
    allStarts: boolean;
    orfs: {
      strand: 1 | -1;
      frame: number;
      start: number;
      length: number;
      aa: number;
      protein: string;
      startCodon: string;
      stopCodon: string;
    }[];
  }[];
  search: {
    motif: { seq: string; pattern: string; circular: boolean; forward: number[]; reverse: number[] }[];
    regex: { seq: string; regex: string; matches: [number, number][] }[];
    protein: { seq: string; motif: string; starts: number[]; length: number }[];
  };
  location: {
    seq: string;
    start: number;
    length: number;
    strand: 1 | -1;
    segments: [number, number][];
    extracted: string;
  }[];
}

/** The committed Biopython goldens for the engine core. */
export function loadCoreGoldens(): CoreGoldens {
  return core as unknown as CoreGoldens;
}

/** Small deterministic generator (mulberry32) for sequences in tests; the same seed gives the same bases. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random DNA of the given length over A, C, G, T, built in chunks so it also works for megabase sizes. */
export function randomDna(length: number, seed = 1, alphabet = 'ACGT'): string {
  const random = seededRandom(seed);
  const parts: string[] = [];
  const chunk = 1 << 16;
  for (let done = 0; done < length; done += chunk) {
    const size = Math.min(chunk, length - done);
    const codes = new Array<string>(size);
    for (let i = 0; i < size; i++) codes[i] = alphabet[Math.floor(random() * alphabet.length)] as string;
    parts.push(codes.join(''));
  }
  return parts.join('');
}
