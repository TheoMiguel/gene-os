import { locationBounds } from '../../../engine/location';
import type { EnzymeSites, RestrictionScan } from '../../../engine/restriction';
import type { Enzyme, Feature, FeatureType, Span, Strand } from '../../../engine/types';
import { featureColor } from '../../viz/colors';
import { assignLanes } from './packing';

/** A drawn stretch of a feature. In display coordinates, so `end` above the molecule length crosses the origin. */
export interface MapPiece {
  readonly start: number;
  readonly end: number;
}

/** What the map draws for one annotation: its arcs, lane and the range a click selects. */
export interface MapFeature {
  readonly id: string;
  readonly name: string;
  readonly type: FeatureType;
  readonly color: string;
  readonly strand: Strand;
  readonly pieces: readonly MapPiece[];
  /** First start and last end of the pieces, in display coordinates. */
  readonly start: number;
  readonly end: number;
  readonly lane: number;
  /** The range a click selects: the longest piece. A selection cannot cross the origin. */
  readonly select: Span;
}

/** One restriction cut as the map shows it. */
export interface MapSite {
  readonly id: string;
  readonly enzyme: string;
  /** 1-based position of the base before the cut, as the published enzyme maps number it. */
  readonly cut: number;
  /** Cut as a 0-based boundary, for placing the tick. */
  readonly boundary: number;
  readonly siteStart: number;
  readonly siteEnd: number;
  readonly strand: Strand;
  /** How many times the enzyme cuts the molecule. */
  readonly count: number;
}

/** The pieces of `[start, end)` on a molecule of `length` bases: one, or two when it crosses the origin. */
export function splitAtOrigin(start: number, end: number, length: number): Span[] {
  return end <= length
    ? [{ start, end }]
    : [
        { start, end: length },
        { start: 0, end: end - length },
      ];
}

/** The longest of `spans`, which is what a click on a wrapped element selects. */
export function longestSpan(spans: readonly Span[]): Span {
  return spans.reduce((best, span) => (span.end - span.start > best.end - best.start ? span : best));
}

/**
 * Display pieces of a feature's segments. On a circular molecule a segment that ends at the molecule's end and
 * one that starts at 0 are one arc across the origin, however the file ordered them.
 */
export function featurePieces(segments: readonly Span[], length: number, circular: boolean): MapPiece[] {
  const pieces = segments.map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start);
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (circular && pieces.length > 1 && first && last && first.start === 0 && last.end === length) {
    pieces.shift();
    pieces[pieces.length - 1] = { start: last.start, end: length + first.end };
  }
  return pieces;
}

export interface MapFeatures {
  readonly features: readonly MapFeature[];
  readonly laneCount: number;
}

/**
 * Map features with lanes, so two features that overlap never share a lane and never hide each other. A feature
 * across the origin is a single feature. `gapFraction` is the room kept between neighbours in a lane, as a fraction
 * of the molecule.
 */
export function layoutFeatures(
  features: readonly Feature[],
  length: number,
  circular: boolean,
  gapFraction = 0.006,
): MapFeatures {
  const shaped = features
    .filter((feature) => feature.location.segments.length > 0)
    .map((feature) => {
      const pieces = featurePieces(feature.location.segments, length, circular);
      const bounds = locationBounds(feature.location);
      const first = pieces[0] ?? bounds;
      const last = pieces[pieces.length - 1] ?? bounds;
      return { feature, pieces, start: first.start, end: last.end };
    });
  const { lanes, count } = assignLanes(shaped, length, Math.max(1, length * gapFraction));
  return {
    laneCount: count,
    features: shaped.map(({ feature, pieces, start, end }, index) => ({
      id: feature.id,
      name: feature.name,
      type: feature.type,
      color: featureColor(feature),
      strand: feature.location.strand,
      pieces,
      start,
      end,
      lane: lanes[index] ?? 0,
      select: longestSpan(splitAtOrigin(start, end, length)),
    })),
  };
}

/** Every cut of the given enzymes as map sites, ordered along the molecule. */
export function mapSites(sites: readonly EnzymeSites[], length: number): MapSite[] {
  const result: MapSite[] = [];
  for (const { enzyme, topCuts, siteStarts, strands } of sites) {
    for (let i = 0; i < topCuts.length; i++) {
      const boundary = topCuts[i] as number;
      const siteStart = siteStarts[i] as number;
      result.push({
        id: `${enzyme.name}:${siteStart}`,
        enzyme: enzyme.name,
        cut: boundary === 0 ? length : boundary,
        boundary,
        siteStart,
        siteEnd: siteStart + enzyme.site.length,
        strand: strands[i] === -1 ? -1 : 1,
        count: topCuts.length,
      });
    }
  }
  return result.sort((a, b) => a.boundary - b.boundary || a.enzyme.localeCompare(b.enzyme));
}

/** Which enzymes the map draws: by how often they cut, plus any the user picked in the list. */
export type SiteDisplay = 'none' | 'unique' | 'few' | 'all';

/** Cut count at or below which `display` shows an enzyme, or 0 for none. */
export function maxCutsFor(display: SiteDisplay): number {
  return { none: 0, unique: 1, few: 2, all: Number.POSITIVE_INFINITY }[display];
}

/** Most restriction ticks one map draws. A molecule with more cuts shows the enzymes that cut least. */
export const MAX_MAP_SITES = 2000;

/** The cuts a map draws, and how many eligible cuts the tick limit left out. */
export interface ChosenSites {
  readonly sites: readonly MapSite[];
  readonly hidden: number;
}

/** The key shared by enzymes that recognize the same site and cut it the same way. */
export function isoschizomerKey(enzyme: Enzyme): string {
  return enzyme.isoschizomerOf ?? enzyme.name;
}

/** Orders enzymes of one group: sold by NEB first, then the group's own name, then the most widely sold. */
function byPreference(a: Enzyme, b: Enzyme): number {
  const neb = (e: Enzyme) => (e.suppliers.includes('N') ? 0 : 1);
  const prototype = (e: Enzyme) => (e.name === isoschizomerKey(e) ? 0 : 1);
  return (
    neb(a) - neb(b) ||
    prototype(a) - prototype(b) ||
    b.suppliers.length - a.suppliers.length ||
    a.name.localeCompare(b.name)
  );
}

/**
 * One enzyme per group of isoschizomers, so a map does not repeat one site under five names. A group with a picked
 * enzyme keeps every picked one instead.
 */
export function oneEnzymePerSite(sites: readonly EnzymeSites[], picked: ReadonlySet<string>): EnzymeSites[] {
  const groups = new Map<string, EnzymeSites[]>();
  for (const entry of sites) {
    const key = isoschizomerKey(entry.enzyme);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()].flatMap((group) => {
    const chosen = group.filter(({ enzyme }) => picked.has(enzyme.name));
    return chosen.length > 0
      ? chosen
      : [group.reduce((best, next) => (byPreference(next.enzyme, best.enzyme) < 0 ? next : best))];
  });
}

/**
 * The cuts a map draws: the enzymes `display` allows, one per group of isoschizomers, plus every picked enzyme. The
 * picked ones come first and then the rarest cutters, until `cap` cuts. `hidden` counts the cuts the cap left out.
 */
export function selectMapSites(
  scan: RestrictionScan,
  display: SiteDisplay,
  picked: ReadonlySet<string>,
  cap = MAX_MAP_SITES,
): ChosenSites {
  const limit = maxCutsFor(display);
  const eligible = oneEnzymePerSite(
    scan.sites.filter(
      ({ enzyme, topCuts }) => topCuts.length > 0 && (topCuts.length <= limit || picked.has(enzyme.name)),
    ),
    picked,
  ).sort(
    (a, b) =>
      Number(picked.has(b.enzyme.name)) - Number(picked.has(a.enzyme.name)) ||
      a.topCuts.length - b.topCuts.length,
  );
  const chosen: EnzymeSites[] = [];
  let drawn = 0;
  let total = 0;
  for (const sites of eligible) {
    total += sites.topCuts.length;
    if (drawn + sites.topCuts.length <= cap || chosen.length === 0) {
      chosen.push(sites);
      drawn += sites.topCuts.length;
    }
  }
  return { sites: mapSites(chosen, scan.length), hidden: total - drawn };
}
