import type { Span, Strand } from '../../../engine/types';
import { longestSpan, type MapFeature, type MapSite, splitAtOrigin } from './mapModel';

/** What a hover tooltip and a click need to know about one element of the map. */
export interface MapItem {
  /** Element id: `f:` feature, `p:` primer, `s:` restriction site. */
  readonly id: string;
  readonly kind: 'feature' | 'primer' | 'site';
  readonly title: string;
  /** Feature type, or the recognition sequence of a site. */
  readonly detail: string;
  /** 1-based, human-facing span, e.g. `1,234–2,000` or `2,500–2,686, 1–300` across the origin. */
  readonly span: string;
  readonly strand: Strand;
  /** What a click selects. */
  readonly select: Span;
  /** Where the sequence view scrolls to. */
  readonly reveal: number;
  /** Set for a restriction site: the enzyme, which a click also picks in the list. */
  readonly enzyme?: string;
}

const group = (value: number) => value.toLocaleString();

/** Human text for the pieces of an element: positions are shown 1-based and inclusive. */
export function describeSpan(start: number, end: number, length: number): string {
  return splitAtOrigin(start, end, length)
    .map((piece) =>
      piece.end - piece.start === 1
        ? group(piece.start + 1)
        : `${group(piece.start + 1)}–${group(piece.end)}`,
    )
    .join(', ');
}

/** The tooltip and click data of a feature or a primer. */
export function featureItem(feature: MapFeature, length: number, kind: 'feature' | 'primer'): MapItem {
  return {
    id: `${kind === 'feature' ? 'f' : 'p'}:${feature.id}`,
    kind,
    title: feature.name,
    detail: feature.type,
    span: describeSpan(feature.start, feature.end, length),
    strand: feature.strand,
    select: feature.select,
    reveal: feature.start % length,
  };
}

/** The tooltip and click data of one restriction cut. */
export function siteItem(site: MapSite, recognition: string, length: number): MapItem {
  return {
    id: `s:${site.id}`,
    kind: 'site',
    title: `${site.enzyme} (${group(site.cut)})`,
    detail: recognition,
    span: describeSpan(site.siteStart, site.siteEnd, length),
    strand: site.strand,
    select: longestSpan(splitAtOrigin(site.siteStart, site.siteEnd, length)),
    reveal: site.siteStart % length,
    enzyme: site.enzyme,
  };
}
