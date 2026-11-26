import { type CodonUsageRow, codonUsageFromCounts } from '../../../engine/composition';
import { CODON_ORDER } from '../../../engine/translate';
import type { ReferenceTable } from './references';

/** A codon row with its share inside its amino-acid family: 1 for a codon with no synonym. */
export interface ShareRow extends CodonUsageRow {
  readonly share: number;
}

/** A row compared against one reference organism. */
export interface ComparedRow extends ShareRow {
  readonly referencePerThousand: number;
  /** Own per-thousand minus the reference's. Positive means the codon is used more than in the reference. */
  readonly difference: number;
  readonly referenceRscu: number;
  /** Relative adaptiveness w of the codon in the reference (Sharp & Li 1987). */
  readonly adaptiveness: number;
}

/** Codons that code for one amino acid only. Their w is always 1, so a CAI leaves them out. */
const FIXED_CODONS = new Set(['ATG', 'TGG']);

/** Adds the share of each codon inside its amino-acid family (count over the family's count). */
export function withFamilyShare(rows: readonly CodonUsageRow[]): ShareRow[] {
  const familyCount = new Map<string, number>();
  for (const row of rows) familyCount.set(row.aminoAcid, (familyCount.get(row.aminoAcid) ?? 0) + row.count);
  return rows.map((row) => {
    const family = familyCount.get(row.aminoAcid) as number;
    return { ...row, share: family === 0 ? 0 : row.count / family };
  });
}

/** Rows of a reference table: counts, per thousand and RSCU under the standard genetic code. */
export function referenceRows(table: ReferenceTable): CodonUsageRow[] {
  return codonUsageFromCounts(CODON_ORDER.map((codon) => table.counts[codon] ?? 0)).rows;
}

/**
 * Relative adaptiveness w of every codon: its count over the largest count among its synonyms, as Sharp & Li
 * (1987) define it. A codon with a zero count is taken as 0.5, so a codon never seen in the reference lowers
 * the index and cannot zero it. Oracle: `Bio.SeqUtils.CodonAdaptationIndex`.
 */
export function relativeAdaptiveness(reference: readonly CodonUsageRow[]): Map<string, number> {
  const best = new Map<string, number>();
  const counted = (row: CodonUsageRow) => (row.count === 0 ? 0.5 : row.count);
  for (const row of reference) best.set(row.aminoAcid, Math.max(best.get(row.aminoAcid) ?? 0, counted(row)));
  return new Map(reference.map((row) => [row.codon, counted(row) / (best.get(row.aminoAcid) as number)]));
}

/**
 * Codon adaptation index of a codon tally: the geometric mean of w over the codons counted, with Met, Trp and
 * the stop codons left out. Returns null when no codon is left to count.
 */
export function codonAdaptationIndex(
  observed: readonly CodonUsageRow[],
  adaptiveness: ReadonlyMap<string, number>,
): number | null {
  let logSum = 0;
  let counted = 0;
  for (const row of observed) {
    if (row.count === 0 || row.aminoAcid === '*' || FIXED_CODONS.has(row.codon)) continue;
    logSum += row.count * Math.log(adaptiveness.get(row.codon) as number);
    counted += row.count;
  }
  return counted === 0 ? null : Math.exp(logSum / counted);
}

/** Puts each observed row beside the reference's value for the same codon. */
export function compareWithReference(observed: readonly ShareRow[], table: ReferenceTable): ComparedRow[] {
  const reference = referenceRows(table);
  const w = relativeAdaptiveness(reference);
  return observed.map((row, index) => {
    const ref = reference[index] as CodonUsageRow;
    return {
      ...row,
      referencePerThousand: ref.perThousand,
      difference: row.perThousand - ref.perThousand,
      referenceRscu: ref.rscu,
      adaptiveness: w.get(row.codon) as number,
    };
  });
}
