import {
  bandOf,
  bands,
  countFor,
  fillDots,
  random,
  type Scene,
  type Segment,
  setAlpha,
  strokeSegments,
  wrap,
} from './scene';

/** Longest link, and the side of a grid cell, in CSS pixels. */
const LINK_PX = 110;
const LINK_BANDS = 4;
/** Grid offsets that visit each pair of neighbouring cells once. */
const FORWARD = [
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

interface Mote {
  readonly x0: number;
  readonly y0: number;
  /** Pixels per millisecond. */
  readonly vx: number;
  readonly vy: number;
  readonly r: number;
  readonly cyan: boolean;
  x: number;
  y: number;
}

/**
 * Floating dots with faint links between near neighbours. A grid of link-sized cells limits the distance
 * checks to adjacent cells.
 */
export function particles(): Scene {
  let width = 0;
  let height = 0;
  let cols = 1;
  let rows = 1;
  let motes: Mote[] = [];
  let grid: Mote[][] = [];

  return {
    resize(w, h) {
      width = w;
      height = h;
      cols = Math.max(1, Math.ceil(w / LINK_PX));
      rows = Math.max(1, Math.ceil(h / LINK_PX));
      grid = Array.from({ length: cols * rows }, () => []);
      motes = Array.from({ length: countFor(w, h, 15_000, 20, 160) }, () => ({
        x0: random(0, w),
        y0: random(0, h),
        vx: random(-0.012, 0.012),
        vy: random(-0.01, 0.01),
        r: random(0.7, 1.8),
        cyan: Math.random() < 0.3,
        x: 0,
        y: 0,
      }));
    },

    draw(ctx, t, theme) {
      for (const cell of grid) cell.length = 0;
      for (const m of motes) {
        m.x = wrap(m.x0 + m.vx * t, width);
        m.y = wrap(m.y0 + m.vy * t, height);
        const cx = Math.min(cols - 1, Math.floor(m.x / LINK_PX));
        const cy = Math.min(rows - 1, Math.floor(m.y / LINK_PX));
        grid[cx + cy * cols]?.push(m);
      }

      const links = bands<Segment>(LINK_BANDS);
      const link = (a: Mote, b: Mote) => {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK_PX) links[bandOf(1 - d / LINK_PX, LINK_BANDS)]?.push([a.x, a.y, b.x, b.y]);
      };
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const here = grid[cx + cy * cols] ?? [];
          for (const [dx, dy] of FORWARD) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= cols || ny >= rows) continue;
            const there = grid[nx + ny * cols] ?? [];
            here.forEach((a, i) => {
              there.forEach((b, j) => {
                if (there !== here || j > i) link(a, b);
              });
            });
          }
        }
      }

      ctx.lineWidth = 0.7;
      ctx.strokeStyle = theme.accent;
      links.forEach((segments, i) => {
        setAlpha(ctx, 0.025 + 0.03 * i);
        strokeSegments(ctx, segments);
      });

      ctx.fillStyle = theme.accent;
      setAlpha(ctx, 0.3);
      fillDots(
        ctx,
        motes.filter((m) => !m.cyan).map((m) => [m.x, m.y, m.r]),
      );
      ctx.fillStyle = theme.cyan;
      setAlpha(ctx, 0.24);
      fillDots(
        ctx,
        motes.filter((m) => m.cyan).map((m) => [m.x, m.y, m.r]),
      );
    },
  };
}
