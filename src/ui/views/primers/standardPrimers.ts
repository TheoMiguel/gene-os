/** A primer found on many cloning vectors, for colony PCR and sequencing checks. */
export interface StandardPrimer {
  readonly id: string;
  readonly name: string;
  readonly seq: string;
  readonly direction: 'forward' | 'reverse';
}

/** Universal vector primers, 5'→3'. */
export const STANDARD_PRIMERS: readonly StandardPrimer[] = [
  { id: 'm13f47', name: 'M13F(-47)', seq: 'CGCCAGGGTTTTCCCAGTCACGAC', direction: 'forward' },
  { id: 'm13f20', name: 'M13F(-20)', seq: 'GTAAAACGACGGCCAGT', direction: 'forward' },
  { id: 'm13r48', name: 'M13R(-48)', seq: 'AGCGGATAACAATTTCACACAGGA', direction: 'reverse' },
  { id: 'm13r', name: 'M13R', seq: 'CAGGAAACAGCTATGAC', direction: 'reverse' },
  { id: 't7', name: 'T7 promoter', seq: 'TAATACGACTCACTATAGGG', direction: 'forward' },
  { id: 't7term', name: 'T7 terminator', seq: 'GCTAGTTATTGCTCAGCGG', direction: 'reverse' },
  { id: 'sp6', name: 'SP6', seq: 'ATTTAGGTGACACTATAG', direction: 'forward' },
  { id: 'pgex5', name: "pGEX 5'", seq: 'GGGCTGGCAAGCCACGTTTGGTG', direction: 'forward' },
  { id: 'pgex3', name: "pGEX 3'", seq: 'CCGGGAGCTGCATGTGTCAGAGG', direction: 'reverse' },
];

/** The pair of primers used for the colony PCR check: M13F(-47) and M13R(-48), which flank the pUC multiple cloning site. */
export const COLONY_PCR_PAIR = ['m13f47', 'm13r48'] as const;

/** A primer with a stable hairpin and self-dimer, for the example that shows how a problem is drawn. */
export const HAIRPIN_EXAMPLE = 'GCGGATCCGCAAAAGCGGATCCGC';

export const standardPrimer = (id: string): StandardPrimer | undefined =>
  STANDARD_PRIMERS.find((p) => p.id === id);
