import type { ComponentChildren } from 'preact';

interface PaneFrameProps {
  /** Section number shown in the label, as in the other views. */
  readonly index: string;
  readonly title: string;
  readonly class?: string;
  readonly children: ComponentChildren;
}

/** A corner-bracket box with a numbered label, which holds one pane and scrolls inside itself. */
export function PaneFrame({ index, title, class: extra, children }: PaneFrameProps) {
  return (
    <section class={`bracket-box seq-pane${extra ? ` ${extra}` : ''}`} aria-label={title}>
      <div class="bracket-inner" />
      <h2 class="stage-label pane-label">{`${index} // ${title}`}</h2>
      {children}
    </section>
  );
}
