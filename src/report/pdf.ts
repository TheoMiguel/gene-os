import { type FontId, textWidth, winAnsiCode } from './fonts';

/** A4 in points. */
export const A4 = { width: 595.28, height: 841.89 } as const;

export type Rgb = readonly [number, number, number];

/** Colour from a `#rrggbb` string. */
export function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

const FONT_NAMES: Readonly<Record<FontId, { resource: string; base: string }>> = {
  regular: { resource: 'F1', base: 'Helvetica' },
  bold: { resource: 'F2', base: 'Helvetica-Bold' },
  mono: { resource: 'F3', base: 'Courier' },
};

const num = (value: number) => (Math.round(value * 100) / 100).toString();
const color = (value: Rgb) => value.map((channel) => num(channel)).join(' ');

/** A PDF literal string: WinAnsi bytes, with delimiters and everything outside printable ASCII in octal escapes. */
function literal(text: string): string {
  let out = '(';
  for (const char of text) {
    const code = winAnsiCode(char);
    if (code === 40 || code === 41 || code === 92) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

/** A PDF text string for metadata: UTF-16BE with a byte order mark, as hex, so any character survives. */
function unicodeString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

export interface TextOptions {
  readonly font?: FontId;
  readonly size?: number;
  readonly color?: Rgb;
  readonly align?: 'start' | 'middle' | 'end';
}

export interface StrokeOptions {
  readonly color?: Rgb;
  readonly width?: number;
  readonly dash?: readonly number[];
  readonly cap?: 'butt' | 'round';
}

export interface ShapeOptions extends StrokeOptions {
  readonly fill?: Rgb;
  /** Draw the outline. Default: only when there is no fill. */
  readonly stroke?: boolean;
}

const INK: Rgb = [0.1, 0.13, 0.17];

/**
 * One page. Coordinates are in points from the top-left corner, y growing downward, so layout code reads like
 * the page. Everything drawn is vector: text, lines, rectangles and polylines.
 */
export class PdfPage {
  private readonly ops: string[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /** Writes `content` with its baseline at `y`. Returns the width it took. */
  text(x: number, y: number, content: string, options: TextOptions = {}): number {
    const { font = 'regular', size = 10, color: ink = INK, align = 'start' } = options;
    const width = textWidth(content, font, size);
    const left = align === 'middle' ? x - width / 2 : align === 'end' ? x - width : x;
    this.ops.push(
      `BT /${FONT_NAMES[font].resource} ${num(size)} Tf ${color(ink)} rg ${num(left)} ${num(this.height - y)} Td ${literal(content)} Tj ET`,
    );
    return width;
  }

  private stroke(options: StrokeOptions): string {
    const { color: ink = INK, width = 1, dash, cap = 'butt' } = options;
    return `${color(ink)} RG ${num(width)} w ${cap === 'round' ? 1 : 0} J [${(dash ?? []).map(num).join(' ')}] 0 d`;
  }

  line(x1: number, y1: number, x2: number, y2: number, options: StrokeOptions = {}): void {
    this.ops.push(
      `q ${this.stroke(options)} ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S Q`,
    );
  }

  /** An open path through `points`. NaN or infinite y values break the path, which is how a chart shows a gap. */
  polyline(points: readonly (readonly [number, number])[], options: StrokeOptions = {}): void {
    let path = '';
    let pen = false;
    for (const [x, y] of points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pen = false;
        continue;
      }
      path += `${num(x)} ${num(this.height - y)} ${pen ? 'l' : 'm'} `;
      pen = true;
    }
    if (path !== '') this.ops.push(`q ${this.stroke(options)} ${path}S Q`);
  }

  rect(x: number, y: number, width: number, height: number, options: ShapeOptions = {}): void {
    const { fill, stroke = fill === undefined } = options;
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    const fillOps = fill ? `${color(fill)} rg ` : '';
    this.ops.push(
      `q ${stroke ? `${this.stroke(options)} ` : ''}${fillOps}${num(x)} ${num(this.height - y - height)} ${num(width)} ${num(height)} re ${paint} Q`,
    );
  }

  /** A closed, filled polygon. */
  polygon(points: readonly (readonly [number, number])[], fill: Rgb): void {
    if (points.length < 3) return;
    const path = points
      .map(([x, y], i) => `${num(x)} ${num(this.height - y)} ${i === 0 ? 'm' : 'l'}`)
      .join(' ');
    this.ops.push(`q ${color(fill)} rg ${path} h f Q`);
  }

  /** The page's content stream. */
  content(): string {
    return this.ops.join('\n');
  }
}

export interface PdfInfo {
  readonly title: string;
  readonly author: string;
  readonly subject: string;
  readonly created: Date;
}

const pdfDate = (date: Date) =>
  `(D:${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z)`;

/**
 * A PDF 1.4 writer for text and vector drawing. It writes plain, uncompressed streams and the three standard
 * fonts, so the output is one ASCII string with an exact cross-reference table that every viewer opens.
 */
export class PdfDocument {
  readonly pages: PdfPage[] = [];

  constructor(private readonly info: PdfInfo) {}

  addPage(width = A4.width, height = A4.height): PdfPage {
    const page = new PdfPage(width, height);
    this.pages.push(page);
    return page;
  }

  /** The file. Throws when no page was added, since a PDF needs one. */
  toBytes(): Uint8Array {
    if (this.pages.length === 0) throw new RangeError('a PDF needs at least one page');
    const fontIds = Object.keys(FONT_NAMES) as FontId[];
    // Object numbers: 1 catalog, 2 page tree, 3 info, 4..6 fonts, then a page and its content stream per page.
    const firstFont = 4;
    const firstPage = firstFont + fontIds.length;
    const objects: string[] = [];
    const fonts = fontIds.map((id, i) => `/${FONT_NAMES[id].resource} ${firstFont + i} 0 R`).join(' ');
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')}] /Count ${this.pages.length} >>`;
    objects[3] = `<< /Title ${unicodeString(this.info.title)} /Author ${unicodeString(this.info.author)} /Subject ${unicodeString(this.info.subject)} /Creator ${unicodeString('GENE_OS')} /Producer ${unicodeString('GENE_OS PDF writer')} /CreationDate ${pdfDate(this.info.created)} >>`;
    fontIds.forEach((id, i) => {
      objects[firstFont + i] =
        `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAMES[id].base} /Encoding /WinAnsiEncoding >>`;
    });
    this.pages.forEach((page, i) => {
      const pageNumber = firstPage + i * 2;
      const stream = page.content();
      objects[pageNumber] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << ${fonts} >> >> /Contents ${pageNumber + 1} 0 R >>`;
      objects[pageNumber + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    let file = '%PDF-1.4\n%âãÏÓ\n';
    const offsets: number[] = [];
    for (let n = 1; n < objects.length; n++) {
      offsets[n] = file.length;
      file += `${n} 0 obj\n${objects[n]}\nendobj\n`;
    }
    const xref = file.length;
    file += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let n = 1; n < objects.length; n++) file += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    file += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(file.length);
    for (let i = 0; i < file.length; i++) bytes[i] = file.charCodeAt(i) & 0xff;
    return bytes;
  }
}
