import { clamp, hash01, random, type Scene, type SceneTheme, setAlpha, TAU, wrap } from './scene';

const STEP_PX = 4;
const TICK_PX = 90;
const NOISE_SHARE = 0.35;
const COLORS = ['accent', 'cyan', 'purple'] as const satisfies readonly (keyof SceneTheme)[];

/** One sine component: share of the lane amplitude, cycles per pixel in radians, phase. */
type Wave = readonly [share: number, frequency: number, phase: number];

interface Lane {
  readonly y: number;
  readonly amp: number;
  /** Scroll speed, pixels per millisecond. */
  readonly speed: number;
  readonly seed: number;
  readonly color: (typeof COLORS)[number];
  readonly waves: readonly Wave[];
}

/** Smooth noise in [-1, 1]: hashed values at whole numbers, eased between them. */
function valueNoise(u: number): number {
  const i = Math.floor(u);
  const f = u - i;
  const eased = f * f * (3 - 2 * f);
  return (hash01(i) + (hash01(i + 1) - hash01(i)) * eased) * 2 - 1;
}

/** Telemetry waves: horizontal oscilloscope traces of layered sines and noise, scrolling left. */
export function telemetry(): Scene {
  let width = 0;
  let lanes: Lane[] = [];

  return {
    resize(w, h) {
      width = w;
      const n = clamp(Math.round(h / 170), 3, 6);
      lanes = Array.from({ length: n }, (_, i) => ({
        y: (h * (i + 1)) / (n + 1),
        amp: Math.min((h / (n + 1)) * 0.32, 46),
        speed: random(0.03, 0.08),
        seed: random(0, 1000),
        color: COLORS[i % COLORS.length] ?? 'accent',
        waves: Array.from({ length: 3 }, (_, k) => [
          random(0.2, 0.5) / (k + 1),
          random(0.004, 0.012) * (k + 1) ** 1.5,
          random(0, TAU),
        ]),
      }));
    },

    draw(ctx, t, theme) {
      for (const lane of lanes) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = theme.muted;
        setAlpha(ctx, 0.05);
        ctx.beginPath();
        ctx.moveTo(0, lane.y);
        ctx.lineTo(width, lane.y);
        for (let x = wrap(-lane.speed * t, TICK_PX); x < width; x += TICK_PX) {
          ctx.moveTo(x, lane.y - 4);
          ctx.lineTo(x, lane.y + 4);
        }
        ctx.stroke();

        ctx.beginPath();
        for (let x = 0; x <= width; x += STEP_PX) {
          const u = x + lane.speed * t;
          let v = NOISE_SHARE * valueNoise(u * 0.015 + lane.seed);
          for (const [share, frequency, phase] of lane.waves) v += share * Math.sin(u * frequency + phase);
          const y = lane.y + lane.amp * v;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = theme[lane.color];
        ctx.lineWidth = 3;
        setAlpha(ctx, 0.04);
        ctx.stroke();
        ctx.lineWidth = 1;
        setAlpha(ctx, 0.2);
        ctx.stroke();
      }
    },
  };
}
