/** The three standard PDF fonts every viewer has, so the file embeds no font data. */
export type FontId = 'regular' | 'bold' | 'mono';

/** Widths of the ASCII characters 32 to 126 in 1/1000 em, from the Adobe Helvetica metrics. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
] as const;

/** The same for Helvetica-Bold. */
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278,
  556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584,
  556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556,
  333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
] as const;

const MONO_WIDTH = 600;

/** Windows-1252 code of the characters above ASCII that the standard fonts draw, keyed by Unicode. */
const WIN_ANSI_HIGH: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

/** The WinAnsi byte of a character, or `?` for one the standard fonts cannot draw. */
export function winAnsiCode(char: string): number {
  const code = char.codePointAt(0) ?? 63;
  if (code >= 32 && code < 127) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return WIN_ANSI_HIGH.get(code) ?? 63;
}

/** Width of one character in 1/1000 em. Accented letters take the width of their base letter, near enough for layout. */
function charWidth(font: FontId, char: string): number {
  if (font === 'mono') return MONO_WIDTH;
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA;
  const code = winAnsiCode(char);
  if (code >= 32 && code < 127) return table[code - 32] as number;
  const base = char.normalize('NFD')[0] ?? '?';
  const baseCode = base.codePointAt(0) ?? 63;
  return baseCode >= 32 && baseCode < 127 ? (table[baseCode - 32] as number) : 556;
}

/** Width of `text` set in `font` at `size` points. */
export function textWidth(text: string, font: FontId, size: number): number {
  let total = 0;
  for (const char of text) total += charWidth(font, char);
  return (total * size) / 1000;
}
