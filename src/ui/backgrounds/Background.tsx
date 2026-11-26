import { useEffect, useRef } from 'preact/hooks';
import type { BackgroundId } from '../../state/settings';
import { runScene, type SceneLoop } from './loop';
import type { SceneTheme } from './scene';
import { SCENES } from './scenes';

function readTheme(): SceneTheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    accent: token('--accent'),
    cyan: token('--cyan'),
    purple: token('--purple'),
    muted: token('--fg-muted'),
    mono: token('--mono'),
  };
}

/**
 * The animated backdrop behind the app, or nothing for 'off'. `themeKey` must change whenever the color
 * tokens change, so the scene re-reads them.
 */
export function Background({ scene, themeKey }: { scene: BackgroundId; themeKey: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<SceneLoop | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (scene === 'off' || !canvas || !ctx) return;
    const loop = runScene(canvas, ctx, SCENES[scene](), readTheme());
    loopRef.current = loop;
    return () => {
      loop.stop();
      loopRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    loopRef.current?.setTheme(readTheme());
  }, [themeKey]);

  if (scene === 'off') return null;
  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas without tabindex takes no focus; this one is decoration.
  return <canvas ref={canvasRef} class="bg-canvas" aria-hidden="true" />;
}
