import { t } from '../../i18n';
import { type AlignmentDisplay, classRuns, matchLine, rulerTicks } from './model';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHAR_W = 9;
const ROW_H = 16;
const RULER_H = 22;
const BARS_H = 30;
const LABEL_CHAR_W = 7.4;
const MONO = 'JetBrains Mono, Consolas, monospace';

/** Widest span of columns an image covers. A longer alignment is cut to the part on screen. */
export const MAX_IMAGE_COLUMNS = 4000;

/** The theme colors as literal values, because a saved image has no page to resolve `var(--accent)`. */
function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: read('--bg', '#08121a'),
    fg: read('--fg', '#e4eef4'),
    muted: read('--fg-muted', '#829bae'),
    accent: read('--accent', '#63c7b2'),
    cyan: read('--cyan', '#58b4d1'),
    danger: read('--danger', '#e07a7a'),
    warn: read('--warn', '#d9a75b'),
  };
}

function element(name: string, attributes: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A standalone drawing of columns `[from, to)` of an alignment: ruler, each row coloured by column class, the match
 * line of a pair, and the consensus and conservation bars of a multiple alignment. Colors are literal.
 */
export function buildAlignmentSvg(display: AlignmentDisplay, from: number, to: number): SVGSVGElement {
  const colors = themeColors();
  const tint = [colors.accent, colors.cyan, colors.danger, colors.warn];
  const columns = to - from;
  const labelWidth = Math.min(
    220,
    Math.max(60, Math.max(...display.labels.map((l) => l.length)) * LABEL_CHAR_W + 14),
  );
  const lines: { label: string; text: string; tinted: boolean }[] = [];
  const slice = (text: string) => text.slice(from, to);
  if (display.kind === 'pair') {
    lines.push({ label: display.labels[0] ?? '', text: slice(display.rows[0] as string), tinted: true });
    lines.push({ label: '', text: matchLine(display.classes, from, to), tinted: false });
    lines.push({ label: display.labels[1] ?? '', text: slice(display.rows[1] as string), tinted: true });
  } else {
    display.rows.forEach((row, i) => {
      lines.push({ label: display.labels[i] ?? '', text: slice(row), tinted: true });
    });
    if (display.consensus !== undefined)
      lines.push({ label: t('align.consensus'), text: slice(display.consensus), tinted: false });
  }
  const bars = display.conservation !== undefined;
  const width = labelWidth + columns * CHAR_W + 10;
  const height = RULER_H + lines.length * ROW_H + (bars ? BARS_H + 6 : 0) + 6;
  const svg = element('svg', { viewBox: `0 0 ${width} ${height}`, width, height }) as SVGSVGElement;
  svg.append(element('rect', { width, height, fill: colors.bg }));

  const x0 = labelWidth;
  for (const c of rulerTicks(from, to)) {
    const x = x0 + (c - from) * CHAR_W + CHAR_W / 2;
    svg.append(
      element(
        'text',
        { x, y: 11, 'text-anchor': 'middle', 'font-size': 9, 'font-family': MONO, fill: colors.muted },
        String(c + 1),
      ),
      element('line', { x1: x, x2: x, y1: 14, y2: 19, stroke: colors.muted, 'stroke-width': 1 }),
    );
  }
  lines.forEach((line, i) => {
    const y = RULER_H + i * ROW_H;
    if (line.tinted) {
      for (const run of classRuns(display.classes, from, to)) {
        svg.append(
          element('rect', {
            x: x0 + (run.from - from) * CHAR_W,
            y,
            width: (run.to - run.from) * CHAR_W,
            height: ROW_H,
            fill: tint[run.cls] ?? colors.fg,
            'fill-opacity': 0.3,
          }),
        );
      }
    }
    svg.append(
      element(
        'text',
        { x: 4, y: y + 12, 'font-size': 11, 'font-family': MONO, fill: colors.muted },
        line.label,
      ),
      element(
        'text',
        {
          x: x0,
          y: y + 12,
          'font-size': 12,
          'font-family': MONO,
          fill: colors.fg,
          textLength: columns * CHAR_W,
          lengthAdjust: 'spacing',
          'xml:space': 'preserve',
        },
        line.text,
      ),
    );
  });
  if (display.conservation) {
    const base = RULER_H + lines.length * ROW_H + 6 + BARS_H;
    svg.append(
      element(
        'text',
        { x: 4, y: base - 4, 'font-size': 11, 'font-family': MONO, fill: colors.muted },
        t('align.conservation'),
      ),
    );
    for (let c = from; c < to; c++) {
      const h = (display.conservation[c] as number) * BARS_H;
      svg.append(
        element('rect', {
          x: x0 + (c - from) * CHAR_W + 1,
          y: base - h,
          width: CHAR_W - 2,
          height: h,
          fill: colors.accent,
          'fill-opacity': 0.85,
        }),
      );
    }
  }
  return svg;
}
