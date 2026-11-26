import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * Tallest scroll area a browser handles (Firefox stops near 17.9 million px, Chrome near 33 million). A list
 * taller than this scrolls with a reduced ratio, so tens of millions of rows stay reachable.
 */
export const MAX_SCROLL_HEIGHT = 8_000_000;

/** Height used before the container is measured, and in a test DOM that has no layout. */
export const FALLBACK_VIEWPORT = 400;

export interface VirtualInput {
  readonly count: number;
  readonly itemHeight: number;
  /** Height of the area the items show in. */
  readonly viewportHeight: number;
  /** The scroll container's `scrollTop`. */
  readonly scrollTop: number;
  /** Extra items drawn above and below the viewport. Default 3. */
  readonly overscan?: number;
  readonly maxHeight?: number;
}

export interface VirtualRange {
  /** First item to draw. */
  readonly first: number;
  /** One past the last item to draw. */
  readonly last: number;
  /** Distance in px from the top of the list to the top of the viewport. Draw item `i` at `i * itemHeight - offset`. */
  readonly offset: number;
  /** Height of the scroll area, never above `maxHeight`. */
  readonly scrollHeight: number;
  /** List distance moved per px of scrolling: 1 for a list that fits. */
  readonly scale: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

function geometry(input: VirtualInput) {
  const viewport = Math.max(0, input.viewportHeight);
  const total = input.count * input.itemHeight;
  const scrollHeight = Math.min(total, input.maxHeight ?? MAX_SCROLL_HEIGHT);
  const maxOffset = Math.max(0, total - viewport);
  const scrollRange = Math.max(0, scrollHeight - viewport);
  return { viewport, maxOffset, scrollHeight, scale: scrollRange === 0 ? 1 : maxOffset / scrollRange };
}

/** Which items to draw, and where, for a list of `count` equal-height items scrolled to `scrollTop`. */
export function virtualRange(input: VirtualInput): VirtualRange {
  const { viewport, maxOffset, scrollHeight, scale } = geometry(input);
  const overscan = input.overscan ?? 3;
  const offset = clamp(input.scrollTop * scale, 0, maxOffset);
  return {
    first: clamp(Math.floor(offset / input.itemHeight) - overscan, 0, input.count),
    last: clamp(Math.ceil((offset + viewport) / input.itemHeight) + overscan, 0, input.count),
    offset,
    scrollHeight,
    scale,
  };
}

export type ScrollAlign = 'start' | 'center' | 'nearest';

/** The `scrollTop` that brings item `index` into view. `nearest` leaves the scroll alone when it is fully visible. */
export function scrollTopFor(index: number, align: ScrollAlign, input: VirtualInput): number {
  const { viewport, maxOffset, scale } = geometry(input);
  const top = index * input.itemHeight;
  const current = clamp(input.scrollTop * scale, 0, maxOffset);
  let target: number;
  if (align === 'start') target = top;
  else if (align === 'center') target = top - (viewport - input.itemHeight) / 2;
  else if (top < current) target = top;
  else if (top + input.itemHeight > current + viewport) target = top + input.itemHeight - viewport;
  else target = current;
  return clamp(target, 0, maxOffset) / scale;
}

export interface VirtualScroll {
  readonly ref: { current: HTMLDivElement | null };
  readonly onScroll: () => void;
  readonly range: VirtualRange;
  /** Height of the area the items show in. */
  readonly viewportHeight: number;
  /** Scrolls so item `index` shows. Updates the range at once, also where there is no layout to scroll. */
  scrollToItem(index: number, align?: ScrollAlign): void;
}

/**
 * Scroll state for a virtualized list inside a container with `overflow: auto`. Put a child of height
 * `range.scrollHeight` in the container, a sticky layer inside it, and draw items `range.first` to
 * `range.last` in the layer at `i * itemHeight - range.offset`. `inset` is the height of a sticky header
 * above the layer.
 */
export function useVirtualScroll(options: {
  readonly count: number;
  readonly itemHeight: number;
  readonly inset?: number;
  readonly overscan?: number;
}): VirtualScroll {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measured, setMeasured] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setMeasured(element.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const viewportHeight = (measured || FALLBACK_VIEWPORT) - (options.inset ?? 0);
  const input: VirtualInput = {
    count: options.count,
    itemHeight: options.itemHeight,
    viewportHeight,
    scrollTop,
    ...(options.overscan === undefined ? {} : { overscan: options.overscan }),
  };

  return {
    ref,
    onScroll: () => {
      if (ref.current) setScrollTop(ref.current.scrollTop);
    },
    range: virtualRange(input),
    viewportHeight,
    scrollToItem(index, align = 'nearest') {
      const target = scrollTopFor(index, align, input);
      if (ref.current) ref.current.scrollTop = target;
      setScrollTop(target);
    },
  };
}
