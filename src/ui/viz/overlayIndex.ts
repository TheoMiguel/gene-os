import type { Overlay } from '../../state/view';

export interface OverlayIndex {
  /** Overlays that share at least one base with `[start, end)`, in start order. */
  query(start: number, end: number): readonly Overlay[];
}

/**
 * Index for "what covers this row": binary search on the start, then a short walk back that a running maximum
 * of the ends cuts off. Building costs one sort, so a restriction scan of a genome stays cheap to query.
 */
export function createOverlayIndex(overlays: readonly Overlay[]): OverlayIndex {
  const sorted = [...overlays].sort((a, b) => a.start - b.start);
  const maxEnd = new Float64Array(sorted.length);
  let running = Number.NEGATIVE_INFINITY;
  sorted.forEach((overlay, i) => {
    running = Math.max(running, overlay.end);
    maxEnd[i] = running;
  });

  return {
    query(start, end) {
      let low = 0;
      let high = sorted.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if ((sorted[mid] as Overlay).start < end) low = mid + 1;
        else high = mid;
      }
      const found: Overlay[] = [];
      for (let i = low - 1; i >= 0 && (maxEnd[i] as number) > start; i--) {
        const overlay = sorted[i] as Overlay;
        if (overlay.end > start) found.push(overlay);
      }
      return found.reverse();
    },
  };
}
