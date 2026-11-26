import type { RestrictionScan } from '../../engine/restriction';
import type { SearchHit } from '../../engine/search';
import type { Feature, PrimerBinding, Span } from '../../engine/types';
import type { Overlay } from '../../state/view';
import { featureColor } from './colors';

/** One overlay per segment of each feature. A feature across the origin gives two. */
export function featureOverlays(features: readonly Feature[]): Overlay[] {
  return features.flatMap((feature) =>
    feature.location.segments.map((segment, index) => ({
      id: `feature:${feature.id}:${index}`,
      kind: 'feature' as const,
      start: segment.start,
      end: segment.end,
      strand: feature.location.strand,
      label: feature.name,
      color: featureColor(feature),
    })),
  );
}

/** One overlay per segment of each search hit. */
export function searchOverlays(hits: readonly SearchHit[]): Overlay[] {
  return hits.flatMap((hit) =>
    hit.location.segments.map((segment: Span, index: number) => ({
      id: `search:${hit.start}:${hit.strand}:${index}`,
      kind: 'search' as const,
      start: segment.start,
      end: segment.end,
      strand: hit.strand,
    })),
  );
}

/**
 * The recognition site of every cut in a scan. `only` limits it to the named enzymes, e.g. the unique cutters.
 * A site that crosses the origin of a circular molecule gives two overlays.
 */
export function restrictionOverlays(scan: RestrictionScan, only?: ReadonlySet<string>): Overlay[] {
  const overlays: Overlay[] = [];
  for (const { enzyme, siteStarts, strands } of scan.sites) {
    if (only && !only.has(enzyme.name)) continue;
    const size = enzyme.site.length;
    siteStarts.forEach((start, index) => {
      const end = start + size;
      const strand = strands[index] === -1 ? -1 : 1;
      const base = { kind: 'restriction' as const, strand, label: enzyme.name } as const;
      if (end <= scan.length)
        overlays.push({ ...base, id: `restriction:${enzyme.name}:${start}`, start, end });
      else {
        overlays.push({ ...base, id: `restriction:${enzyme.name}:${start}:a`, start, end: scan.length });
        if (scan.topology === 'circular')
          overlays.push({
            ...base,
            id: `restriction:${enzyme.name}:${start}:b`,
            start: 0,
            end: end - scan.length,
          });
      }
    });
  }
  return overlays;
}

/** The template span each primer binding covers. `names` maps a primer id to the label to show. */
export function primerOverlays(
  bindings: readonly PrimerBinding[],
  names: ReadonlyMap<string, string> = new Map(),
): Overlay[] {
  return bindings.map((binding, index) => ({
    id: `primer:${binding.primerId}:${binding.span.start}:${index}`,
    kind: 'primer' as const,
    start: binding.span.start,
    end: binding.span.end,
    strand: binding.strand,
    label: names.get(binding.primerId) ?? binding.primerId,
  }));
}
