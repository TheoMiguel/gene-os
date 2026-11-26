import { LOGO } from './logo';

/** The GENE_OS mark, drawn in the theme's accent (ring) and cyan (helix). Decorative. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg class="logo" width={size} height={size} viewBox={LOGO.viewBox} aria-hidden="true" focusable="false">
      <path d={LOGO.ring} fill="none" stroke="var(--accent)" stroke-width={LOGO.ringWidth} />
      {LOGO.strands.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--cyan)"
          stroke-width={LOGO.strandWidth}
          stroke-linecap="round"
        />
      ))}
      {LOGO.pairs.map(({ y, half }) => (
        <path
          key={y}
          d={`M${LOGO.axisX - half} ${y}H${LOGO.axisX + half}`}
          stroke="var(--cyan)"
          stroke-width={LOGO.pairWidth}
        />
      ))}
    </svg>
  );
}
