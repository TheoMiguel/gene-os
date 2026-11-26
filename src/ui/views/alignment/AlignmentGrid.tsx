import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ImageExportButtons } from '../../export';
import { t } from '../../i18n';
import { scrollTopFor, type VirtualInput, virtualRange } from '../../viz/virtual';
import { buildAlignmentSvg, MAX_IMAGE_COLUMNS } from './alignmentSvg';
import { type AlignmentDisplay, classRuns, matchLine, residueNumber, rulerTicks } from './model';

const ROW_H = 20;
const RULER_H = 24;
const BARS_H = 30;
const FALLBACK_CHAR_W = 8.4;
const FALLBACK_VIEW_W = 640;
const OVERSCAN = 6;

export interface GridReveal {
  readonly column: number;
  readonly span: number;
  readonly nonce: number;
}

interface Line {
  readonly kind: 'sequence' | 'match' | 'consensus';
  readonly label: string;
  readonly row: number;
}

function linesOf(display: AlignmentDisplay): Line[] {
  if (display.kind === 'pair') {
    return [
      { kind: 'sequence', label: display.labels[0] ?? '', row: 0 },
      { kind: 'match', label: '', row: -1 },
      { kind: 'sequence', label: display.labels[1] ?? '', row: 1 },
    ];
  }
  const lines: Line[] = display.rows.map((_, row) => ({
    kind: 'sequence',
    label: display.labels[row] ?? '',
    row,
  }));
  lines.push({ kind: 'consensus', label: t('align.consensus'), row: -1 });
  return lines;
}

/**
 * The alignment display. Only the columns on screen are drawn, so an alignment of a million columns scrolls as
 * smoothly as a short one. Row labels and the ruler stay in view. `reveal` scrolls a column to the centre and marks it.
 */
export function AlignmentGrid(props: {
  readonly display: AlignmentDisplay;
  readonly reveal: GridReveal | null;
  readonly imageName: string;
}) {
  const { display, reveal } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [charWidth, setCharWidth] = useState(FALLBACK_CHAR_W);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewWidth, setViewWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const probe = probeRef.current;
    if (!scroller) return;
    const measure = () => {
      setViewWidth(scroller.clientWidth);
      const width = probe?.getBoundingClientRect().width ?? 0;
      if (width > 0) setCharWidth(width / 10);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const lines = useMemo(() => linesOf(display), [display]);
  const hasBars = display.conservation !== undefined;
  const bodyHeight = RULER_H + lines.length * ROW_H + (hasBars ? BARS_H + 4 : 0);
  const input: VirtualInput = {
    count: display.length,
    itemHeight: charWidth,
    viewportHeight: viewWidth || FALLBACK_VIEW_W,
    scrollTop: scrollLeft,
    overscan: OVERSCAN,
  };
  const range = virtualRange(input);
  const { first, last, offset } = range;
  const xOf = (column: number) => column * charWidth - offset;

  const scrollTo = (column: number, align: 'start' | 'center') => {
    const clamped = Math.min(Math.max(column, 0), Math.max(0, display.length - 1));
    const target = scrollTopFor(clamped, align, input);
    if (scrollRef.current) scrollRef.current.scrollLeft = target;
    setScrollLeft(target);
  };

  useEffect(() => {
    if (!reveal) return;
    scrollTo(reveal.column, 'center');
    setPicked(reveal.column);
  }, [reveal?.nonce]);

  const visibleFirst = Math.round(offset / charWidth);
  const pageColumns = Math.max(1, Math.floor((viewWidth || FALLBACK_VIEW_W) / charWidth) - 2);
  const goTo = (text: string) => {
    const column = Number.parseInt(text, 10);
    if (!Number.isFinite(column)) return;
    scrollTo(column - 1, 'center');
    setPicked(Math.min(Math.max(column - 1, 0), display.length - 1));
  };

  const spans = (text: string) =>
    classRuns(display.classes, first, last).map((run) => (
      <span key={run.from} class={`aln-c${run.cls}`}>
        {text.slice(run.from - first, run.to - first)}
      </span>
    ));

  const rowContent = (line: Line) => {
    if (line.kind === 'match') return matchLine(display.classes, first, last);
    if (line.kind === 'consensus') return (display.consensus ?? '').slice(first, last);
    return spans((display.rows[line.row] as string).slice(first, last));
  };

  const onPick = (event: MouseEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const column = Math.floor((event.clientX - box.left + offset) / charWidth);
    setPicked(column >= 0 && column < display.length ? column : null);
  };

  const exportRange = (): [number, number] =>
    display.length <= MAX_IMAGE_COLUMNS
      ? [0, display.length]
      : [visibleFirst, Math.min(display.length, visibleFirst + MAX_IMAGE_COLUMNS)];
  const imageIsPartial = display.length > MAX_IMAGE_COLUMNS;

  const conservation = display.conservation;
  const barTop = RULER_H + lines.length * ROW_H + 4;

  return (
    <div class="aln-grid">
      <div class="aln-toolbar">
        <ul class="aln-legend" aria-label={t('align.legend')}>
          {(['identical', 'similar', 'mismatch', 'gap'] as const).map((name, cls) => (
            <li key={name}>
              <span class={`aln-swatch aln-c${cls}`} aria-hidden="true" />
              {t(`align.class.${name}`)}
            </li>
          ))}
        </ul>
        <span class="aln-paging">
          <button
            type="button"
            class="export-button"
            disabled={visibleFirst <= 0}
            onClick={() => scrollTo(visibleFirst - pageColumns, 'start')}
          >
            {t('align.page.prev')}
          </button>
          <button
            type="button"
            class="export-button"
            disabled={visibleFirst + pageColumns >= display.length}
            onClick={() => scrollTo(visibleFirst + pageColumns, 'start')}
          >
            {t('align.page.next')}
          </button>
          <label class="aln-goto">
            <span class="field-label">{t('align.page.goTo')}</span>
            <input
              type="number"
              min={1}
              max={display.length}
              placeholder={String(visibleFirst + 1)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                goTo((event.currentTarget as HTMLInputElement).value);
              }}
            />
          </label>
        </span>
        <span class="aln-image">
          <ImageExportButtons
            name={props.imageName}
            getSvg={() => {
              const [from, to] = exportRange();
              return buildAlignmentSvg(display, from, to);
            }}
          />
          {imageIsPartial && (
            <span class="aln-hint">
              {t('align.imagePartial', { from: visibleFirst + 1, to: exportRange()[1] })}
            </span>
          )}
        </span>
      </div>
      <div class="aln-frame">
        <div class="aln-labels" style={{ paddingTop: `${RULER_H}px` }}>
          {lines.map((line) => (
            <div
              key={line.label + line.row + line.kind}
              class="aln-label"
              style={{ height: `${ROW_H}px` }}
              title={line.label}
            >
              {line.label}
            </div>
          ))}
          {hasBars && (
            <div class="aln-label" style={{ height: `${BARS_H + 4}px` }}>
              {t('align.conservation')}
            </div>
          )}
        </div>
        <section
          class="aln-scroll"
          ref={scrollRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus so the arrow keys scroll it
          tabIndex={0}
          aria-label={t('align.gridLabel', {
            rows: display.rows.length,
            columns: display.length.toLocaleString(),
          })}
          onScroll={() => scrollRef.current && setScrollLeft(scrollRef.current.scrollLeft)}
        >
          <span ref={probeRef} class="aln-probe" aria-hidden="true">
            MMMMMMMMMM
          </span>
          <div class="aln-body" style={{ width: `${range.scrollHeight}px`, height: `${bodyHeight}px` }}>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the grid scrolls with the keyboard; a click only reads one column */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: same click, same reason */}
            <div
              class="aln-layer"
              style={{ width: `${viewWidth || FALLBACK_VIEW_W}px`, height: `${bodyHeight}px` }}
              onClick={onPick}
            >
              {rulerTicks(first, last).map((column) => (
                <span
                  key={column}
                  class="aln-tick"
                  style={{ left: `${xOf(column)}px`, width: `${charWidth}px` }}
                >
                  {column + 1}
                </span>
              ))}
              {lines.map((line, i) => (
                <div
                  key={line.label + line.row + line.kind}
                  class={`aln-row aln-row-${line.kind}`}
                  style={{ top: `${RULER_H + i * ROW_H}px`, height: `${ROW_H}px`, left: `${xOf(first)}px` }}
                >
                  {rowContent(line)}
                </div>
              ))}
              {conservation && (
                <svg
                  class="aln-bars"
                  aria-hidden="true"
                  style={{ top: `${barTop}px`, left: `${xOf(first)}px` }}
                  width={(last - first) * charWidth}
                  height={BARS_H}
                >
                  {Array.from({ length: last - first }, (_, k) => {
                    const h = (conservation[first + k] as number) * BARS_H;
                    return (
                      <rect
                        key={first + k}
                        x={k * charWidth + 1}
                        y={BARS_H - h}
                        width={Math.max(1, charWidth - 2)}
                        height={h}
                      />
                    );
                  })}
                </svg>
              )}
              {picked !== null && picked >= first && picked < last && (
                <div
                  class="aln-focus"
                  style={{
                    left: `${xOf(picked)}px`,
                    width: `${Math.max(1, reveal && reveal.column === picked ? reveal.span : 1) * charWidth}px`,
                    top: `${RULER_H}px`,
                    height: `${lines.length * ROW_H}px`,
                  }}
                />
              )}
            </div>
          </div>
        </section>
      </div>
      <p class="aln-picked" role="status" aria-live="polite">
        {picked === null
          ? t('align.pickHint')
          : t('align.column', { column: (picked + 1).toLocaleString() }) +
            display.rows
              .map((row, i) => {
                const number = residueNumber(row, picked, display.starts[i]);
                return ` · ${display.labels[i]}: ${row[picked]}${number === null ? '' : ` (${number.toLocaleString()})`}`;
              })
              .join('')}
      </p>
    </div>
  );
}
