/** The four residue classes of the strip: side chains that avoid water, stay neutral, take a charge either way. */
export const RESIDUE_CLASSES = ['hydrophobic', 'polar', 'basic', 'acidic'] as const;
export type ResidueClass = (typeof RESIDUE_CLASSES)[number];

/** Which letters belong to each class (Lehninger grouping: Gly, Ala and Pro count as hydrophobic; Tyr as polar). */
const MEMBERS: Readonly<Record<ResidueClass, string>> = {
  hydrophobic: 'GAPVLIMFW',
  polar: 'STCNQY',
  basic: 'KRH',
  acidic: 'DE',
};

/** Class of each of the 20 standard amino acids. */
export const RESIDUE_CLASS_OF: Readonly<Record<string, ResidueClass>> = Object.fromEntries(
  RESIDUE_CLASSES.flatMap((cls) => [...MEMBERS[cls]].map((letter) => [letter, cls] as const)),
);

/** Theme color of a class. */
export const RESIDUE_CLASS_COLOR: Readonly<Record<ResidueClass, string>> = {
  hydrophobic: 'var(--warn)',
  polar: 'var(--cyan)',
  basic: 'var(--purple)',
  acidic: 'var(--danger)',
};

/** Share of each class among the standard residues of `protein`. All zero when it has none. */
export function classShares(protein: string): Record<ResidueClass, number> {
  const counts = { hydrophobic: 0, polar: 0, basic: 0, acidic: 0 };
  let total = 0;
  for (const letter of protein) {
    const cls = RESIDUE_CLASS_OF[letter];
    if (cls) {
      counts[cls]++;
      total++;
    }
  }
  return {
    hydrophobic: total === 0 ? 0 : counts.hydrophobic / total,
    polar: total === 0 ? 0 : counts.polar / total,
    basic: total === 0 ? 0 : counts.basic / total,
    acidic: total === 0 ? 0 : counts.acidic / total,
  };
}

/** A stretch of residues of one class (`null` for letters outside the 20 standard ones). */
export interface ClassRun {
  readonly cls: ResidueClass | null;
  readonly text: string;
}

/** Splits `protein` into runs of one class, so a long chain colors with few nodes. */
export function classRuns(protein: string): ClassRun[] {
  const runs: { cls: ResidueClass | null; text: string }[] = [];
  for (const letter of protein) {
    const cls = RESIDUE_CLASS_OF[letter] ?? null;
    const last = runs.at(-1);
    if (last && last.cls === cls) last.text += letter;
    else runs.push({ cls, text: letter });
  }
  return runs;
}
