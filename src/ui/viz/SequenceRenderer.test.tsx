// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { randomDna } from '../../../tests/fixtures/restriction/fixtures';
import { getGeneticCode, sixFrameTranslation, translateFrame } from '../../engine/translate';
import { updateSettings } from '../../state/settings';
import { createViewState, type Overlay } from '../../state/view';
import { columnOfOffset, gutterDigits } from './layout';
import { SequenceRenderer } from './SequenceRenderer';
import { translationRow } from './translationRow';

// jsdom has no layout: the renderer falls back to 8 px characters, 400 px of height and 2 text lines + 12 px per row.
const CHAR = 8;
const ROW_HEIGHT = 2 * 20 + 12;
const LINE = 20;

const setup = (
  seq: string,
  options: { lineLength?: number; overlays?: Overlay[]; blockSize?: number } = {},
) => {
  const view = createViewState(() => seq.length);
  view.lineLength.value = options.lineLength ?? 60;
  const gutterCh = gutterDigits({ length: seq.length, lineLength: 60, blockSize: 0 }) + 2;
  const result = render(
    <SequenceRenderer
      seq={seq}
      view={view}
      {...(options.overlays ? { overlays: options.overlays } : {})}
      {...(options.blockSize ? { blockSize: options.blockSize } : {})}
    />,
  );
  const viewport = screen.getByRole('textbox', { name: 'Sequence' });
  const at = (offsetInRow: number, row = 0, line = 0) => ({
    clientX: (gutterCh + columnOfOffset(offsetInRow, options.blockSize ?? 0)) * CHAR + 1,
    clientY: row * ROW_HEIGHT + line * LINE + 5,
  });
  const pointer = (type: string, point: { clientX: number; clientY: number }, extra: MouseEventInit = {}) =>
    fireEvent(viewport, new MouseEvent(type, { ...point, bubbles: true, button: 0, ...extra }));
  return { view, viewport, at, pointer, ...result };
};

const rowNumbers = (container: Element) =>
  [...container.querySelectorAll('.seq-row .seq-num')].map((n) => Number(n.textContent));
const status = (container: Element) => container.querySelector('[role="status"]')?.textContent;

beforeEach(() => updateSettings({ language: 'en' }));
afterEach(cleanup);

describe('SequenceRenderer virtualization', () => {
  it('draws the sequence in rows with 1-based numbers, both strands and nothing else', () => {
    const { container } = setup('ACGTACGTAC'.repeat(13), { lineLength: 60 });
    expect(rowNumbers(container)).toEqual([1, 61, 121]);
    const lines = container.querySelectorAll('.seq-row')[0]?.querySelectorAll('.seq-line');
    expect(lines?.[0]?.textContent).toBe('ACGTACGTAC'.repeat(6));
    expect(lines?.[1]?.textContent).toBe('TGCATGCATG'.repeat(6));
    expect(container.querySelectorAll('.seq-row')[2]?.querySelector('.seq-line')?.textContent).toBe(
      'ACGTACGTAC'.repeat(1) + 'ACGTACGTAC'.repeat(0),
    );
  });

  it('caps the scroll height for tens of megabases so every row stays reachable', () => {
    const { container } = setup('A'.repeat(40_000_000));
    expect(container.querySelector('.seq-scroll')?.getAttribute('style')).toContain('height: 8000000px');
    expect(rowNumbers(container).length).toBeLessThan(20);
  });

  it('draws only the rows on screen for a 5 Mb sequence', () => {
    const seq = randomDna(5_000_000, 9);
    const started = performance.now();
    const { container } = setup(seq);
    expect(performance.now() - started).toBeLessThan(3000);
    const numbers = rowNumbers(container);
    expect(numbers[0]).toBe(1);
    expect(numbers.length).toBeLessThan(20);
    expect(container.querySelectorAll('.seq-line').length).toBeLessThan(40);
  });

  it('lays blocks out with a space between them', () => {
    const { container } = setup('ACGTACGTACGTACG', { lineLength: 15, blockSize: 5 });
    expect(container.querySelector('.seq-line')?.textContent).toBe('ACGTA CGTAC GTACG');
  });

  it('says so for an empty sequence', () => {
    setup('');
    expect(screen.getByText('No sequence.')).toBeTruthy();
  });
});

describe('SequenceRenderer selection', () => {
  it('selects the dragged range', () => {
    const { view, pointer, at } = setup(randomDna(500, 1));
    pointer('pointerdown', at(10, 0));
    pointer('pointermove', at(25, 1));
    pointer('pointerup', at(25, 1));
    expect(view.selection.value).toEqual({ start: 10, end: 85, strand: 1 });
    expect(view.caret.value).toBe(85);
  });

  it('selects on the reverse strand when the drag starts on the complementary line', () => {
    const { view, pointer, at } = setup(randomDna(500, 1));
    pointer('pointerdown', at(5, 0, 1));
    pointer('pointermove', at(15, 0, 1));
    pointer('pointerup', at(15, 0, 1));
    expect(view.selection.value).toEqual({ start: 5, end: 15, strand: -1 });
  });

  it('puts the caret between bases on a click and clears the selection', () => {
    const { view, pointer, at } = setup(randomDna(500, 1));
    view.select(0, 100);
    pointer('pointerdown', at(7, 2));
    pointer('pointerup', at(7, 2));
    expect(view.selection.value).toBeNull();
    expect(view.caret.value).toBe(127);
  });

  it('extends the selection with Shift-click', () => {
    const { view, pointer, at } = setup(randomDna(500, 1));
    pointer('pointerdown', at(10, 0));
    pointer('pointerup', at(10, 0));
    pointer('pointerdown', at(20, 1), { shiftKey: true });
    pointer('pointerup', at(20, 1), { shiftKey: true });
    expect(view.selection.value).toMatchObject({ start: 10, end: 80 });
    pointer('pointerdown', at(5, 0), { shiftKey: true });
    expect(view.selection.value).toMatchObject({ start: 5, end: 10 });
  });

  it('clamps a click past the end of the last row to the sequence length', () => {
    const { view, pointer, at } = setup(randomDna(100, 1));
    pointer('pointerdown', at(50, 1));
    expect(view.caret.value).toBe(100);
  });

  it('paints the selection over its columns, split across rows', () => {
    const { view, container } = setup(randomDna(500, 1));
    act(() => view.select(50, 70));
    const boxes = [...container.querySelectorAll('.seq-selection')] as HTMLElement[];
    expect(boxes.map((b) => [b.style.left, b.style.width])).toEqual([
      ['50ch', '10ch'],
      ['0ch', '10ch'],
    ]);
  });

  it('announces the position and the selection', () => {
    const { view, container } = setup(randomDna(500, 1));
    expect(status(container)).toBe('Position 1');
    act(() => view.moveCaret(99));
    expect(status(container)).toBe('Position 100');
    act(() => view.select(9, 30, -1));
    expect(status(container)).toBe('Selection 10 to 30, 21 bp, reverse strand');
    act(() => view.select(9, 30));
    expect(status(container)).toBe('Selection 10 to 30, 21 bp');
  });
});

describe('SequenceRenderer caret and keyboard', () => {
  it('moves the caret with the arrow keys, by row with Up and Down, and clamps at both ends', () => {
    const { view, viewport } = setup(randomDna(500, 2));
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(view.caret.value).toBe(2);
    fireEvent.keyDown(viewport, { key: 'ArrowDown' });
    expect(view.caret.value).toBe(62);
    fireEvent.keyDown(viewport, { key: 'ArrowUp' });
    fireEvent.keyDown(viewport, { key: 'ArrowUp' });
    expect(view.caret.value).toBe(0);
    fireEvent.keyDown(viewport, { key: 'ArrowLeft' });
    expect(view.caret.value).toBe(0);
    fireEvent.keyDown(viewport, { key: 'End', ctrlKey: true });
    expect(view.caret.value).toBe(500);
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(view.caret.value).toBe(500);
  });

  it('goes to the start and end of the row with Home and End, and of the sequence with Ctrl', () => {
    const { view, viewport } = setup(randomDna(500, 2));
    view.moveCaret(130);
    fireEvent.keyDown(viewport, { key: 'Home' });
    expect(view.caret.value).toBe(120);
    fireEvent.keyDown(viewport, { key: 'End' });
    expect(view.caret.value).toBe(180);
    fireEvent.keyDown(viewport, { key: 'Home', ctrlKey: true });
    expect(view.caret.value).toBe(0);
  });

  it('extends the selection with Shift and arrow keys, selects all, and clears with Escape', () => {
    const { view, viewport } = setup(randomDna(500, 2));
    view.moveCaret(10);
    fireEvent.keyDown(viewport, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(viewport, { key: 'ArrowRight', shiftKey: true });
    expect(view.selection.value).toMatchObject({ start: 10, end: 12 });
    fireEvent.keyDown(viewport, { key: 'ArrowDown', shiftKey: true });
    expect(view.selection.value).toMatchObject({ start: 10, end: 72 });
    fireEvent.keyDown(viewport, { key: 'a', ctrlKey: true });
    expect(view.selection.value).toMatchObject({ start: 0, end: 500 });
    fireEvent.keyDown(viewport, { key: 'Escape' });
    expect(view.selection.value).toBeNull();
  });

  it('pages by the rows on screen', () => {
    const { view, viewport } = setup(randomDna(5000, 2));
    fireEvent.keyDown(viewport, { key: 'PageDown' });
    expect(view.caret.value).toBe(60 * 6);
    fireEvent.keyDown(viewport, { key: 'PageUp' });
    expect(view.caret.value).toBe(0);
  });

  it('keeps the caret row on screen when the caret moves far', () => {
    const { view, viewport, container } = setup(randomDna(50_000, 2));
    fireEvent.keyDown(viewport, { key: 'End', ctrlKey: true });
    expect(view.caret.value).toBe(50_000);
    expect(rowNumbers(container)).toContain(49_981);
    expect(container.querySelector('.seq-caret')).not.toBeNull();
  });

  it('is reachable with Tab and copies the selected bases, reverse-complemented on the reverse strand', () => {
    const seq = 'AAACCCGGGTTT'.repeat(10);
    const { view, viewport } = setup(seq);
    expect(viewport.tabIndex).toBe(0);
    const copy = (): string | undefined => {
      const store: Record<string, string> = {};
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.assign(event, {
        clipboardData: { setData: (type: string, value: string) => (store[type] = value) },
      });
      fireEvent(viewport, event);
      return store['text/plain'];
    };
    expect(copy()).toBeUndefined();
    view.select(3, 9);
    expect(copy()).toBe('CCCGGG');
    view.select(3, 9, -1);
    expect(copy()).toBe('CCCGGG');
    view.select(0, 6, -1);
    expect(copy()).toBe('GGGTTT');
  });
});

describe('SequenceRenderer scroll to position', () => {
  it('scrolls a far position into view and reports the visible window', () => {
    const { view, container } = setup(randomDna(1_000_000, 3));
    expect(rowNumbers(container)[0]).toBe(1);
    act(() => view.reveal(500_000));
    const numbers = rowNumbers(container);
    expect(numbers).toContain(Math.floor(500_000 / 60) * 60 + 1);
    expect(numbers).not.toContain(1);
    expect(view.window.value.start).toBeLessThanOrEqual(500_000);
    expect(view.window.value.end).toBeGreaterThan(500_000);
  });

  it('goes to a position with goTo: caret there, position visible', () => {
    const { view, container } = setup(randomDna(200_000, 3));
    act(() => view.goTo(150_000));
    expect(view.caret.value).toBe(150_000);
    expect(rowNumbers(container)).toContain(Math.floor(150_000 / 60) * 60 + 1);
    expect(container.querySelector('.seq-caret')).not.toBeNull();
  });

  it('reaches the very end of a sequence', () => {
    const { view, container } = setup(randomDna(3_000_001, 3));
    act(() => view.reveal(3_000_001));
    expect(rowNumbers(container).at(-1)).toBe(Math.floor(3_000_000 / 60) * 60 + 1);
  });

  it('follows a new line length', () => {
    const { view, container } = setup(randomDna(1000, 3));
    act(() => {
      view.lineLength.value = 100;
    });
    expect(rowNumbers(container).slice(0, 3)).toEqual([1, 101, 201]);
  });
});

describe('SequenceRenderer overlays and translation', () => {
  const overlays: Overlay[] = [
    { id: 'f1', kind: 'feature', start: 10, end: 25, label: 'lacZ' },
    { id: 's1', kind: 'search', start: 55, end: 70 },
    { id: 'r1', kind: 'restriction', start: 100, end: 106, label: 'EcoRI' },
  ];

  it('paints each overlay over its columns, split at the row end, with its label as a tooltip', () => {
    const { container } = setup(randomDna(300, 4), { overlays });
    const feature = container.querySelector('.seq-overlay.feature') as HTMLElement;
    expect([feature.style.left, feature.style.width, feature.title]).toEqual(['10ch', '15ch', 'lacZ']);
    const search = [...container.querySelectorAll('.seq-overlay.search')] as HTMLElement[];
    expect(search.map((b) => [b.style.left, b.style.width])).toEqual([
      ['55ch', '5ch'],
      ['0ch', '10ch'],
    ]);
    expect(container.querySelector('.seq-overlay.restriction')).not.toBeNull();
  });

  it('hides a kind the view switched off', () => {
    const { view, container } = setup(randomDna(300, 4), { overlays });
    act(() => {
      view.overlays.value = { ...view.overlays.value, feature: false };
    });
    expect(container.querySelector('.seq-overlay.feature')).toBeNull();
    expect(container.querySelector('.seq-overlay.search')).not.toBeNull();
  });

  it('adds one translation line per chosen frame, labelled', () => {
    const seq = 'ATGAAATAGCCCATGTGA'.repeat(10);
    const { view, container } = setup(seq);
    expect(container.querySelectorAll('.seq-line.aa')).toHaveLength(0);
    act(() => {
      view.frames.value = [1, -2];
    });
    const lines = container.querySelectorAll('.seq-row')[0]?.querySelectorAll('.seq-line.aa');
    expect(lines).toHaveLength(2);
    expect(lines?.[0]?.textContent?.replace(/ /g, '').startsWith('MK*')).toBe(true);
    expect([...container.querySelectorAll('.seq-frame-label')].slice(0, 2).map((l) => l.textContent)).toEqual(
      ['+1', '-2'],
    );
    expect(container.querySelector('.seq-mark.stop')).not.toBeNull();
    expect(container.querySelector('.seq-mark.start')).not.toBeNull();
  });
});

describe('translation rows agree with a whole-sequence translation', () => {
  const code = getGeneticCode(1);
  const readFrame = (seq: string, frame: 1 | 2 | 3 | -1 | -2 | -3, lineLength: number, blockSize: number) => {
    let residues = '';
    for (let rowStart = 0; rowStart < seq.length; rowStart += lineLength) {
      const row = translationRow(
        seq,
        rowStart,
        Math.min(seq.length, rowStart + lineLength),
        frame,
        code,
        blockSize,
      );
      residues += row.text.replace(/ /g, '');
    }
    return residues;
  };

  it.each([1, 2, 3] as const)('frame +%i (Biopython-checked translateFrame)', (frame) => {
    const seq = randomDna(1003, frame);
    for (const [lineLength, blockSize] of [
      [60, 0],
      [25, 10],
      [7, 0],
    ] as const) {
      expect(readFrame(seq, frame, lineLength, blockSize)).toBe(translateFrame(seq, frame));
    }
  });

  it.each([-1, -2, -3] as const)('frame %i, shown along the top strand', (frame) => {
    const seq = randomDna(1001, 10 - frame);
    const expected = sixFrameTranslation(seq).find((f) => f.frame === frame)?.protein ?? '';
    for (const [lineLength, blockSize] of [
      [60, 0],
      [25, 10],
      [7, 0],
    ] as const) {
      expect([...readFrame(seq, frame, lineLength, blockSize)].reverse().join('')).toBe(expected);
    }
  });

  it('marks start codons and stops', () => {
    const row = translationRow('ATGTAAGTG', 0, 9, 1, code, 0);
    expect(row.text).toBe(' M  *  V ');
    expect(row.marks).toEqual([
      { column: 1, kind: 'start' },
      { column: 4, kind: 'stop' },
    ]);
  });
});
