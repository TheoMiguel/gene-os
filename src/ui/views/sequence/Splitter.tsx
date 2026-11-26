const STEP = 0.03;
export const MIN_RATIO = 0.22;
export const MAX_RATIO = 0.78;

/** A ratio kept inside the range where both panes stay usable. */
export const clampRatio = (ratio: number) => Math.min(Math.max(ratio, MIN_RATIO), MAX_RATIO);

interface SplitterProps {
  /** `vertical` is a bar between a left and a right pane. */
  readonly orientation: 'vertical' | 'horizontal';
  readonly ratio: number;
  readonly onChange: (ratio: number) => void;
  /** Accessible name. */
  readonly label: string;
}

/**
 * A bar between two panes that the user drags, or moves with the arrow keys, to give one of them more room. The ratio
 * is the first pane's share of the parent that holds the bar.
 */
export function Splitter({ orientation, ratio, onChange, label }: SplitterProps) {
  const vertical = orientation === 'vertical';
  const move = (event: PointerEvent) => {
    const parent = (event.currentTarget as HTMLElement).parentElement;
    if (!parent || !(event.buttons & 1)) return;
    const box = parent.getBoundingClientRect();
    const size = vertical ? box.width : box.height;
    if (size > 0)
      onChange(clampRatio((vertical ? event.clientX - box.left : event.clientY - box.top) / size));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const back = vertical ? 'ArrowLeft' : 'ArrowUp';
    const forward = vertical ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    onChange(clampRatio(ratio + (event.key === forward ? STEP : -STEP)));
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable bar needs the separator role with a value, which <hr> cannot take
    <div
      class={`splitter ${orientation}`}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={(event) => (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)}
      onPointerMove={move}
      onKeyDown={onKeyDown}
    />
  );
}
