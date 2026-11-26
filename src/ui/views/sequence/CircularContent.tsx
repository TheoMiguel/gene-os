import { angleOf, arcLine, type CircularScene } from './circularMap';
import { fitText } from './mapText';

interface StaticProps {
  readonly scene: CircularScene;
  readonly name: string;
  readonly length: number;
  readonly picked: ReadonlySet<string>;
  readonly lengthLabel: string;
}

/** The parts of the circular map that only change when the molecule, the filters or the size change. */
export function CircularStatic({ scene, name, length, picked, lengthLabel }: StaticProps) {
  const { cx, cy } = scene;
  const centerWidth = scene.innerRadius * 1.8;
  return (
    <g>
      <circle class="map-backbone" cx={cx} cy={cy} r={scene.radius} fill="none" />
      <g class="map-scale">
        {scene.scale.map((tick, i) => (
          <g key={`${tick.x1}:${tick.y1}:${i}`}>
            <line x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
            {tick.label && (
              <text x={tick.lx} y={tick.ly} text-anchor="middle" dominant-baseline="central">
                {tick.label}
              </text>
            )}
          </g>
        ))}
      </g>
      <g class="map-arcs">
        {scene.arcs.map((arc, i) => (
          <path
            key={`${arc.id}:${i}`}
            class={`map-arc ${arc.kind}`}
            d={arc.d}
            fill={arc.color}
            data-id={arc.id}
          />
        ))}
      </g>
      <g class="map-ticks">
        {scene.ticks.map((tick) => (
          <line
            key={tick.id}
            class={`map-tick${picked.has(tick.enzyme) ? ' picked' : ''}`}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            data-id={tick.id}
          />
        ))}
      </g>
      <g class="map-labels">
        {scene.labels.map((label) => (
          <g key={label.key}>
            <polyline class="map-leader" points={label.leader} fill="none" />
            <text
              class={`map-label ${label.kind}${label.kind === 'site' && picked.has(scene.items.get(label.id)?.enzyme ?? '') ? ' picked' : ''}`}
              x={label.x}
              y={label.y}
              text-anchor={label.anchor}
              dominant-baseline="central"
              data-id={label.id}
            >
              {label.text}
            </text>
          </g>
        ))}
      </g>
      <text class="map-center-name" x={cx} y={cy - 8} text-anchor="middle" dominant-baseline="central">
        {fitText(name, centerWidth, 15)}
      </text>
      <text class="map-center-length" x={cx} y={cy + 12} text-anchor="middle" dominant-baseline="central">
        {lengthLabel}
      </text>
      <title>{`${name} · ${length.toLocaleString()}`}</title>
    </g>
  );
}

interface OverlayProps {
  readonly scene: CircularScene;
  readonly length: number;
  readonly selection: { readonly start: number; readonly end: number } | null;
  readonly caret: number;
  readonly window: { readonly start: number; readonly end: number };
  /** The element under the pointer or the keyboard, or the one last clicked. */
  readonly highlight: readonly string[];
}

/** The parts that follow the pointer, the caret and the selection. They redraw often, so they stay small. */
export function CircularOverlay({ scene, length, selection, caret, window, highlight }: OverlayProps) {
  const { cx, cy, radius } = scene;
  const marked = new Set(highlight);
  return (
    <g data-export="skip" pointer-events="none">
      {window.end > window.start && window.end - window.start < length && (
        <path
          class="map-window"
          d={arcLine(
            cx,
            cy,
            scene.scaleRadius + 4,
            angleOf(window.start, length),
            angleOf(window.end, length),
          )}
          fill="none"
        />
      )}
      {selection && (
        <path
          class="map-selection"
          d={arcLine(cx, cy, radius, angleOf(selection.start, length), angleOf(selection.end, length))}
          fill="none"
        />
      )}
      <line
        class="map-caret"
        x1={cx + (radius - 7) * Math.cos(angleOf(caret, length))}
        y1={cy + (radius - 7) * Math.sin(angleOf(caret, length))}
        x2={cx + (radius + 7) * Math.cos(angleOf(caret, length))}
        y2={cy + (radius + 7) * Math.sin(angleOf(caret, length))}
      />
      {scene.arcs
        .filter((arc) => marked.has(arc.id))
        .map((arc, i) => (
          <path key={`${arc.id}:${i}`} class="map-arc-highlight" d={arc.d} fill="none" />
        ))}
      {scene.ticks
        .filter((tick) => marked.has(tick.id))
        .map((tick) => (
          <line
            key={tick.id}
            class="map-tick-highlight"
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
          />
        ))}
    </g>
  );
}
