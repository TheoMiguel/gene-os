import type { ComponentChildren } from 'preact';

/** A numbered, bracketed section of the summary. `actions` sit at the right of the heading. */
export function Section({
  number,
  title,
  actions,
  children,
}: {
  readonly number: string;
  readonly title: string;
  readonly actions?: ComponentChildren;
  readonly children: ComponentChildren;
}) {
  const headingId = `summary-section-${number}`;
  return (
    <section class="bracket-box summary-section" aria-labelledby={headingId}>
      <div class="bracket-inner" />
      <header class="summary-section-head">
        <div>
          <div class="stage-label">{number}</div>
          <h2 class="stage-title" id={headingId}>
            {title}
          </h2>
        </div>
        {actions && <div class="summary-section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
