import { bytesToString, encodeBaseMasks, reverseComplement } from './alphabet';

/** Reading frame: +1..+3 read the top strand from offset 0..2, -1..-3 read the reverse complement. */
export type Frame = 1 | 2 | 3 | -1 | -2 | -3;

export const ALL_FRAMES: readonly Frame[] = [1, 2, 3, -1, -2, -3];

/** An NCBI genetic code table. `aa` lists the residue for each of the 64 codons in TCAG order (`*` is stop). */
export interface GeneticCode {
  readonly id: number;
  readonly name: string;
  readonly aa: string;
  /** Codons that can start translation (initiator Met, or Met-coding alternatives). */
  readonly starts: readonly string[];
}

/** The 64 codons in NCBI table order: first base T, C, A, G; second base T, C, A, G; third base T, C, A, G. */
export const CODON_ORDER: readonly string[] = [...'TCAG'].flatMap((a) =>
  [...'TCAG'].flatMap((b) => [...'TCAG'].map((c) => a + b + c)),
);

/**
 * NCBI genetic codes (https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi), checked against `Bio.Data.CodonTable`.
 * Tables 27, 28 and 31 read some stop codons as amino acids depending on context; like Biopython, these are
 * translated as the amino acid and never end an ORF.
 */
export const GENETIC_CODES: readonly GeneticCode[] = [
  {
    id: 1,
    name: 'Standard',
    aa: 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['TTG', 'CTG', 'ATG'],
  },
  {
    id: 2,
    name: 'Vertebrate Mitochondrial',
    aa: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG',
    starts: ['ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 3,
    name: 'Yeast Mitochondrial',
    aa: 'FFLLSSSSYY**CCWWTTTTPPPPHHQQRRRRIIMMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATA', 'ATG', 'GTG'],
  },
  {
    id: 4,
    name: 'Mold Mitochondrial',
    aa: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['TTA', 'TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 5,
    name: 'Invertebrate Mitochondrial',
    aa: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSSSVVVVAAAADDEEGGGG',
    starts: ['TTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 6,
    name: 'Ciliate Nuclear',
    aa: 'FFLLSSSSYYQQCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 9,
    name: 'Echinoderm Mitochondrial',
    aa: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG',
    starts: ['ATG', 'GTG'],
  },
  {
    id: 10,
    name: 'Euplotid Nuclear',
    aa: 'FFLLSSSSYY**CCCWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 11,
    name: 'Bacterial',
    aa: 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 12,
    name: 'Alternative Yeast Nuclear',
    aa: 'FFLLSSSSYY**CC*WLLLSPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['CTG', 'ATG'],
  },
  {
    id: 13,
    name: 'Ascidian Mitochondrial',
    aa: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSGGVVVVAAAADDEEGGGG',
    starts: ['TTG', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 14,
    name: 'Alternative Flatworm Mitochondrial',
    aa: 'FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 15,
    name: 'Blepharisma Macronuclear',
    aa: 'FFLLSSSSYY*QCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 16,
    name: 'Chlorophycean Mitochondrial',
    aa: 'FFLLSSSSYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 21,
    name: 'Trematode Mitochondrial',
    aa: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNNKSSSSVVVVAAAADDEEGGGG',
    starts: ['ATG', 'GTG'],
  },
  {
    id: 22,
    name: 'Scenedesmus obliquus Mitochondrial',
    aa: 'FFLLSS*SYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 23,
    name: 'Thraustochytrium Mitochondrial',
    aa: 'FF*LSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATT', 'ATG', 'GTG'],
  },
  {
    id: 24,
    name: 'Pterobranchia Mitochondrial',
    aa: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG',
    starts: ['TTG', 'CTG', 'ATG', 'GTG'],
  },
  {
    id: 25,
    name: 'Candidate Division SR1',
    aa: 'FFLLSSSSYY**CCGWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['TTG', 'ATG', 'GTG'],
  },
  {
    id: 26,
    name: 'Pachysolen tannophilus Nuclear',
    aa: 'FFLLSSSSYY**CC*WLLLAPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['CTG', 'ATG'],
  },
  {
    id: 27,
    name: 'Karyorelict Nuclear',
    aa: 'FFLLSSSSYYQQCCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 28,
    name: 'Condylostoma Nuclear',
    aa: 'FFLLSSSSYYQQCCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 29,
    name: 'Mesodinium Nuclear',
    aa: 'FFLLSSSSYYYYCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 30,
    name: 'Peritrich Nuclear',
    aa: 'FFLLSSSSYYEECC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 31,
    name: 'Blastocrithidia Nuclear',
    aa: 'FFLLSSSSYYEECCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['ATG'],
  },
  {
    id: 32,
    name: 'Balanophoraceae Plastid',
    aa: 'FFLLSSSSYY*WCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 33,
    name: 'Cephalodiscidae Mitochondrial',
    aa: 'FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG',
    starts: ['TTG', 'CTG', 'ATG', 'GTG'],
  },
];

/** Looks up a genetic code by NCBI table id. Throws for an unknown id. */
export function getGeneticCode(id: number): GeneticCode {
  const code = GENETIC_CODES.find((c) => c.id === id);
  if (!code) throw new RangeError(`unknown genetic code table ${id}`);
  return code;
}

/** Residue for a plain ACGT/U codon, or `undefined` when the codon holds anything else. */
export function codonResidue(code: GeneticCode, codon: string): string | undefined {
  const index = CODON_ORDER.indexOf(codon.toUpperCase().replaceAll('U', 'T'));
  return index < 0 ? undefined : code.aa[index];
}

/** True when the plain codon can start translation under the code. */
export function isStartCodon(code: GeneticCode, codon: string): boolean {
  return code.starts.includes(codon.toUpperCase().replaceAll('U', 'T'));
}

const BASE_ORDER_OF_BIT = [
  ['T', 8],
  ['C', 2],
  ['A', 1],
  ['G', 4],
] as const;

/** Ambiguity groups that Biopython reports as one letter: Asx, Glx and Xle. */
const AMBIGUOUS_PAIRS: Readonly<Record<string, string>> = { DN: 'B', EQ: 'Z', IL: 'J' };

const lookupCache = new WeakMap<GeneticCode, Uint8Array>();

/**
 * Residue char code for every codon of base masks `(m1 << 8) | (m2 << 4) | m3`. A codon that holds a non-nucleotide
 * has mask 0 and maps to `X`. An ambiguous codon maps to its residue when all expansions agree, to B/Z/J for
 * Asx/Glx/Xle, and to X otherwise. Matches `Bio.Seq.translate` on IUPAC codons.
 */
function codonLookup(code: GeneticCode): Uint8Array {
  const cached = lookupCache.get(code);
  if (cached) return cached;
  const table = new Uint8Array(4096).fill(88);
  const expand = (mask: number) => BASE_ORDER_OF_BIT.filter(([, bit]) => mask & bit).map(([base]) => base);
  for (let m1 = 1; m1 < 16; m1++) {
    for (let m2 = 1; m2 < 16; m2++) {
      for (let m3 = 1; m3 < 16; m3++) {
        const residues = new Set<string>();
        for (const a of expand(m1)) {
          for (const b of expand(m2)) {
            for (const c of expand(m3)) residues.add(code.aa[CODON_ORDER.indexOf(a + b + c)] as string);
          }
        }
        const sorted = [...residues].sort().join('');
        const letter = residues.size === 1 ? sorted : (AMBIGUOUS_PAIRS[sorted] ?? 'X');
        table[(m1 << 8) | (m2 << 4) | m3] = letter.charCodeAt(0);
      }
    }
  }
  lookupCache.set(code, table);
  return table;
}

export interface TranslateOptions {
  /** NCBI table id or a code object. Default: 1 (standard). */
  readonly table?: number | GeneticCode;
  /** Stop at the first stop codon and leave it out. Default: false (stops are written as `*`). */
  readonly toStop?: boolean;
}

function resolveCode(table: number | GeneticCode | undefined): GeneticCode {
  if (table === undefined) return getGeneticCode(1);
  return typeof table === 'number' ? getGeneticCode(table) : table;
}

/**
 * Translates codons from the first base, dropping an incomplete last codon. IUPAC ambiguity codes resolve as in
 * Biopython; anything else gives `X`. Oracle: `Bio.Seq.Seq.translate`.
 */
export function translate(seq: string, options: TranslateOptions = {}): string {
  const lookup = codonLookup(resolveCode(options.table));
  const masks = encodeBaseMasks(seq);
  const count = Math.floor(masks.length / 3);
  const out = new Uint8Array(count);
  const stop = 42;
  let length = 0;
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    const aa = lookup[
      ((masks[p] as number) << 8) | ((masks[p + 1] as number) << 4) | (masks[p + 2] as number)
    ] as number;
    if (aa === stop && options.toStop) break;
    out[length++] = aa;
  }
  return bytesToString(out.subarray(0, length));
}

/** Translation in one reading frame. Negative frames read the reverse complement. */
export function translateFrame(seq: string, frame: Frame, options: TranslateOptions = {}): string {
  if (frame > 0) return translate(frame === 1 ? seq : seq.slice(frame - 1), options);
  return translate(reverseComplement(seq).slice(-frame - 1), options);
}

export interface FrameTranslation {
  readonly frame: Frame;
  readonly protein: string;
}

/** Translations in all six frames, in the order +1, +2, +3, -1, -2, -3. */
export function sixFrameTranslation(seq: string, options: TranslateOptions = {}): FrameTranslation[] {
  const rc = reverseComplement(seq);
  return ALL_FRAMES.map((frame) => ({
    frame,
    protein: translate((frame > 0 ? seq : rc).slice(Math.abs(frame) - 1), options),
  }));
}
