import { extractLocation } from '../../../engine/location';
import {
  type CutCountClass,
  type EnzymeFilter,
  type EnzymeSites,
  endType,
  filterSites,
  type RestrictionScan,
} from '../../../engine/restriction';
import type { EndType, Enzyme, Fragment, FragmentEnd, SeqRecord } from '../../../engine/types';
import { t } from '../../i18n';

/** One enzyme of the catalog with how often it cuts the loaded sequence. */
export interface EnzymeRow {
  readonly enzyme: Enzyme;
  readonly cuts: number;
  readonly end: EndType;
}

/** The enzyme catalog filters the picker offers; `all` keeps everything. */
export interface EnzymeChoices {
  readonly endType: EndType | 'all';
  readonly cuts: CutCountClass | 'all';
  readonly supplier: string;
}

export const NO_FILTER: EnzymeChoices = { endType: 'all', cuts: 'all', supplier: 'all' };

/** The catalog rows that pass the end type, cut count and supplier filters, in catalog order. */
export function enzymeRows(scan: RestrictionScan, choices: EnzymeChoices): EnzymeRow[] {
  const filter: EnzymeFilter = {
    ...(choices.endType === 'all' ? {} : { endTypes: [choices.endType] }),
    ...(choices.cuts === 'all' ? {} : { cutCounts: [choices.cuts] }),
    ...(choices.supplier === 'all' ? {} : { suppliers: [choices.supplier] }),
  };
  return filterSites(scan.sites, filter).map(({ enzyme, topCuts }) => ({
    enzyme,
    cuts: topCuts.length,
    end: endType(enzyme),
  }));
}

/** The recognition site with the top-strand cut marked (`G^AATTC`); a Type IIS enzyme shows its cut offsets. */
export function siteWithCut(enzyme: Enzyme): string {
  const { site, topCut, bottomCut } = enzyme;
  if (topCut >= 0 && topCut <= site.length) return `${site.slice(0, topCut)}^${site.slice(topCut)}`;
  return `${site} (${topCut}/${bottomCut})`;
}

/** The scanned sites of the chosen enzymes, in the order chosen. Names the scan does not know are dropped. */
export function chosenSites(scan: RestrictionScan, chosen: readonly string[]): EnzymeSites[] {
  const byName = new Map(scan.sites.map((sites) => [sites.enzyme.name, sites]));
  return chosen.flatMap((name) => byName.get(name) ?? []);
}

/** One fragment of a digest, ready for the table. Positions are 1-based and inclusive, as the user reads them. */
export interface FragmentRow {
  readonly index: number;
  readonly length: number;
  readonly start: number;
  readonly end: number;
  /** The fragment runs across the origin of a circular molecule. */
  readonly wraps: boolean;
  readonly left: FragmentEnd;
  readonly right: FragmentEnd;
  /** First top-strand segment as `[start, end)`, 0-based, for selecting it in the sequence view. */
  readonly firstSegment: { readonly start: number; readonly end: number };
  /** The fragment's top-strand sequence. Cut once and kept, so a 5 Mb digest costs nothing until it is read. */
  sequence(): string;
}

/** Table rows for the fragments of a digest, numbered along the top strand. */
export function fragmentRows(seq: string, fragments: readonly Fragment[]): FragmentRow[] {
  return fragments.map((fragment, i) => {
    const first = fragment.location.segments[0] ?? { start: 0, end: 0 };
    const last = fragment.location.segments[fragment.location.segments.length - 1] ?? first;
    let cached: string | null = null;
    return {
      index: i + 1,
      length: fragment.length,
      start: first.start + 1,
      end: last.end,
      wraps: fragment.location.segments.length > 1,
      left: fragment.leftEnd,
      right: fragment.rightEnd,
      firstSegment: { start: first.start, end: first.end },
      sequence: () => {
        cached ??= extractLocation(seq, fragment.location);
        return cached;
      },
    };
  });
}

/** Describes one end of a fragment in the current language: its enzyme, kind and overhang. */
export function endLabel(end: FragmentEnd): string {
  if (end.kind === 'terminus') return t('digest.endTerminus');
  if (end.end === 'blunt') return t('digest.endBlunt', { enzyme: end.enzyme });
  return t(end.end === 'five_prime' ? 'digest.endFive' : 'digest.endThree', {
    enzyme: end.enzyme,
    overhang: end.overhang,
  });
}

/** The fragment as a standalone linear record, for FASTA or GenBank export. */
export function fragmentRecord(parent: SeqRecord, row: FragmentRow, enzymes: string): SeqRecord {
  const name = `${parent.name}_${enzymes}_fragment${row.index}`;
  return {
    id: name,
    name,
    description: `${row.length} bp fragment ${row.start}..${row.end} of ${parent.name} cut with ${enzymes}`,
    alphabet: 'dna',
    topology: 'linear',
    seq: row.sequence(),
    features: [],
    metadata: {},
  };
}
