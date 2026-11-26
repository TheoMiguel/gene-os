import {
  type CutCountClass,
  cutSites,
  type EnzymeSites,
  endType,
  filterSites,
  type RestrictionScan,
} from '../../../engine/restriction';
import type { EndType, Strand } from '../../../engine/types';
import { lowerBound } from '../../viz/decimate';

/** One line of the restriction list: a cut of an enzyme, or an enzyme that does not cut at all. */
export interface SiteRow {
  readonly key: string;
  readonly enzyme: string;
  readonly recognition: string;
  /** How many times the enzyme cuts the molecule. */
  readonly count: number;
  /** 1-based position of the base before the top-strand cut. Null for an enzyme that does not cut. */
  readonly cut: number | null;
  /** 0-based start and exclusive end of the recognition site, which may run past the molecule's end. */
  readonly siteStart: number | null;
  readonly siteEnd: number | null;
  readonly strand: Strand | null;
  readonly end: EndType;
  /** Single-stranded overhang, 5'→3' on the top strand. Empty for a blunt end. */
  readonly overhang: string;
  /** Supplier codes of the enzyme. */
  readonly suppliers: string;
}

export interface RestrictionFilter {
  readonly endTypes: readonly EndType[];
  readonly cutCounts: readonly CutCountClass[];
  readonly suppliers: readonly string[];
}

export const DEFAULT_FILTER: RestrictionFilter = { endTypes: [], cutCounts: ['unique'], suppliers: [] };

/** The enzymes that pass `filter`. An empty list for a criterion keeps everything. */
export function filterEnzymes(scan: RestrictionScan, filter: RestrictionFilter): EnzymeSites[] {
  return filterSites(scan.sites, {
    ...(filter.endTypes.length > 0 ? { endTypes: filter.endTypes } : {}),
    ...(filter.cutCounts.length > 0 ? { cutCounts: filter.cutCounts } : {}),
    ...(filter.suppliers.length > 0 ? { suppliers: filter.suppliers } : {}),
  });
}

/** Most cuts the list builds. A 5 Mb molecule has about a million cuts across the catalog; nobody reads them all. */
export const MAX_ROWS = 50_000;

export interface SiteRows {
  readonly rows: SiteRow[];
  /** Cuts that pass the filter, also those past the row limit. */
  readonly total: number;
}

/**
 * The list rows for the enzymes that pass `filter`: one row per cut with the end it leaves and its overhang, and one
 * row for each enzyme that does not cut, so an empty result stays visible. Past `limit` rows the rarest cutters are
 * kept and the rest are left out; `total` tells how many cuts that was.
 */
export function buildSiteRows(
  scan: RestrictionScan,
  seq: string,
  filter: RestrictionFilter,
  limit = MAX_ROWS,
): SiteRows {
  const rows: SiteRow[] = [];
  const passing = filterEnzymes(scan, filter).sort(
    (a, b) => a.topCuts.length - b.topCuts.length || a.enzyme.name.localeCompare(b.enzyme.name),
  );
  let total = 0;
  for (const sites of passing) {
    const { enzyme } = sites;
    total += Math.max(1, sites.topCuts.length);
    if (rows.length >= limit) continue;
    const base = {
      enzyme: enzyme.name,
      recognition: enzyme.site,
      count: sites.topCuts.length,
      end: endType(enzyme),
      suppliers: enzyme.suppliers.join(' '),
    };
    if (sites.topCuts.length === 0) {
      rows.push({
        ...base,
        key: enzyme.name,
        cut: null,
        siteStart: null,
        siteEnd: null,
        strand: null,
        overhang: '',
      });
      continue;
    }
    cutSites(seq, scan.topology, sites).forEach((cut, index) => {
      rows.push({
        ...base,
        key: `${enzyme.name}:${cut.siteStart}:${index}`,
        cut: cut.topCut === 0 ? scan.length : cut.topCut,
        siteStart: cut.siteStart,
        siteEnd: cut.siteStart + enzyme.site.length,
        strand: cut.siteStrand,
        overhang: cut.overhang,
      });
    });
  }
  return { rows, total };
}

interface Entry {
  readonly start: number;
  readonly end: number;
  readonly row: number;
}

/** Finds the list rows whose recognition site overlaps a range, in time that follows the number of matches. */
export interface SiteIndex {
  overlapping(start: number, end: number): Set<number>;
}

/** An index over the sites of `rows`. A site across the origin counts at both ends of the molecule. */
export function createSiteIndex(rows: readonly SiteRow[], length: number): SiteIndex {
  const entries: Entry[] = [];
  let widest = 0;
  rows.forEach((row, index) => {
    if (row.siteStart === null || row.siteEnd === null) return;
    const pieces =
      row.siteEnd <= length
        ? [{ start: row.siteStart, end: row.siteEnd }]
        : [
            { start: row.siteStart, end: length },
            { start: 0, end: row.siteEnd - length },
          ];
    for (const piece of pieces) {
      entries.push({ ...piece, row: index });
      widest = Math.max(widest, piece.end - piece.start);
    }
  });
  entries.sort((a, b) => a.start - b.start);
  const starts = entries.map((entry) => entry.start);
  return {
    overlapping(start, end) {
      const found = new Set<number>();
      for (let i = lowerBound(starts, start - widest); i < entries.length; i++) {
        const entry = entries[i] as Entry;
        if (entry.start >= end) break;
        if (entry.end > start) found.add(entry.row);
      }
      return found;
    },
  };
}
