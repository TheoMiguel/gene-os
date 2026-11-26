import {
  bandOf,
  bands,
  clamp,
  type Dot,
  fillDots,
  type Scene,
  type Segment,
  setAlpha,
  strokeSegments,
} from './scene';

/** Radians between neighbouring base pairs. */
const TWIST = 0.34;
/** Rotation speed, radians per millisecond. */
const SPIN = 0.00032;
const DEPTH_BANDS = 5;
const RUNG_EVERY = 3;

/**
 * A double helix along the horizontal axis, rotating slowly. Points nearer the viewer are larger and
 * brighter; base-pair rungs join the strands.
 */
export function helix(): Scene {
  let count = 0;
  let left = 0;
  let step = 0;
  let radius = 0;
  let mid = 0;

  return {
    resize(w, h) {
      count = clamp(Math.round(w / 15), 16, 150);
      left = w * 0.04;
      step = (w * 0.92) / (count - 1);
      radius = Math.min(h * 0.15, 120);
      mid = h / 2;
    },

    draw(ctx, t, theme) {
      const strandA = bands<Dot>(DEPTH_BANDS);
      const strandB = bands<Dot>(DEPTH_BANDS);
      const rungs: Segment[] = [];
      for (let i = 0; i < count; i++) {
        const x = left + i * step;
        const axis = mid + radius * 0.35 * Math.sin(i * 0.05 + t * 0.00015);
        const phase = i * TWIST + t * SPIN;
        const ya = axis + radius * Math.sin(phase);
        const yb = axis - radius * Math.sin(phase);
        const depthA = (1 + Math.cos(phase)) / 2;
        const depthB = 1 - depthA;
        strandA[bandOf(depthA, DEPTH_BANDS)]?.push([x, ya, 0.8 + 1.6 * depthA]);
        strandB[bandOf(depthB, DEPTH_BANDS)]?.push([x, yb, 0.8 + 1.6 * depthB]);
        if (i % RUNG_EVERY === 0) rungs.push([x, ya, x, yb]);
      }

      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.muted;
      setAlpha(ctx, 0.07);
      strokeSegments(ctx, rungs);

      const paintStrand = (strand: Dot[][], color: string) => {
        ctx.fillStyle = color;
        strand.forEach((dots, depth) => {
          setAlpha(ctx, 0.05 + 0.06 * depth);
          fillDots(ctx, dots);
        });
      };
      paintStrand(strandA, theme.accent);
      paintStrand(strandB, theme.cyan);
    },
  };
}
