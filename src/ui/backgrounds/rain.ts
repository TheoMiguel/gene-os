import { bandOf, bands, hash01, random, type Scene, setAlpha, wrap } from './scene';

const CELL_PX = 18;
const FONT_PX = 13;
const BASES = 'ACGT';
/** Share of the columns that carry a drop. */
const DENSITY = 0.3;
const MAX_DROPS = 64;
const TRAIL_BANDS = 4;

interface Drop {
  readonly col: number;
  readonly x: number;
  /** Fall speed, pixels per millisecond. */
  readonly speed: number;
  /** Trail length in cells. */
  readonly length: number;
  readonly offset: number;
  /** Milliseconds between letter changes in a cell. */
  readonly tempo: number;
}

type Glyph = readonly [x: number, y: number, base: string];

function fillGlyphs(ctx: CanvasRenderingContext2D, glyphs: readonly Glyph[]): void {
  for (const [x, y, base] of glyphs) ctx.fillText(base, x, y);
}

/** DNA rain: sparse columns of falling A, C, G and T letters with fading trails. */
export function rain(): Scene {
  let height = 0;
  let drops: Drop[] = [];

  return {
    resize(w, h) {
      height = h;
      const cols = Array.from({ length: Math.max(1, Math.floor(w / CELL_PX)) }, (_, col) => col);
      drops = cols
        .filter(() => Math.random() < DENSITY)
        .slice(0, MAX_DROPS)
        .map((col) => ({
          col,
          x: col * CELL_PX + CELL_PX / 2,
          speed: random(0.025, 0.07),
          length: Math.round(random(6, 18)),
          offset: random(0, 4000),
          tempo: random(350, 900),
        }));
    },

    draw(ctx, t, theme) {
      const heads: Glyph[] = [];
      const trail = bands<Glyph>(TRAIL_BANDS);
      for (const d of drops) {
        const headRow = Math.floor(wrap(d.offset + d.speed * t, height + d.length * CELL_PX) / CELL_PX);
        for (let k = 0; k < d.length; k++) {
          const row = headRow - k;
          const y = row * CELL_PX;
          if (row < 0 || y > height) continue;
          const pick = hash01(d.col * 131 + row * 977 + Math.floor((t + row * 61) / d.tempo));
          const glyph: Glyph = [d.x, y, BASES.charAt(Math.floor(pick * BASES.length))];
          if (k === 0) heads.push(glyph);
          else trail[bandOf(1 - k / d.length, TRAIL_BANDS)]?.push(glyph);
        }
      }

      ctx.font = `${FONT_PX}px ${theme.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = theme.cyan;
      trail.forEach((glyphs, i) => {
        setAlpha(ctx, 0.03 + 0.04 * i);
        fillGlyphs(ctx, glyphs);
      });
      ctx.fillStyle = theme.accent;
      setAlpha(ctx, 0.3);
      fillGlyphs(ctx, heads);
    },
  };
}
