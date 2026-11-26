import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { complement, reverseComplement } from '../../engine/alphabet';
import { type GeneticCode, getGeneticCode } from '../../engine/translate';
import type { Alphabet, Strand } from '../../engine/types';
import type { Overlay, ViewState } from '../../state/view';
import { t } from '../i18n';
import { OVERLAY_COLORS } from './colors';
import {
  blockify,
  columnOfOffset,
  gutterDigits,
  positionAtPoint,
  type RowLayout,
  rowColumns,
  rowCount,
  rowOfPosition,
} from './layout';
import { createOverlayIndex } from './overlayIndex';
import { translationRow } from './translationRow';
import { useVirtualScroll } from './virtual';
import './viz.css';

/** Height of one text line in px. The stylesheet uses the same value through `--seq-line`. */
export const SEQ_LINE_HEIGHT = 20;
const ROW_GAP = 12;
const PROBE_CHARS = 20;
const DEFAULT_CHAR_WIDTH = 8;

export interface SequenceRendererProps {
  readonly seq: string;
  /** `protein` shows one strand and no translation. Default `dna`. */
  readonly alphabet?: Alphabet;
  /** Selection, caret, line length, frames and overlay switches. Shared with the other views of the document. */
  readonly view: ViewState;
  /** Colored ranges to paint, any kinds. `view.overlays` switches each kind on or off. */
  readonly overlays?: readonly Overlay[];
  /** Bases per block with a space between blocks; 0 for continuous text. Default 0. */
  readonly blockSize?: number;
  /** Code used for the translation rows. Default: the standard code. */
  readonly geneticCode?: GeneticCode;
  /** Accessible name. Default: "Sequence". */
  readonly label?: string;
  /** Character width in px to use where the browser reports no layout. Default 8. */
  readonly fallbackCharWidth?: number;
}

const STANDARD_CODE = getGeneticCode(1);

interface Box {
  readonly key: string;
  readonly className: string;
  readonly column: number;
  readonly columns: number;
  readonly color?: string;
  readonly title?: string;
}

function columnSpan(start: number, end: number, rowStart: number, rowEnd: number, blockSize: number) {
  const from = Math.max(start, rowStart);
  const to = Math.min(end, rowEnd);
  if (to <= from) return null;
  const column = columnOfOffset(from - rowStart, blockSize);
  return { column, columns: columnOfOffset(to - 1 - rowStart, blockSize) + 1 - column };
}

/**
 * A sequence of any length drawn in rows of `view.lineLength` bases, monospace, with a position gutter, the
 * complementary strand, translation rows for `view.frames`, colored overlays, a selection and a caret. Only the rows
 * on screen exist in the page, so a 5 Mb sequence costs the same as a short one. Click and drag select (a drag that
 * starts on the lower strand selects on the reverse strand), Shift-click and Shift-arrows extend, arrow keys, Home,
 * End and Page keys move the caret, Ctrl+A selects all, Ctrl+C copies the selection, and `view.reveal(position)`
 * scrolls a position into view.
 */
export function SequenceRenderer(props: SequenceRendererProps) {
  const { seq, view, blockSize = 0, geneticCode = STANDARD_CODE } = props;
  const alphabet = props.alphabet ?? 'dna';
  const nucleotide = alphabet !== 'protein';
  const lineLength = Math.max(1, view.lineLength.value);
  const frames = nucleotide ? view.frames.value : [];
  const selection = view.selection.value;
  const caret = view.caret.value;
  const enabled = view.overlays.value;
  const reveal = view.revealRequest.value;

  const layout: RowLayout = { length: seq.length, lineLength, blockSize };
  const rows = rowCount(layout);
  const lines = 1 + (nucleotide ? 1 : 0) + frames.length;
  const rowHeight = lines * SEQ_LINE_HEIGHT + ROW_GAP;
  const sequenceHeight = (nucleotide ? 2 : 1) * SEQ_LINE_HEIGHT;
  const columns = rowColumns(lineLength, blockSize);
  const gutterCh = gutterDigits(layout) + 2;

  const scroll = useVirtualScroll({ count: rows, itemHeight: rowHeight });
  const { range } = scroll;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const charWidth = measuredWidth || props.fallbackCharWidth || DEFAULT_CHAR_WIDTH;
  const drag = useRef<{ strand: Strand } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const measure = () => setMeasuredWidth(probe.getBoundingClientRect().width / PROBE_CHARS);
    measure();
    void document.fonts?.ready.then(measure);
  }, []);

  const visibleOverlays = useMemo(
    () => (props.overlays ?? []).filter((overlay) => enabled[overlay.kind]),
    [props.overlays, enabled],
  );
  const index = useMemo(() => createOverlayIndex(visibleOverlays), [visibleOverlays]);

  const visibleFirst = Math.floor(range.offset / rowHeight);
  const visibleLast = Math.min(rows, Math.ceil((range.offset + scroll.viewportHeight) / rowHeight));

  useEffect(() => {
    const next = { start: visibleFirst * lineLength, end: Math.min(seq.length, visibleLast * lineLength) };
    const current = view.window.peek();
    if (current.start !== next.start || current.end !== next.end) view.window.value = next;
  }, [view, visibleFirst, visibleLast, lineLength, seq.length]);

  useEffect(() => {
    if (reveal) scroll.scrollToItem(rowOfPosition(reveal.position, layout), 'center');
    // Only a new request scrolls; later renders must leave the user's scroll alone.
  }, [reveal?.nonce]);

  useEffect(() => {
    const length = seq.length;
    const text = selection
      ? t(selection.strand === -1 ? 'seq.selectionReverse' : 'seq.selection', {
          start: (selection.start + 1).toLocaleString(),
          end: selection.end.toLocaleString(),
          length: (selection.end - selection.start).toLocaleString(),
        })
      : t('seq.position', { position: Math.min(caret + 1, length).toLocaleString() });
    setAnnouncement(text);
  }, [selection, caret, seq.length]);

  const locate = (event: PointerEvent) => {
    const rect = layerRef.current?.getBoundingClientRect();
    const x = event.clientX - (rect?.left ?? 0);
    const y = event.clientY - (rect?.top ?? 0) + range.offset;
    const row = Math.min(Math.max(Math.floor(y / rowHeight), 0), rows - 1);
    const line = Math.floor((y - row * rowHeight) / SEQ_LINE_HEIGHT);
    return {
      position: positionAtPoint(row, x / charWidth - gutterCh, layout),
      strand: (nucleotide && line === 1 ? -1 : 1) as Strand,
    };
  };

  const move = (position: number, extend: boolean, strand?: Strand) => {
    view.moveCaret(position, { extend, ...(strand ? { strand } : {}) });
    scroll.scrollToItem(rowOfPosition(view.caret.peek(), layout), 'nearest');
  };

  const onPointerDown = (event: PointerEvent) => {
    const viewport = scroll.ref.current;
    if (event.button !== 0 || !viewport) return;
    if (event.target === viewport && viewport.clientWidth > 0 && event.offsetX >= viewport.clientWidth)
      return;
    viewport.focus();
    const { position, strand } = locate(event);
    drag.current = { strand };
    move(position, event.shiftKey, strand);
    viewport.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag.current) return;
    const viewport = scroll.ref.current;
    const rect = viewport?.getBoundingClientRect();
    if (viewport && rect && rect.height > 0) {
      if (event.clientY < rect.top) viewport.scrollTop -= rowHeight / 2;
      else if (event.clientY > rect.bottom) viewport.scrollTop += rowHeight / 2;
    }
    view.moveCaret(locate(event).position, { extend: true, strand: drag.current.strand });
  };

  const onPointerUp = (event: PointerEvent) => {
    drag.current = null;
    scroll.ref.current?.releasePointerCapture?.(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const modifier = event.ctrlKey || event.metaKey;
    const caret = view.caret.peek();
    const page = Math.max(1, Math.floor(scroll.viewportHeight / rowHeight) - 1) * lineLength;
    const rowStart = caret - (caret % lineLength);
    const targets: Record<string, number> = {
      ArrowLeft: caret - 1,
      ArrowRight: caret + 1,
      ArrowUp: caret - lineLength,
      ArrowDown: caret + lineLength,
      PageUp: caret - page,
      PageDown: caret + page,
      Home: modifier ? 0 : rowStart,
      End: modifier ? seq.length : Math.min(seq.length, rowStart + lineLength),
    };
    if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      view.selectAll();
    } else if (event.key === 'Escape') {
      view.clearSelection();
    } else if (event.key in targets) {
      event.preventDefault();
      move(targets[event.key] as number, event.shiftKey);
    }
  };

  const onCopy = (event: ClipboardEvent) => {
    const selection = view.selection.peek();
    if (!selection || !event.clipboardData) return;
    const text = seq.slice(selection.start, selection.end);
    event.clipboardData.setData(
      'text/plain',
      selection.strand === -1 ? reverseComplement(text, alphabet === 'rna' ? 'rna' : 'dna') : text,
    );
    event.preventDefault();
  };

  const rowNodes = [];
  for (let row = range.first; row < range.last; row++) {
    const rowStart = row * lineLength;
    const rowEnd = Math.min(seq.length, rowStart + lineLength);
    const slice = seq.slice(rowStart, rowEnd);
    const boxes: Box[] = [];

    for (const overlay of index.query(rowStart, rowEnd)) {
      const span = columnSpan(overlay.start, overlay.end, rowStart, rowEnd, blockSize);
      if (span)
        boxes.push({
          key: overlay.id,
          className: `seq-overlay ${overlay.kind}`,
          ...span,
          color: overlay.color ?? OVERLAY_COLORS[overlay.kind],
          ...(overlay.label ? { title: overlay.label } : {}),
        });
    }
    const selected = selection && columnSpan(selection.start, selection.end, rowStart, rowEnd, blockSize);
    if (selection && selected)
      boxes.push({
        key: 'selection',
        className: `seq-selection strand${selection.strand === -1 ? '-reverse' : ''}`,
        ...selected,
      });

    const translations = frames.map((frame) =>
      translationRow(seq, rowStart, rowEnd, frame, geneticCode, blockSize, alphabet),
    );
    const caretHere = caret >= rowStart && (caret < rowEnd || (caret === rowEnd && rowEnd === seq.length));

    rowNodes.push(
      <div
        key={row}
        class="seq-row"
        style={{ top: `${row * rowHeight - range.offset}px`, height: `${rowHeight}px` }}
      >
        <span class="seq-num" style={{ width: `${gutterCh - 2}ch` }}>
          {rowStart + 1}
        </span>
        {frames.map((frame, i) => (
          <span
            key={frame}
            class="seq-frame-label"
            style={{ top: `${(2 + i) * SEQ_LINE_HEIGHT}px`, width: `${gutterCh - 2}ch` }}
          >
            {frame > 0 ? `+${frame}` : frame}
          </span>
        ))}
        <div
          class="seq-lines"
          style={{ left: `${gutterCh}ch`, width: `${columns}ch`, height: `${lines * SEQ_LINE_HEIGHT}px` }}
        >
          {boxes.map((box) => (
            <div
              key={box.key}
              class={box.className}
              title={box.title}
              style={{
                left: `${box.column}ch`,
                width: `${box.columns}ch`,
                height: `${sequenceHeight}px`,
                '--seq-color': box.color,
              }}
            />
          ))}
          {translations.map((translation, i) =>
            translation.marks.map((mark) => (
              <div
                key={`${frames[i]}:${mark.column}`}
                class={`seq-mark ${mark.kind}`}
                style={{ left: `${mark.column}ch`, top: `${(2 + i) * SEQ_LINE_HEIGHT}px` }}
              />
            )),
          )}
          {caretHere && (
            <div
              class="seq-caret"
              style={{
                left: `${columnOfOffset(caret - rowStart, blockSize)}ch`,
                height: `${sequenceHeight}px`,
              }}
            />
          )}
          <div class="seq-line">{blockify(slice, blockSize)}</div>
          {nucleotide && (
            <div class="seq-line comp">
              {blockify(complement(slice, alphabet === 'rna' ? 'rna' : 'dna'), blockSize)}
            </div>
          )}
          {translations.map((translation, i) => (
            <div key={frames[i]} class="seq-line aa">
              {translation.text}
            </div>
          ))}
        </div>
      </div>,
    );
  }

  return (
    <div class="seq-renderer">
      {/* biome-ignore lint/a11y/useSemanticElements: a virtualized read-only sequence cannot be an input or a textarea */}
      <div
        class="seq-viewport"
        ref={scroll.ref}
        role="textbox"
        aria-multiline="true"
        aria-readonly="true"
        aria-label={props.label ?? t('seq.label')}
        tabIndex={0}
        onScroll={scroll.onScroll}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onCopy={onCopy}
      >
        <div
          class="seq-scroll"
          style={{
            height: `${range.scrollHeight}px`,
            minWidth: `calc(${gutterCh + columns}ch + 24px)`,
            '--seq-line': `${SEQ_LINE_HEIGHT}px`,
          }}
        >
          <div
            class="seq-layer"
            ref={layerRef}
            aria-hidden="true"
            style={{ height: `${Math.min(scroll.viewportHeight, range.scrollHeight)}px` }}
          >
            {seq.length === 0 ? <div class="seq-empty">{t('seq.empty')}</div> : rowNodes}
            <span class="seq-probe" ref={probeRef}>
              {'M'.repeat(PROBE_CHARS)}
            </span>
          </div>
        </div>
      </div>
      <span class="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
