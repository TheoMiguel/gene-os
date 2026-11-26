import type { Scene, SceneTheme } from './scene';

const MAX_PIXEL_RATIO = 1.5;
const BASE_INTERVAL_MS = 1000 / 30;
const MAX_INTERVAL_MS = 1000 / 7.5;
/** Average draw time above which the loop halves its frame rate. */
const BUDGET_MS = 6;
/** Frames measured after each rate change before the next one. */
const SAMPLES = 20;
/** rAF timestamps jitter; a frame this early still counts as due. */
const JITTER_MS = 1;

/** A running background loop. */
export interface SceneLoop {
  /** Draws with a new theme from the next frame on, and repaints at once for a still background. */
  setTheme(theme: SceneTheme): void;
  /** Cancels the frame loop and removes every listener and observer. */
  stop(): void;
}

/**
 * Draws `scene` on `canvas` at up to 30 fps. The rate halves, down to 7.5 fps, while the average draw time
 * exceeds the budget. The loop pauses while the page is hidden, and a user who prefers reduced motion
 * gets one still frame.
 */
export function runScene(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  initialTheme: SceneTheme,
): SceneLoop {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let theme = initialTheme;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let frame = 0;
  let lastFrame = Number.NEGATIVE_INFINITY;
  let interval = BASE_INTERVAL_MS;
  let averageCost = 0;
  let samples = 0;

  const paint = (now: number) => {
    ctx.clearRect(0, 0, width, height);
    if (width > 0 && height > 0) scene.draw(ctx, now, theme);
  };

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === width && h === height && ratio === pixelRatio) return;
    width = w;
    height = h;
    pixelRatio = ratio;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    scene.resize(w, h);
    paint(performance.now());
  };

  const govern = (cost: number) => {
    averageCost = samples === 0 ? cost : averageCost * 0.9 + cost * 0.1;
    samples += 1;
    if (samples >= SAMPLES && averageCost > BUDGET_MS && interval < MAX_INTERVAL_MS) {
      interval *= 2;
      samples = 0;
    }
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (now - lastFrame < interval - JITTER_MS) return;
    lastFrame = now;
    const start = performance.now();
    paint(now);
    govern(performance.now() - start);
  };

  const sync = () => {
    const animate = !reducedMotion.matches && !document.hidden;
    if (animate && frame === 0) frame = requestAnimationFrame(tick);
    if (!animate && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  sync();
  reducedMotion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);

  return {
    setTheme(next) {
      theme = next;
      paint(performance.now());
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      reducedMotion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    },
  };
}
