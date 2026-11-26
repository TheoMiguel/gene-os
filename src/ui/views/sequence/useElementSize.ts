import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Size used before the first measurement and in a test DOM that has no layout. */
export const FALLBACK_SIZE = { width: 560, height: 480 } as const;

/** The size of the element behind the returned ref, kept current as the element resizes. */
export function useElementSize<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>(FALLBACK_SIZE);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      if (width > 0 && height > 0)
        setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}
