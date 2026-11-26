import { downloadBlob, type SaveResult } from './download';

/** Style properties that decide how an SVG element looks. Their computed values are the literal ones. */
const PAINT_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgExportOptions {
  /** Fill behind the drawing. Default: the theme's page color, so light text stays readable. */
  readonly background?: string;
}

export interface SerializedSvg {
  readonly text: string;
  readonly width: number;
  readonly height: number;
}

function sizeOf(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.getBoundingClientRect();
  if (box.width > 0 && box.height > 0)
    return { width: Math.round(box.width), height: Math.round(box.height) };
  const view = svg.viewBox.baseVal;
  return { width: view.width || 300, height: view.height || 150 };
}

/**
 * A standalone SVG file's text for a rendered `<svg>`. Every theme color and font is resolved to a literal
 * value, so the file looks the same outside the page. Elements marked `data-export="skip"` (crosshairs,
 * tooltips, brushes) are left out.
 */
export function serializeSvg(svg: SVGSVGElement, options: SvgExportOptions = {}): SerializedSvg {
  const { width, height } = sizeOf(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];

  originals.forEach((original, index) => {
    const copy = copies[index];
    if (!copy) return;
    const computed = getComputedStyle(original);
    const style = PAINT_PROPERTIES.map((name) => [name, computed.getPropertyValue(name)] as const)
      .filter(([, value]) => value !== '')
      .map(([name, value]) => `${name}:${value}`)
      .join(';');
    copy.removeAttribute('class');
    copy.removeAttribute('style');
    if (style) copy.setAttribute('style', style);
  });
  for (const skipped of clone.querySelectorAll('[data-export="skip"]')) skipped.remove();

  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (!clone.hasAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.removeAttribute('aria-hidden');

  const background = options.background ?? getComputedStyle(svg).getPropertyValue('--bg').trim();
  if (background) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', background);
    clone.insertBefore(rect, clone.firstChild);
  }
  return {
    text: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`,
    width,
    height,
  };
}

/** The SVG as a Blob of type `image/svg+xml`. */
export function svgToBlob(svg: SVGSVGElement, options?: SvgExportOptions): Blob {
  return new Blob([serializeSvg(svg, options).text], { type: 'image/svg+xml;charset=utf-8' });
}

/**
 * Draws the SVG on a canvas `scale` times its on-screen size and returns a PNG. Rejects when the browser
 * cannot decode the drawing or make the image.
 */
export async function svgToPng(svg: SVGSVGElement, scale = 2, options?: SvgExportOptions): Promise<Blob> {
  const { text, width, height } = serializeSvg(svg, options);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2D canvas');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Saves the SVG as `<name>.svg`. */
export function downloadSvg(
  svg: SVGSVGElement,
  name: string,
  options?: SvgExportOptions,
): Promise<SaveResult> {
  return downloadBlob(svgToBlob(svg, options), `${name}.svg`);
}

/** Saves the SVG as `<name>.png`. */
export async function downloadPng(svg: SVGSVGElement, name: string, scale = 2): Promise<SaveResult> {
  try {
    return await downloadBlob(await svgToPng(svg, scale), `${name}.png`);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
