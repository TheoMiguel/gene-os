/** Text measuring and shortening shared by both maps. Characters are estimated, so layout needs no DOM. */

export const LABEL_FONT = 11;
export const LABEL_HEIGHT = 13;
const CHAR_RATIO = 0.62;

/** Width in px of `text` at `size` px, estimated from the character count. */
export function textWidth(text: string, size = LABEL_FONT): number {
  return text.length * size * CHAR_RATIO;
}

/** `text` cut to fit `width` px, with an ellipsis. */
export function fitText(text: string, width: number, size = LABEL_FONT): string {
  const room = Math.floor(width / (size * CHAR_RATIO));
  if (text.length <= room) return text;
  return room <= 1 ? '' : `${text.slice(0, room - 1)}…`;
}

/** A base-pair position as a short scale label: 500, 2k, 1.5M. */
export function formatBp(value: number): string {
  const trim = (n: number) => String(Number(n.toFixed(2)));
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1000) return `${trim(value / 1000)}k`;
  return String(value);
}

/** A round step for scale ticks that gives about `target` ticks across `span`. */
export function niceStep(span: number, target: number): number {
  const raw = Math.max(1, span / Math.max(1, target));
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}
