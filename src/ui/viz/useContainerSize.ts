import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Width used before the first measurement and in a test DOM that has no layout. */
export const FALLBACK_WIDTH = 600;

/** Size used before the first measurement and in a test DOM that has no layout. */
export const FALLBACK_SIZE = { width: 560, height: 480 } as const;

/** Runs `measure` now and whenever `element` resizes. Returns the cleanup. */
function observeSize(element: HTMLElement, measure: () => void): (() => void) | undefined {
  measure();
  if (typeof ResizeObserver === 'undefined') return undefined;
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  return () => observer.disconnect();
}

/** The size of the element behind the returned ref, kept current as the element resizes. */
export function useElementSize<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>(FALLBACK_SIZE);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observeSize(element, () => {
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      if (width > 0 && height > 0)
        setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    });
  }, []);
  return { ref, ...size };
}

/** The width of the element behind the returned ref, kept current as the container resizes. */
export function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observeSize(element, () => setWidth(Math.floor(element.clientWidth)));
  }, []);
  return { ref, width: width || FALLBACK_WIDTH };
}
