import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Width used before the first measurement and in a test DOM that has no layout. */
export const FALLBACK_WIDTH = 600;

/** The width of the element behind the returned ref, kept current as the container resizes. */
export function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width: width || FALLBACK_WIDTH };
}
