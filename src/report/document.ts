import type { AlignMode } from '../engine/align';
import { ColumnClass, type Difference } from '../engine/align';
import type { ComparisonData, RestrictionRow, SequenceSummary } from './compare';
import { drawBarChart, drawLineChart, drawMark, PALETTE } from './draw';
import { textWidth } from './fonts';
import type { ReportText } from './labels';
import { A4, PdfDocument, type PdfPage, type Rgb } from './pdf';

const MARGIN = 48;
const CONTENT_WIDTH = A4.width - 2 * MARGIN;
const BOTTOM = A4.height - 58;
const TOP = 64;

/** Alignment columns per printed block, and the most columns the report prints (the difference list covers the rest). */
const BLOCK_COLUMNS = 80;
const MAX_ALIGNMENT_COLUMNS = 6400;
/** Most rows of the difference table. */
const MAX_DIFFERENCE_ROWS = 400;
/** A sequence with more cuts than this for one enzyme gets no tick on the map; the table still lists it. */
const MAX_MAP_CUTS = 3;

export interface ReportMeta {
  readonly projectName: string;
  /** ISO 8601 date and time of the report. */
  readonly generated: string;
  /** BCP 47 tag for number grouping, such as `es`. */
  readonly locale: string;
  readonly mode: AlignMode;
}

function pageNumbers(doc: PdfDocument, t: ReportText, projectName: string): void {
  const total = doc.pages.length;
  doc.pages.forEach((page, index) => {
    if (index === 0) return;
    page.line(MARGIN, A4.height - 42, A4.width - MARGIN, A4.height - 42, { color: PALETTE.rule, width: 0.5 });
    page.text(MARGIN, A4.height - 28, 'GENE_OS', { font: 'bold', size: 8, color: PALETTE.accent });
    page.text(A4.width / 2, A4.height - 28, projectName, { size: 8, color: PALETTE.muted, align: 'middle' });
    page.text(A4.width - MARGIN, A4.height - 28, t('report.page', { page: index + 1, pages: total }), {
      size: 8,
      color: PALETTE.muted,
      align: 'end',
    });
  });
}

/** Cuts `text` with an ellipsis so it fits `width` points. */
function ellipsize(
  text: string,
  width: number,
  size: number,
  font: 'regular' | 'bold' | 'mono' = 'regular',
): string {
  if (textWidth(text, font, size) <= width) return text;
  // No character is narrower than a fifth of the font size, so what lies beyond this cut never fits.
  let out = text.slice(0, Math.ceil(width / (size * 0.2)));
  while (out.length > 1 && textWidth(`${out}\u2026`, font, size) > width) out = out.slice(0, -1);
  return `${out}\u2026`;
}

/** Breaks `text` into lines no wider than `width`. */
function wrap(text: string, width: number, size: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line === '' ? word : `${line} ${word}`;
    if (line !== '' && textWidth(next, 'regular', size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line !== '') lines.push(line);
  return lines;
}

interface Column<Row> {
  readonly header: string;
  readonly width: number;
  readonly align?: 'start' | 'end';
  readonly cell: (row: Row, index: number) => string;
  readonly font?: 'regular' | 'mono';
}

/** Page flow: a cursor that moves down and starts a new page when the next block does not fit. */
class Flow {
  page!: PdfPage;
  y = TOP;
  private sectionCount = 0;

  constructor(
    readonly doc: PdfDocument,
    readonly t: ReportText,
    readonly format: (value: number, decimals?: number) => string,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage();
    this.y = TOP;
  }

  ensure(height: number): void {
    if (this.y + height > BOTTOM) this.newPage();
  }

  /** A numbered section heading, in the style of the app's `01 //` tab labels. */
  section(title: string): void {
    if (this.y > TOP) this.y += 14;
    this.ensure(110);
    this.sectionCount++;
    this.page.text(MARGIN, this.y, `${String(this.sectionCount).padStart(2, '0')} //`, {
      font: 'mono',
      size: 9,
      color: PALETTE.accent,
    });
    this.page.text(MARGIN + 28, this.y + 1, title, { font: 'bold', size: 15 });
    this.page.line(MARGIN, this.y + 9, A4.width - MARGIN, this.y + 9, { color: PALETTE.accent, width: 1.2 });
    this.y += 28;
  }

  paragraph(text: string, options: { size?: number; color?: Rgb } = {}): void {
    const { size = 9.5, color = PALETTE.ink } = options;
    for (const line of wrap(text, CONTENT_WIDTH, size)) {
      this.ensure(size + 5);
      this.page.text(MARGIN, this.y, line, { size, color });
      this.y += size + 4;
    }
    this.y += 4;
  }

  /** A row of big numbers with captions. */
  kpis(items: readonly { label: string; value: string }[]): void {
    this.ensure(58);
    const gap = 10;
    const width = (CONTENT_WIDTH - gap * (items.length - 1)) / items.length;
    items.forEach((item, i) => {
      const x = MARGIN + i * (width + gap);
      this.page.rect(x, this.y, width, 48, { stroke: true, color: PALETTE.rule, width: 0.8 });
      this.page.rect(x, this.y, 3, 48, { fill: PALETTE.accent });
      this.page.text(x + 12, this.y + 29, item.value, { font: 'bold', size: 20 });
      this.page.text(x + 12, this.y + 42, item.label.toUpperCase(), {
        font: 'mono',
        size: 7,
        color: PALETTE.muted,
      });
    });
    this.y += 60;
  }

  /** A table with a header that repeats on each page and zebra rows. */
  table<Row>(columns: readonly Column<Row>[], rows: readonly Row[], rowHeight = 15): void {
    const header = () => {
      this.ensure(rowHeight * 3);
      this.page.rect(MARGIN, this.y, CONTENT_WIDTH, rowHeight, { fill: PALETTE.ink });
      let x = MARGIN;
      for (const column of columns) {
        const at = column.align === 'end' ? x + column.width - 5 : x + 5;
        this.page.text(at, this.y + 10.5, ellipsize(column.header, column.width - 8, 7.5, 'regular'), {
          font: 'bold',
          size: 7.5,
          color: PALETTE.white,
          align: column.align ?? 'start',
        });
        x += column.width;
      }
      this.y += rowHeight;
    };
    header();
    rows.forEach((row, index) => {
      if (this.y + rowHeight > BOTTOM) {
        this.newPage();
        header();
      }
      if (index % 2 === 1) this.page.rect(MARGIN, this.y, CONTENT_WIDTH, rowHeight, { fill: PALETTE.zebra });
      let x = MARGIN;
      for (const column of columns) {
        const font = column.font ?? 'regular';
        const text = ellipsize(column.cell(row, index), column.width - 8, 8, font);
        const at = column.align === 'end' ? x + column.width - 5 : x + 5;
        this.page.text(at, this.y + 10.5, text, { font, size: 8, align: column.align ?? 'start' });
        x += column.width;
      }
      this.y += rowHeight;
    });
    this.y += 8;
  }
}

function titlePage(flow: Flow, data: ComparisonData, meta: ReportMeta): void {
  const { t, page } = flow;
  drawMark(page, MARGIN, 56, 54, PALETTE.accent, PALETTE.a);
  page.text(MARGIN + 66, 92, 'GENE_OS', { font: 'bold', size: 26 });
  page.line(MARGIN, 150, A4.width - MARGIN, 150, { color: PALETTE.accent, width: 2 });
  page.text(MARGIN, 215, t('report.title').toUpperCase(), { font: 'mono', size: 10, color: PALETTE.accent });
  const projectName = meta.projectName.trim() || t('report.untitled');
  let y = 255;
  for (const line of wrap(projectName, CONTENT_WIDTH, 30).slice(0, 3)) {
    page.text(MARGIN, y, line, { font: 'bold', size: 30 });
    y += 38;
  }
  y += 14;
  for (const [tag, color, summary] of [
    [t('report.seqA'), PALETTE.a, data.a],
    [t('report.seqB'), PALETTE.b, data.b],
  ] as const) {
    page.rect(MARGIN, y - 9, 6, 6, { fill: color });
    page.text(MARGIN + 14, y - 3, tag.toUpperCase(), { font: 'mono', size: 8, color: PALETTE.muted });
    page.text(MARGIN + 14, y + 14, ellipsize(summary.name, CONTENT_WIDTH - 14, 15, 'bold'), {
      font: 'bold',
      size: 15,
    });
    y += 46;
  }
  const date = meta.generated.slice(0, 10);
  page.text(MARGIN, A4.height - 120, `${t('report.project').toUpperCase()}`, {
    font: 'mono',
    size: 8,
    color: PALETTE.muted,
  });
  page.text(MARGIN, A4.height - 106, projectName, { size: 11 });
  page.text(MARGIN + 260, A4.height - 120, t('report.date').toUpperCase(), {
    font: 'mono',
    size: 8,
    color: PALETTE.muted,
  });
  page.text(MARGIN + 260, A4.height - 106, date, { size: 11 });
  page.line(MARGIN, A4.height - 80, A4.width - MARGIN, A4.height - 80, { color: PALETTE.rule, width: 0.6 });
  page.text(MARGIN, A4.height - 62, t('report.generatedBy'), { size: 8, color: PALETTE.muted });
}

function lengthText(flow: Flow, summary: SequenceSummary): string {
  return flow.t(summary.alphabet === 'protein' ? 'report.unit.aa' : 'report.unit.bp', {
    count: flow.format(summary.length),
  });
}

function summaryCard(
  flow: Flow,
  x: number,
  width: number,
  summary: SequenceSummary,
  tag: string,
  color: Rgb,
): number {
  const { page, t } = flow;
  const top = flow.y;
  const rows: [string, string][] = [
    [t('report.field.length'), lengthText(flow, summary)],
    [t('report.field.type'), t(`alphabet.${summary.alphabet}`)],
    [t('report.field.topology'), t(`topology.${summary.topology}`)],
  ];
  if (summary.gc !== null) rows.push([t('report.field.gc'), `${flow.format(summary.gc * 100, 1)}%`]);
  if (summary.accession) rows.push([t('report.field.accession'), summary.accession]);
  if (summary.organism) rows.push([t('report.field.organism'), summary.organism]);

  page.rect(x, top, width, 24, { fill: color });
  page.text(x + 10, top + 16, tag.toUpperCase(), { font: 'mono', size: 8, color: PALETTE.white });
  page.text(x + width - 10, top + 16, ellipsize(summary.name, width - 110, 10, 'bold'), {
    font: 'bold',
    size: 10,
    color: PALETTE.white,
    align: 'end',
  });
  let y = top + 42;
  for (const [label, value] of rows) {
    page.text(x + 10, y, label, { size: 8.5, color: PALETTE.muted });
    page.text(x + width - 10, y, ellipsize(value, width - 100, 9, 'regular'), { size: 9, align: 'end' });
    y += 17;
  }
  if (summary.description) {
    for (const line of wrap(summary.description, width - 20, 8.5).slice(0, 3)) {
      page.text(x + 10, y + 2, line, { size: 8.5, color: PALETTE.muted });
      y += 12;
    }
  }

  y += 10;
  page.text(x + 10, y, t('report.field.composition').toUpperCase(), {
    font: 'mono',
    size: 7,
    color: PALETTE.muted,
  });
  y += 8;
  const shades = [PALETTE.a, PALETTE.accent, PALETTE.b, rgbShade(0.45), PALETTE.gap];
  let barX = x + 10;
  summary.composition.forEach((entry, i) => {
    const span = (width - 20) * entry.fraction;
    page.rect(barX, y, span, 10, { fill: shades[i % shades.length] ?? PALETTE.gap });
    barX += span;
  });
  y += 24;
  summary.composition.forEach((entry, i) => {
    const column = i % 2;
    const row = Math.floor(i / 2);
    const px = x + 10 + column * ((width - 20) / 2);
    const py = y + row * 13;
    page.rect(px, py - 7, 7, 7, { fill: shades[i % shades.length] ?? PALETTE.gap });
    const letter = entry.letter === '*' ? t('report.composition.other') : entry.letter;
    page.text(
      px + 11,
      py,
      `${letter}  ${flow.format(entry.count)}  (${flow.format(entry.fraction * 100, 1)}%)`,
      {
        size: 8,
        font: 'regular',
      },
    );
  });
  y += Math.ceil(summary.composition.length / 2) * 13 + 6;
  page.rect(x, top, width, y - top, { stroke: true, color: PALETTE.rule, width: 0.8 });
  return y - top;
}

function rgbShade(level: number): Rgb {
  return [level, level, level];
}

function summarySection(flow: Flow, data: ComparisonData): void {
  const { t } = flow;
  flow.section(t('report.section.summary'));
  flow.ensure(320);
  const gap = 14;
  const width = (CONTENT_WIDTH - gap) / 2;
  const left = summaryCard(flow, MARGIN, width, data.a, t('report.seqA'), PALETTE.a);
  const right = summaryCard(flow, MARGIN + width + gap, width, data.b, t('report.seqB'), PALETTE.b);
  flow.y += Math.max(left, right) + 20;
}

const MARKS = {
  [ColumnClass.Identical]: '|',
  [ColumnClass.Similar]: ':',
  [ColumnClass.Mismatch]: ' ',
  [ColumnClass.Gap]: ' ',
};
const SHADES: Record<number, Rgb | undefined> = {
  [ColumnClass.Similar]: PALETTE.similar,
  [ColumnClass.Mismatch]: PALETTE.mismatch,
  [ColumnClass.Gap]: PALETTE.gap,
};

function alignmentSection(flow: Flow, data: ComparisonData, meta: ReportMeta): void {
  const { t } = flow;
  flow.section(t('report.section.alignment'));
  const outcome = data.alignment;
  if (outcome.status === 'too-large') {
    flow.paragraph(
      t('report.alignment.tooLarge', {
        cells: flow.format(outcome.cells),
        limit: flow.format(outcome.limit),
      }),
    );
    return;
  }
  if (outcome.status === 'incompatible') {
    flow.paragraph(t('report.alignment.incompatible'));
    return;
  }
  const { alignment, differences } = outcome;
  const { stats } = alignment;
  flow.kpis([
    { label: t('report.kpi.identity'), value: `${flow.format(stats.percentIdentity, 2)}%` },
    { label: t('report.kpi.similarity'), value: `${flow.format(stats.percentSimilarity, 2)}%` },
    { label: t('report.kpi.differences'), value: flow.format(differences.length) },
    { label: t('report.kpi.score'), value: flow.format(alignment.score, 1) },
  ]);
  flow.paragraph(t('report.alignment.mode', { mode: t(`report.alignment.mode.${meta.mode}`) }), {
    color: PALETTE.muted,
  });
  flow.paragraph(t('report.alignment.legend'), { color: PALETTE.muted, size: 8.5 });

  const total = alignment.alignedA.length;
  const shown = Math.min(total, MAX_ALIGNMENT_COLUMNS);
  if (shown < total)
    flow.paragraph(
      t('report.alignment.truncated', { shown: flow.format(shown), total: flow.format(total) }),
      {
        color: PALETTE.muted,
        size: 8.5,
      },
    );

  const charWidth = 4.8;
  const gutter = 52;
  const blockHeight = 36;
  let a = alignment.startA;
  let b = alignment.startB;
  for (let start = 0; start < shown; start += BLOCK_COLUMNS) {
    flow.ensure(blockHeight);
    const rowA = alignment.alignedA.slice(start, start + BLOCK_COLUMNS);
    const rowB = alignment.alignedB.slice(start, start + BLOCK_COLUMNS);
    const y = flow.y;
    const x = MARGIN + gutter;
    let marks = '';
    for (let i = 0; i < rowA.length; i++) {
      const cls = alignment.classes[start + i] as number;
      marks += MARKS[cls as keyof typeof MARKS] ?? ' ';
      const shade = SHADES[cls];
      if (shade) flow.page.rect(x + i * charWidth, y - 7, charWidth, 24, { fill: shade });
    }
    const usedA = rowA.replaceAll('-', '').length;
    const usedB = rowB.replaceAll('-', '').length;
    flow.page.text(MARGIN, y, `A ${String(a + 1).padStart(8)}`, { font: 'mono', size: 8, color: PALETTE.a });
    flow.page.text(x, y, rowA, { font: 'mono', size: 8 });
    flow.page.text(x, y + 8.5, marks, { font: 'mono', size: 8, color: PALETTE.muted });
    flow.page.text(MARGIN, y + 17, `B ${String(b + 1).padStart(8)}`, {
      font: 'mono',
      size: 8,
      color: PALETTE.b,
    });
    flow.page.text(x, y + 17, rowB, { font: 'mono', size: 8 });
    flow.page.text(x + BLOCK_COLUMNS * charWidth + 6, y, String(a + usedA), {
      font: 'mono',
      size: 8,
      color: PALETTE.muted,
    });
    flow.page.text(x + BLOCK_COLUMNS * charWidth + 6, y + 17, String(b + usedB), {
      font: 'mono',
      size: 8,
      color: PALETTE.muted,
    });
    a += usedA;
    b += usedB;
    flow.y += blockHeight;
  }
  flow.y += 10;
}

/** Position of a difference as the user reads it: 1-based, `12^13` for the site between two bases. */
function positions(difference: Difference): { a: string; b: string } {
  const range = (start: number, end: number) =>
    end - start === 1 ? String(start + 1) : `${start + 1}..${end}`;
  if (difference.kind === 'substitution')
    return {
      a: range(difference.refStart, difference.refEnd),
      b: range(difference.altStart, difference.altEnd),
    };
  if (difference.kind === 'insertion')
    return {
      a: `${difference.refStart}^${difference.refStart + 1}`,
      b: range(difference.altStart, difference.altEnd),
    };
  return {
    a: range(difference.refStart, difference.refEnd),
    b: `${difference.altStart}^${difference.altStart + 1}`,
  };
}

function differencesSection(flow: Flow, data: ComparisonData): void {
  const { t } = flow;
  const outcome = data.alignment;
  if (outcome.status !== 'ok') return;
  flow.section(t('report.section.differences'));
  const { counts, differences } = outcome;
  flow.paragraph(
    t('report.diff.summary', {
      substitutions: flow.format(counts.substitutions),
      insertions: flow.format(counts.insertions),
      deletions: flow.format(counts.deletions),
    }),
  );
  if (differences.length === 0) {
    flow.paragraph(t('report.diff.none'));
    return;
  }
  const listed = differences.slice(0, MAX_DIFFERENCE_ROWS);
  flow.table(
    [
      { header: t('report.diff.col.number'), width: 36, align: 'end', cell: (_, i) => String(i + 1) },
      { header: t('report.diff.col.kind'), width: 84, cell: (d) => t(`report.kind.${d.kind}`) },
      { header: t('report.diff.col.posA'), width: 84, cell: (d) => positions(d).a },
      { header: t('report.diff.col.posB'), width: 84, cell: (d) => positions(d).b },
      { header: t('report.diff.col.ref'), width: 90, font: 'mono', cell: (d) => d.ref || '-' },
      { header: t('report.diff.col.alt'), width: 90, font: 'mono', cell: (d) => d.alt || '-' },
      {
        header: t('report.diff.col.size'),
        width: CONTENT_WIDTH - 468,
        align: 'end',
        cell: (d) => String(Math.max(d.ref.length, d.alt.length)),
      },
    ],
    listed,
  );
  if (differences.length > listed.length)
    flow.paragraph(t('report.diff.truncated', { count: flow.format(differences.length - listed.length) }), {
      color: PALETTE.muted,
    });
}

function statusOf(row: RestrictionRow, t: ReportText): string {
  if (row.cutsA.length === 0) return t('report.restriction.onlyB');
  if (row.cutsB.length === 0) return t('report.restriction.onlyA');
  const same = row.cutsA.length === row.cutsB.length;
  return same ? t('report.restriction.same') : t('report.restriction.differs');
}

/** Draws one cut map: a line for the sequence and a labelled tick for each cut of an enzyme with few cuts. */
function drawCutTrack(
  flow: Flow,
  summary: SequenceSummary,
  cuts: (row: RestrictionRow) => readonly number[],
  rows: readonly RestrictionRow[],
  scaleLength: number,
  color: Rgb,
): void {
  const { page, t } = flow;
  const top = flow.y;
  const x0 = MARGIN + 6;
  const width = CONTENT_WIDTH - 12;
  const baseline = top + 78;
  page.text(
    MARGIN,
    top + 8,
    t('report.restriction.track', { name: summary.name, length: lengthText(flow, summary) }),
    {
      font: 'bold',
      size: 9,
    },
  );
  page.line(x0, baseline, x0 + (width * summary.length) / scaleLength, baseline, { color, width: 3 });
  const labels: { x: number; name: string }[] = [];
  for (const row of rows) {
    const positionsOf = cuts(row);
    if (positionsOf.length === 0 || positionsOf.length > MAX_MAP_CUTS) continue;
    for (const position of positionsOf) {
      const x = x0 + (width * position) / scaleLength;
      page.line(x, baseline - 4, x, baseline + 4, { color: PALETTE.ink, width: 0.8 });
      labels.push({ x, name: row.enzyme });
    }
  }
  const lanes: number[] = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const label of labels.sort((p, q) => p.x - q.x)) {
    const w = textWidth(label.name, 'regular', 6.5) + 3;
    const lane = lanes.findIndex((end) => end + 2 <= label.x - w / 2);
    if (lane < 0) continue;
    lanes[lane] = label.x + w / 2;
    const y = baseline - 12 - lane * 11;
    page.line(label.x, baseline - 4, label.x, y + 2, { color: PALETTE.rule, width: 0.4 });
    page.text(label.x, y, label.name, { size: 6.5, color: PALETTE.ink, align: 'middle' });
  }
  page.text(x0, baseline + 14, '1', { size: 6.5, color: PALETTE.muted });
  page.text(x0 + (width * summary.length) / scaleLength, baseline + 14, flow.format(summary.length), {
    size: 6.5,
    color: PALETTE.muted,
    align: 'end',
  });
  flow.y += 104;
}

function restrictionSection(flow: Flow, data: ComparisonData): void {
  const { t } = flow;
  flow.section(t('report.section.restriction'));
  const rows = data.restriction;
  if (rows === null) {
    flow.paragraph(t('report.restriction.notNucleotide'));
    return;
  }
  if (rows.length === 0) {
    flow.paragraph(t('report.restriction.none'));
    return;
  }
  flow.paragraph(t('report.restriction.intro', { count: rows.length, max: MAX_MAP_CUTS }), {
    color: PALETTE.muted,
  });
  const scale = Math.max(data.a.length, data.b.length, 1);
  flow.ensure(220);
  drawCutTrack(flow, data.a, (row) => row.cutsA, rows, scale, PALETTE.a);
  drawCutTrack(flow, data.b, (row) => row.cutsB, rows, scale, PALETTE.b);
  const list = (cuts: readonly number[]) => (cuts.length === 0 ? '-' : cuts.join(', '));
  flow.table(
    [
      { header: t('report.restriction.col.enzyme'), width: 62, cell: (r) => r.enzyme },
      { header: t('report.restriction.col.site'), width: 66, font: 'mono', cell: (r) => r.site },
      {
        header: t('report.restriction.col.cutsA'),
        width: 54,
        align: 'end',
        cell: (r) => String(r.cutsA.length),
      },
      {
        header: t('report.restriction.col.cutsB'),
        width: 54,
        align: 'end',
        cell: (r) => String(r.cutsB.length),
      },
      {
        header: t('report.restriction.col.positions'),
        width: CONTENT_WIDTH - 62 - 66 - 108 - 70,
        cell: (r) => `${list(r.cutsA)} | ${list(r.cutsB)}`,
      },
      { header: t('report.restriction.col.status'), width: 70, cell: (r) => statusOf(r, t) },
    ],
    rows,
  );
}

function gcSection(flow: Flow, data: ComparisonData): void {
  const { t } = flow;
  flow.section(t('report.section.gc'));
  if (data.gc === null) {
    flow.paragraph(t('report.gc.notNucleotide'));
    return;
  }
  flow.paragraph(
    t('report.gc.intro', { a: flow.format(data.gc.a.window), b: flow.format(data.gc.b.window) }),
    {
      color: PALETTE.muted,
    },
  );
  flow.ensure(210);
  drawLineChart(
    flow.page,
    { x: MARGIN, y: flow.y, width: CONTENT_WIDTH, height: 190 },
    {
      title: t('report.gc.title'),
      xLabel: t('report.gc.axisX'),
      yLabel: t('report.gc.axisY'),
      xDomain: [0, Math.max(data.a.length, data.b.length, 1)],
      formatY: (value) => `${Math.round(value * 100)}`,
      series: [
        { name: data.a.name, color: PALETTE.a, x: data.gc.a.x, y: data.gc.a.y },
        { name: data.b.name, color: PALETTE.b, x: data.gc.b.x, y: data.gc.b.y },
      ],
    },
  );
  flow.y += 206;
  flow.ensure(210);
  const letters = ['A', 'C', 'G', data.a.alphabet === 'rna' ? 'U' : 'T', '*'];
  const share = (summary: SequenceSummary, letter: string) =>
    (summary.composition.find((entry) => entry.letter === letter)?.fraction ?? 0) * 100;
  drawBarChart(
    flow.page,
    { x: MARGIN, y: flow.y, width: CONTENT_WIDTH, height: 190 },
    {
      title: t('report.composition.title'),
      yLabel: t('report.composition.axisY'),
      formatY: (value) => String(Math.round(value)),
      series: [
        { name: data.a.name, color: PALETTE.a },
        { name: data.b.name, color: PALETTE.b },
      ],
      groups: letters.map((letter) => ({
        label: letter === '*' ? t('report.composition.other') : letter,
        values: [share(data.a, letter), share(data.b, letter)],
      })),
    },
  );
  flow.y += 206;
}

function statisticsSection(flow: Flow, data: ComparisonData): void {
  const { t, format } = flow;
  flow.section(t('report.section.statistics'));
  const outcome = data.alignment;
  const rows: [string, string][] = [];
  if (outcome.status === 'ok') {
    const { stats, score } = outcome.alignment;
    const { counts } = outcome;
    const nucleotide = data.a.alphabet !== 'protein';
    rows.push(
      [t('report.stat.identity'), `${format(stats.percentIdentity, 2)}%`],
      [t('report.stat.similarity'), `${format(stats.percentSimilarity, 2)}%`],
      [t('report.stat.length'), format(stats.length)],
      [t('report.stat.identical'), format(stats.identical)],
      [t('report.stat.similar'), format(stats.similar)],
      [t('report.stat.mismatched'), format(stats.mismatches)],
      [t('report.stat.gapColumns'), format(stats.gapColumns)],
      [t('report.stat.gapRuns'), format(stats.gapRuns)],
      [t('report.stat.score'), format(score, 1)],
      [t('report.stat.substitutions'), format(counts.substitutions)],
      [t('report.stat.insertions'), format(counts.insertions)],
      [t('report.stat.deletions'), format(counts.deletions)],
      [t('report.stat.insertedResidues'), format(counts.insertedResidues)],
      [t('report.stat.deletedResidues'), format(counts.deletedResidues)],
    );
    if (nucleotide)
      rows.push(
        [t('report.stat.transitions'), format(counts.transitions)],
        [t('report.stat.transversions'), format(counts.transversions)],
        [
          t('report.stat.tstv'),
          counts.transversions === 0 ? '-' : format(counts.transitions / counts.transversions, 2),
        ],
      );
  } else rows.push([t('report.stat.identity'), t('report.stat.notAvailable')]);
  rows.push([t('report.stat.lengthDifference'), format(data.b.length - data.a.length)]);
  if (data.a.gc !== null && data.b.gc !== null)
    rows.push([t('report.stat.gcDifference'), format((data.b.gc - data.a.gc) * 100, 2)]);
  flow.table(
    [
      { header: t('report.stat.metric'), width: CONTENT_WIDTH - 130, cell: (r) => r[0] },
      { header: t('report.stat.value'), width: 130, align: 'end', cell: (r) => r[1] },
    ],
    rows,
    17,
  );
}

/**
 * The comparison report as PDF bytes: a title page with the project name, the date and the GENE_OS mark, the two
 * sequences, the alignment with its identity and similarity, the differences, the compared restriction map, the
 * compared GC charts and a statistical summary. Everything is vector text and drawing, so no server and no image
 * step is involved.
 */
export function buildReportPdf(data: ComparisonData, meta: ReportMeta, t: ReportText): Uint8Array {
  const projectName = meta.projectName.trim() || t('report.untitled');
  const doc = new PdfDocument({
    title: `${t('report.title')}: ${projectName}`,
    author: 'GENE_OS',
    subject: t('report.subtitle', { a: data.a.name, b: data.b.name }),
    created: new Date(meta.generated),
  });
  const format = (value: number, decimals = 0) => {
    const text = value.toLocaleString(meta.locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return /^-0(?:[.,]0+)?$/.test(text) ? text.slice(1) : text;
  };
  const flow = new Flow(doc, t, format);
  titlePage(flow, data, meta);
  flow.newPage();
  summarySection(flow, data);
  alignmentSection(flow, data, meta);
  differencesSection(flow, data);
  restrictionSection(flow, data);
  gcSection(flow, data);
  statisticsSection(flow, data);
  pageNumbers(doc, t, projectName);
  return doc.toBytes();
}
