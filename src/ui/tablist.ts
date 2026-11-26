/**
 * Index that a key moves to in a horizontal tablist of `count` tabs (WAI-ARIA tabs pattern), or null when
 * the key is not a tablist key. Arrows wrap around.
 */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Index of the tab button the event came from, read from its `data-index`. */
export function eventTabIndex(event: Event): number {
  const tab = (event.target as Element | null)?.closest<HTMLElement>('[role="tab"]');
  return Number(tab?.dataset.index ?? 0);
}
