import { ENZYME_CATALOG, scanSites } from '../restriction';
import type { Enzyme, Topology } from '../types';

/** The catalog enzyme with this name (case-sensitive, as REBASE writes it), or undefined. */
export function findEnzyme(name: string): Enzyme | undefined {
  return ENZYME_CATALOG.find((e) => e.name === name);
}

/** True for a plain site (A, C, G, T only) whose cut lies inside the site: a classic Type II enzyme. */
export function isClassicEnzyme(enzyme: Enzyme): boolean {
  const n = enzyme.site.length;
  const inside = (cut: number) => cut >= 0 && cut <= n;
  return /^[ACGT]+$/.test(enzyme.site) && inside(enzyme.topCut) && inside(enzyme.bottomCut);
}

/** True when the enzyme cuts outside its site (Type IIS), as Golden Gate needs. */
export function isTypeIIS(enzyme: Enzyme): boolean {
  const n = enzyme.site.length;
  return enzyme.topCut > n || enzyme.bottomCut > n || enzyme.topCut < 0 || enzyme.bottomCut < 0;
}

/** Number of cuts an enzyme makes in a sequence. */
export function cutCount(seq: string, topology: Topology, enzyme: Enzyme): number {
  return scanSites(seq, topology, [enzyme]).sites[0]?.topCuts.length ?? 0;
}
