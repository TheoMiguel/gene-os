import { LUMINOSITIES, PALETTES } from '../../state/settings';

/**
 * WCAG 2.1 AA (contrast ratio >= 4.5 for normal text) for every luminosity x palette, computed from the
 * token file itself so a ported or edited value cannot silently break contrast.
 */
// Vitest blanks CSS imports, even `?raw`, so the file is read from disk. The project has no Node types.
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): unknown } }
).process.getBuiltinModule('node:fs') as { readFileSync(path: URL, encoding: 'utf8'): string };
const css = fs.readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing block ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]?.trim()]));
}

function tokens(luminosity: string, palette: string): (name: string) => string {
  const vars = {
    ...block(':root'),
    ...block(`:root[data-luminosity="${luminosity}"]`),
    ...block(`[data-palette="${palette}"]`),
  };
  const resolve = (name: string): string => {
    const value = vars[name];
    if (value === undefined) throw new Error(`undefined token ${name}`);
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    return ref?.[1] ? resolve(ref[1]) : value;
  };
  return resolve;
}

type Rgba = [number, number, number, number];

function parseColor(value: string, vars: (name: string) => string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\((.+)\)$/.exec(value);
  if (rgba?.[1]) {
    const parts = rgba[1].replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars(name)).split(',');
    const [r, g, b, a] = parts.map((p) => Number(p.trim()));
    return [r ?? 0, g ?? 0, b ?? 0, a ?? 1];
  }
  throw new Error(`unsupported color ${value}`);
}

const over = (top: Rgba, base: Rgba): Rgba => {
  const a = top[3];
  return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (base[i] ?? 0) * (1 - a)).concat(1) as Rgba;
};

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ['--fg', '--fg-muted', '--accent', '--cyan', '--warn', '--purple', '--danger'] as const;
const SURFACES = ['--bg', '--bg-solid-header', '--bg-panel', '--bg-card'] as const;
/** Selected tabs and segmented buttons draw accent text on the soft accent fill. */
const ACCENT_ON_SOFT = ['--accent', '--fg'] as const;

describe.each(LUMINOSITIES)('%s luminosity', (luminosity) => {
  it.each(PALETTES)('%s palette: text tokens reach 4.5:1 on every surface', (palette) => {
    const token = tokens(luminosity, palette);
    const color = (name: string) => parseColor(token(name), token);
    const bg = color('--bg');
    const failures: string[] = [];
    for (const surface of SURFACES) {
      const ground = over(color(surface), bg);
      for (const text of TEXT) {
        const ratio = contrast(color(text), ground);
        if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    const soft = over(color('--accent-soft'), bg);
    for (const text of ACCENT_ON_SOFT) {
      const ratio = contrast(color(text), soft);
      if (ratio < 4.5) failures.push(`${text} on --accent-soft: ${ratio.toFixed(2)}`);
    }
    const onAccent = contrast(color('--accent-contrast'), color('--accent'));
    if (onAccent < 4.5) failures.push(`--accent-contrast on --accent: ${onAccent.toFixed(2)}`);
    expect(failures.join('\n')).toBe('');
  });
});
