import type { LinearScene } from './linearMap';

interface StaticProps {
  readonly scene: LinearScene;
  readonly picked: ReadonlySet<string>;
}

/** The parts of the linear map that only change with the molecule, the filters, the window or the size. */
export function LinearStatic({ scene, picked }: StaticProps) {
  const { baseline, left, right } = scene;
  return (
    <g>
      <line class="map-backbone" x1={left} y1={baseline} x2={right} y2={baseline} />
      <g class="map-scale">
        {scene.scale.map((tick) => (
          <g key={tick.x}>
            <line x1={tick.x} y1={baseline} x2={tick.x} y2={baseline + 5} />
            <text x={tick.x} y={baseline + 17} text-anchor="middle">
              {tick.label}
            </text>
          </g>
        ))}
      </g>
      <g class="map-arcs">
        {scene.bars.map((bar, i) => (
          <path
            key={`${bar.id}:${i}`}
            class={`map-arc ${bar.kind}`}
            d={bar.d}
            fill={bar.color}
            data-id={bar.id}
          />
        ))}
      </g>
      <g class="map-ticks">
        {scene.ticks.map((tick) => (
          <line
            key={tick.id}
            class={`map-tick${picked.has(tick.enzyme) ? ' picked' : ''}`}
            x1={tick.x}
            y1={tick.y1}
            x2={tick.x}
            y2={tick.y2}
            data-id={tick.id}
          />
        ))}
      </g>
      <g class="map-labels">
        {scene.labels.map((label) => (
          <g key={label.key}>
            {label.leader && (
              <line
                class="map-leader"
                x1={label.leader[0]}
                y1={label.leader[1]}
                x2={label.leader[2]}
                y2={label.leader[3]}
              />
            )}
            <text
              class={`map-label ${label.kind}${label.inside ? ' inside' : ''}${label.kind === 'site' && picked.has(scene.items.get(label.id)?.enzyme ?? '') ? ' picked' : ''}`}
              x={label.x}
              y={label.y}
              text-anchor={label.anchor}
              data-id={label.id}
            >
              {label.text}
            </text>
          </g>
        ))}
      </g>
    </g>
  );
}

interface OverlayProps {
  readonly scene: LinearScene;
  readonly selection: { readonly start: number; readonly end: number } | null;
  readonly caret: number;
  readonly highlight: readonly string[];
}

/** The parts that follow the pointer, the caret and the selection. */
export function LinearOverlay({ scene, selection, caret, highlight }: OverlayProps) {
  const { baseline, height } = scene;
  const marked = new Set(highlight);
  const caretX = scene.x(caret);
  return (
    <g data-export="skip" pointer-events="none">
      {selection && (
        <rect
          class="map-selection-band"
          x={Math.max(scene.left, scene.x(selection.start))}
          y={baseline - 6}
          width={Math.max(
            2,
            Math.min(scene.right, scene.x(selection.end)) - Math.max(scene.left, scene.x(selection.start)),
          )}
          height={height - baseline}
        />
      )}
      {caretX >= scene.left && caretX <= scene.right && (
        <line class="map-caret" x1={caretX} y1={baseline - 7} x2={caretX} y2={baseline + 7} />
      )}
      {scene.bars
        .filter((bar) => marked.has(bar.id))
        .map((bar, i) => (
          <path key={`${bar.id}:${i}`} class="map-arc-highlight" d={bar.d} fill="none" />
        ))}
      {scene.ticks
        .filter((tick) => marked.has(tick.id))
        .map((tick) => (
          <line key={tick.id} class="map-tick-highlight" x1={tick.x} y1={tick.y1} x2={tick.x} y2={tick.y2} />
        ))}
    </g>
  );
}
