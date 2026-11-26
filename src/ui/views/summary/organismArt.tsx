import type { JSX, Ref } from 'preact';
import type { OrganismCategory } from '../../../engine/organism';

/** The drawing's coordinate box. Every illustration is composed inside it. */
export const ART_WIDTH = 240;
export const ART_HEIGHT = 168;
const CX = ART_WIDTH / 2;
const CY = ART_HEIGHT / 2;

const TURN = Math.PI * 2;

/** Point at `fraction` of a full turn clockwise from the top of a circle. */
function onCircle(fraction: number, radius: number, cx = CX, cy = CY): readonly [number, number] {
  const angle = fraction * TURN - Math.PI / 2;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function arc(from: number, to: number, radius: number): string {
  const [x1, y1] = onCircle(from, radius);
  const [x2, y2] = onCircle(to, radius);
  const large = to - from > 0.5 ? 1 : 0;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${radius} ${radius} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function arrowHead(at: number, radius: number, size: number): string {
  const [tx, ty] = onCircle(at + size / radius / TURN, radius);
  const [ax, ay] = onCircle(at, radius + size * 0.7);
  const [bx, by] = onCircle(at, radius - size * 0.7);
  return `${ax.toFixed(1)},${ay.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
}

function Plasmid() {
  const ticks = [0.86, 0.885, 0.91];
  return (
    <>
      <circle class="oa-mute oa-thin" cx={CX} cy={CY} r={38} stroke-dasharray="2 5" />
      <circle class="oa-mute oa-line" cx={CX} cy={CY} r={54} />
      <path class="oa-warn oa-band" d={arc(0.02, 0.2, 54)} />
      <path class="oa-cyan oa-band" d={arc(0.3, 0.56, 54)} />
      <polygon class="oa-cyan-fill" points={arrowHead(0.56, 54, 9)} />
      <path class="oa-purple oa-band" d={arc(0.64, 0.72, 54)} />
      <polygon class="oa-purple-fill" points={arrowHead(0.72, 54, 8)} />
      {ticks.map((at) => {
        const [x1, y1] = onCircle(at, 47);
        const [x2, y2] = onCircle(at, 66);
        return <line key={at} class="oa-accent oa-line" x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
    </>
  );
}

/** Two base pairs' worth of hint: three bonds for G and C, two for A and T. */
function PairGlyph({ left, right, bonds }: { left: string; right: string; bonds: 2 | 3 }) {
  const x = 196;
  const y = 142;
  return (
    <g class="oa-glyph">
      <circle class="oa-accent oa-thin oa-soft" cx={x} cy={y} r={9} />
      <circle class="oa-cyan oa-thin oa-soft" cx={x + 32} cy={y} r={9} />
      {Array.from({ length: bonds }, (_, i) => (
        <line
          key={i}
          class="oa-mute oa-thin"
          x1={x + 9}
          x2={x + 23}
          y1={y - (bonds - 1) * 2.5 + i * 5}
          y2={y - (bonds - 1) * 2.5 + i * 5}
        />
      ))}
      <text class="oa-letter" x={x} y={y + 3.5} text-anchor="middle">
        {left}
      </text>
      <text class="oa-letter" x={x + 32} y={y + 3.5} text-anchor="middle">
        {right}
      </text>
    </g>
  );
}

const NUCLEOID_ROD =
  'M70 84C78 66 92 66 98 84S116 102 124 84 142 66 150 84 164 100 172 84M76 94C88 108 100 100 108 90S128 70 140 80 160 106 168 96';

function HighGcBacterium() {
  return (
    <>
      <rect class="oa-accent oa-wall oa-soft" x={34} y={48} width={172} height={72} rx={36} />
      <rect class="oa-mute oa-thin" x={45} y={58} width={150} height={52} rx={26} />
      <path class="oa-cyan oa-line" d={NUCLEOID_ROD} fill="none" />
      {[
        [66, 70],
        [74, 100],
        [180, 74],
        [172, 104],
        [128, 60],
        [114, 108],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} class="oa-purple-fill" cx={x} cy={y} r={2.4} />
      ))}
      <PairGlyph left="G" right="C" bonds={3} />
    </>
  );
}

function LowGcBacterium() {
  return (
    <>
      {[92, 150].map((x) => (
        <g key={x}>
          <circle class="oa-accent oa-wall-thin oa-soft" cx={x} cy={CY} r={30} />
          <path
            class="oa-cyan oa-line"
            d={`M${x - 14} ${CY}C${x - 12} ${CY - 14} ${x} ${CY - 14} ${x} ${CY}S${x + 12} ${CY + 14} ${x + 14} ${CY}`}
            fill="none"
          />
          <circle class="oa-purple-fill" cx={x - 16} cy={CY - 14} r={2.2} />
          <circle class="oa-purple-fill" cx={x + 15} cy={CY + 15} r={2.2} />
          <circle class="oa-purple-fill" cx={x + 12} cy={CY - 17} r={2.2} />
        </g>
      ))}
      <PairGlyph left="A" right="T" bonds={2} />
    </>
  );
}

function Eukaryote() {
  return (
    <>
      <ellipse class="oa-accent oa-wall-thin oa-soft" cx={CX} cy={CY} rx={102} ry={66} />
      <circle class="oa-cyan oa-line oa-soft" cx={104} cy={78} r={28} />
      <circle class="oa-cyan oa-thin" cx={104} cy={78} r={22} stroke-dasharray="3 3" />
      <path
        class="oa-purple oa-line"
        d="M90 74C96 64 104 70 106 78S114 90 120 82M92 88C100 94 106 86 100 80"
        fill="none"
      />
      <circle class="oa-warn-fill" cx={112} cy={70} r={4.5} />
      {[
        { x: 170, y: 58, r: -24 },
        { x: 176, y: 102, r: 18 },
      ].map(({ x, y, r }) => (
        <g key={y} transform={`rotate(${r} ${x} ${y})`}>
          <ellipse class="oa-warn oa-line oa-soft" cx={x} cy={y} rx={17} ry={9} />
          <path class="oa-warn oa-thin" d={`M${x - 10} ${y}c3-6 5 6 8 0s5 6 8 0 5 6 6 0`} fill="none" />
        </g>
      ))}
      <path
        class="oa-mute oa-thin"
        d="M58 112C70 124 90 124 100 114M140 118C152 126 166 122 172 124"
        fill="none"
      />
    </>
  );
}

function Phage() {
  const hex = Array.from({ length: 6 }, (_, i) => onCircle(i / 6 + 1 / 12, 30, CX, 50).join(',')).join(' ');
  return (
    <>
      <polygon class="oa-accent oa-line oa-soft" points={hex} />
      <polyline
        class="oa-mute oa-thin"
        points={`${onCircle(1 / 12, 30, CX, 50).join(',')} ${CX},50 ${onCircle(0.5 + 1 / 12, 30, CX, 50).join(',')}`}
      />
      <polyline
        class="oa-mute oa-thin"
        points={`${onCircle(0.25 + 1 / 12, 30, CX, 50).join(',')} ${CX},50 ${onCircle(0.75 + 1 / 12, 30, CX, 50).join(',')}`}
      />
      <path
        class="oa-cyan oa-thin"
        d="M104 44C112 38 128 38 136 44M104 52C112 46 128 46 136 52M106 60C114 54 126 54 134 60"
        fill="none"
      />
      <rect class="oa-purple oa-line oa-soft" x={110} y={80} width={20} height={6} />
      <rect class="oa-purple oa-line oa-soft" x={113} y={86} width={14} height={36} />
      {[92, 98, 104, 110, 116].map((y) => (
        <line key={y} class="oa-purple oa-thin" x1={113} x2={127} y1={y} y2={y} />
      ))}
      <polygon class="oa-warn oa-line oa-soft" points="106,122 134,122 128,130 112,130" />
      {[
        'M108 130L84 150L74 146',
        'M112 130L100 152L92 156',
        'M128 130L140 152L148 156',
        'M132 130L156 150L166 146',
        'M114 130L120 158',
        'M126 130L120 158',
      ].map((d) => (
        <path key={d} class="oa-warn oa-line" d={d} fill="none" />
      ))}
    </>
  );
}

function helixPath(): string {
  const points: string[] = [];
  for (let x = 30; x <= 104; x += 2) {
    const y = 84 + 18 * Math.sin(((x - 30) / 74) * TURN * 3);
    points.push(`${points.length === 0 ? 'M' : 'L'}${x} ${y.toFixed(1)}`);
  }
  return points.join('');
}

function Protein() {
  return (
    <>
      <path class="oa-accent oa-ribbon" d={helixPath()} fill="none" />
      <path class="oa-accent-light oa-ribbon-core" d={helixPath()} fill="none" />
      <path class="oa-mute oa-line" d="M104 84C114 84 118 62 128 60" fill="none" stroke-dasharray="4 3" />
      <polygon class="oa-cyan-fill" points="128,52 178,52 178,46 198,58 178,70 178,64 128,64" />
      <path class="oa-mute oa-line" d="M198 58C214 58 214 84 198 84" fill="none" stroke-dasharray="4 3" />
      <polygon class="oa-purple-fill" points="198,78 148,78 148,72 128,84 148,96 148,90 198,90" />
      <path class="oa-mute oa-line" d="M128 84C112 84 112 112 128 112" fill="none" stroke-dasharray="4 3" />
      <polygon class="oa-cyan-fill" points="128,106 178,106 178,100 198,112 178,124 178,118 128,118" />
    </>
  );
}

function Unknown() {
  return (
    <>
      <circle class="oa-mute oa-line" cx={CX} cy={CY} r={56} stroke-dasharray="6 6" />
      <path
        class="oa-accent oa-ribbon-thin"
        d="M100 70C100 48 140 48 140 72C140 90 120 90 120 108"
        fill="none"
      />
      <circle class="oa-accent-fill" cx={120} cy={125} r={5} />
      {[
        [58, 52],
        [186, 58],
        [56, 118],
        [190, 112],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} class="oa-mute-fill" cx={x} cy={y} r={2.5} />
      ))}
    </>
  );
}

const DRAWINGS: Readonly<Record<OrganismCategory, () => JSX.Element>> = {
  'synthetic-vector': Plasmid,
  'high-gc-bacterium': HighGcBacterium,
  'low-gc-bacterium': LowGcBacterium,
  eukaryote: Eukaryote,
  'phage-virus': Phage,
  protein: Protein,
  unknown: Unknown,
};

/**
 * The illustration of an organism category: a plasmid map, a thick-walled rod, a pair of cocci, a nucleated cell,
 * a tailed phage, a ribbon fold, or a dashed question mark. Colours come from the theme's accent and series
 * variables through the `oa-*` classes of `summary.css`. `label` is the accessible description.
 */
export function OrganismArt({
  category,
  label,
  svgRef,
}: {
  readonly category: OrganismCategory;
  readonly label: string;
  readonly svgRef: Ref<SVGSVGElement>;
}) {
  const Drawing = DRAWINGS[category];
  return (
    <svg
      ref={svgRef}
      class="organism-art"
      viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}
      role="img"
      aria-label={label}
      data-category={category}
    >
      <title>{label}</title>
      <Drawing />
    </svg>
  );
}
