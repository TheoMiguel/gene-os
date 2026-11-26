import { describe, expect, it } from 'vitest';
import { MAX_ALPHA, type SceneTheme } from './scene';
import { SCENES } from './scenes';

const THEME: SceneTheme = {
  accent: '#63c7b2',
  cyan: '#58b4d1',
  purple: '#9b8ec7',
  muted: '#829bae',
  mono: 'monospace',
};

/** A 2D context stand-in that records the highest alpha and any non-finite coordinate. */
function recordingContext() {
  const log = { calls: 0, maxAlpha: 0, nonFinite: [] as string[] };
  const state: Record<PropertyKey, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        log.calls += 1;
        if (args.some((arg) => typeof arg === 'number' && !Number.isFinite(arg)))
          log.nonFinite.push(String(key));
      };
    },
    set(target, key, value) {
      if (key === 'globalAlpha') log.maxAlpha = Math.max(log.maxAlpha, value as number);
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

describe.each(Object.entries(SCENES))('%s scene', (_, createScene) => {
  it.each([
    [2, 2],
    [390, 844],
    [3840, 2160],
  ])('stays subtle and finite on a %ix%i canvas', (width, height) => {
    const scene = createScene();
    const { ctx, log } = recordingContext();
    scene.resize(width, height);
    for (const time of [0, 1_234, 987_654]) scene.draw(ctx, time, THEME);

    expect(log.nonFinite).toEqual([]);
    expect(log.maxAlpha).toBeLessThanOrEqual(MAX_ALPHA);
  });

  it('draws marks on a phone-sized canvas', () => {
    const scene = createScene();
    const { ctx, log } = recordingContext();
    scene.resize(390, 844);
    scene.draw(ctx, 5_000, THEME);

    expect(log.calls).toBeGreaterThan(0);
    expect(log.maxAlpha).toBeGreaterThan(0);
  });
});
