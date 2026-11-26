import type { BackgroundId } from '../../state/settings';

/** A background setting that draws a scene; 'off' draws nothing. */
export type SceneId = Exclude<BackgroundId, 'off'>;

/** Colors and font a scene draws with, read from the design tokens. */
export interface SceneTheme {
  readonly accent: string;
  readonly cyan: string;
  readonly purple: string;
  readonly muted: string;
  readonly mono: string;
}

/**
 * An animated background. `draw` derives every position from `timeMs`, so the motion keeps its speed at
 * any frame rate and one call alone yields a valid still frame.
 */
export interface Scene {
  /** Lays the scene out for a canvas of `width` x `height` CSS pixels. */
  resize(width: number, height: number): void;
  draw(ctx: CanvasRenderingContext2D, timeMs: number, theme: SceneTheme): void;
}

/** Creates a scene with a fresh random layout. */
export type SceneFactory = () => Scene;

/** Highest alpha any mark may use, so text over the background keeps its contrast. */
export const MAX_ALPHA = 0.35;

/** A full turn in radians. */
export const TAU = Math.PI * 2;

/** A dot to fill: center and radius. */
export type Dot = readonly [x: number, y: number, radius: number];
/** A line to stroke: both end points. */
export type Segment = readonly [x1: number, y1: number, x2: number, y2: number];

/** Sets the alpha of the next marks, capped at `MAX_ALPHA`. */
export function setAlpha(ctx: CanvasRenderingContext2D, value: number): void {
  ctx.globalAlpha = Math.min(value, MAX_ALPHA);
}

/** Clamps `value` to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Object count for a `width` x `height` area: one per `areaPerObject` square pixels, within [min, max]. */
export function countFor(
  width: number,
  height: number,
  areaPerObject: number,
  min: number,
  max: number,
): number {
  return Math.round(clamp((width * height) / areaPerObject, min, max));
}

/** Uniform random number in [min, max). */
export function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Wraps `value` into [0, size), also for negative values. */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Deterministic pseudo-random number in [0, 1) for a seed. */
export function hash01(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** `count` empty bands. Marks of similar strength share a band, so each band is one path with one alpha. */
export function bands<T>(count: number): T[][] {
  return Array.from({ length: count }, () => []);
}

/** The band of `count` that holds a mark of `strength` (0..1). */
export function bandOf(strength: number, count: number): number {
  return clamp(Math.floor(strength * count), 0, count - 1);
}

/** Fills all `dots` as one path. */
export function fillDots(ctx: CanvasRenderingContext2D, dots: readonly Dot[]): void {
  ctx.beginPath();
  for (const [x, y, r] of dots) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill();
}

/** Strokes all `segments` as one path. */
export function strokeSegments(ctx: CanvasRenderingContext2D, segments: readonly Segment[]): void {
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segments) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}
