import { bandOf, bands, type Scene, setAlpha, TAU } from './scene';

const MIN_RADIUS_PX = 28;
/** Upper bound on cells; on large screens the cells grow instead. */
const MAX_CELLS = 1400;
/** Area of a regular hexagon divided by the square of its radius. */
const HEX_AREA = (3 * Math.sqrt(3)) / 2;
const GLOW_BANDS = 4;
/** Corner offsets of a pointy-top unit hexagon. */
const CORNERS = Array.from({ length: 6 }, (_, k) => {
  const angle = TAU / 12 + (TAU / 6) * k;
  return [Math.cos(angle), Math.sin(angle)] as const;
});

/** Cell center and a phase offset that keeps the waves from looking mechanical. */
type Cell = readonly [x: number, y: number, jitter: number];

function hexagon(ctx: CanvasRenderingContext2D, [x, y]: Cell, r: number): void {
  CORNERS.forEach(([dx, dy], k) => {
    if (k === 0) ctx.moveTo(x + dx * r, y + dy * r);
    else ctx.lineTo(x + dx * r, y + dy * r);
  });
  ctx.closePath();
}

/** "Hex biomatrix": a faint hexagonal grid whose cells glow as slow waves travel across it. */
export function hexgrid(): Scene {
  let width = 0;
  let height = 0;
  let radius = MIN_RADIUS_PX;
  let cells: Cell[] = [];

  return {
    resize(w, h) {
      width = w;
      height = h;
      radius = Math.max(MIN_RADIUS_PX, Math.sqrt((w * h) / (MAX_CELLS * HEX_AREA)));
      const dx = Math.sqrt(3) * radius;
      const dy = 1.5 * radius;
      cells = [];
      for (let row = 0; row * dy < h + radius; row++) {
        for (let x = row % 2 === 0 ? 0 : dx / 2; x < w + dx; x += dx) {
          cells.push([x, row * dy, Math.random() * 0.8]);
        }
      }
    },

    draw(ctx, t, theme) {
      const r = radius * 0.94;
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = theme.muted;
      setAlpha(ctx, 0.06);
      ctx.beginPath();
      for (const cell of cells) hexagon(ctx, cell, r);
      ctx.stroke();

      const ox = width * (0.5 + 0.35 * Math.sin(t * 0.00006));
      const oy = height * (0.5 + 0.3 * Math.cos(t * 0.00004));
      const glow = bands<Cell>(GLOW_BANDS);
      for (const cell of cells) {
        const [x, y, jitter] = cell;
        const sweep = Math.sin(x * 0.005 + y * 0.0025 - t * 0.0005 + jitter);
        const ripple = Math.sin(Math.hypot(x - ox, y - oy) * 0.011 - t * 0.0008);
        const strength = ((sweep + ripple) / 2 - 0.3) / 0.7;
        if (strength > 0) glow[bandOf(strength, GLOW_BANDS)]?.push(cell);
      }

      ctx.fillStyle = theme.accent;
      ctx.strokeStyle = theme.accent;
      glow.forEach((group, i) => {
        ctx.beginPath();
        for (const cell of group) hexagon(ctx, cell, r);
        setAlpha(ctx, 0.02 + 0.025 * i);
        ctx.fill();
        setAlpha(ctx, 0.06 + 0.06 * i);
        ctx.stroke();
      });
    },
  };
}
