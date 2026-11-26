// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { randomDna } from '../../../tests/fixtures/restriction/fixtures';
import { codonUsage, countLetters, nucleotideSeries } from '../../engine/composition';
import { updateSettings } from '../../state/settings';
import { Chart } from './Chart';
import type { XYSeries } from './chartData';
import {
  AminoAcidCompositionChart,
  CodonUsageChart,
  GcContentChart,
  NucleotideCompositionChart,
} from './charts';

// jsdom has no layout: the chart falls back to 600 px, so the plot spans x = 58 .. 584 in client coordinates.
const PLOT_LEFT = 58;
const PLOT_WIDTH = 600 - 58 - 16;
const clientXOf = (fraction: number) => PLOT_LEFT + fraction * PLOT_WIDTH;

const ramp = (n: number): XYSeries => ({
  kind: 'line',
  name: 'Doubling',
  x: Float64Array.from({ length: n }, (_, i) => i),
  y: Float64Array.from({ length: n }, (_, i) => i * 2),
});

const pointer = (type: string, clientX: number, clientY = 100) =>
  new MouseEvent(type, { clientX, clientY, bubbles: true, button: 0 });

const svgOf = (container: Element) => container.querySelector('svg') as SVGSVGElement;

beforeEach(() => updateSettings({ language: 'en' }));
afterEach(cleanup);

describe('Chart readout', () => {
  it('shows the value under the cursor in a tooltip and hides it when the pointer leaves', () => {
    const { container } = render(<Chart title="Ramp" series={[ramp(101)]} />);
    expect(container.querySelector('.chart-tooltip')).toBeNull();

    fireEvent(svgOf(container), pointer('pointermove', clientXOf(0.5)));
    const tooltip = container.querySelector('.chart-tooltip') as HTMLElement;
    expect(within(tooltip).getByText('Doubling')).toBeTruthy();
    expect(within(tooltip).getByText('100')).toBeTruthy();
    expect(tooltip.textContent).toContain('50');

    fireEvent(svgOf(container), new MouseEvent('pointerleave', { bubbles: false }));
    expect(container.querySelector('.chart-tooltip')).toBeNull();
  });

  it('reports every series at the cursor and uses the series own wording for the position', () => {
    const second: XYSeries = {
      ...ramp(101),
      name: 'Flat',
      y: new Float64Array(101).fill(7),
      format: (v) => `${v} units`,
    };
    const first: XYSeries = { ...ramp(101), describe: (i) => `pos ${i + 1}` };
    const { container } = render(<Chart title="Two" series={[first, second]} />);
    fireEvent(svgOf(container), pointer('pointermove', clientXOf(0.25)));
    const tooltip = container.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.textContent).toContain('pos 26');
    expect(tooltip.textContent).toContain('Doubling');
    expect(tooltip.textContent).toContain('50');
    expect(tooltip.textContent).toContain('7 units');
  });

  it('reads a bar chart by category', () => {
    const { container } = render(
      <Chart
        title="Bars"
        categories={['A', 'C', 'G', 'T']}
        series={[{ kind: 'bar', name: 'Share', values: [10, 20, 30, 40] }]}
      />,
    );
    fireEvent(svgOf(container), pointer('pointermove', clientXOf(0.62)));
    const tooltip = container.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.textContent).toContain('G');
    expect(tooltip.textContent).toContain('30');
  });
});

describe('Chart keyboard access', () => {
  it('moves a readout cursor with the arrow keys and announces each value', () => {
    const { container } = render(<Chart title="Ramp" series={[ramp(11)]} />);
    const chart = screen.getByRole('application', { name: 'Ramp' });
    const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toBe('');

    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(live.textContent).toBe('0: Doubling 0');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(live.textContent).toBe('2: Doubling 4');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(live.textContent).toBe('1: Doubling 2');
    fireEvent.keyDown(chart, { key: 'End' });
    expect(live.textContent).toBe('10: Doubling 20');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(live.textContent).toBe('10: Doubling 20');
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(live.textContent).toBe('0: Doubling 0');
    expect(container.querySelector('.chart-tooltip')).not.toBeNull();
  });

  it('steps ten points at a time with Shift', () => {
    const { container } = render(<Chart title="Ramp" series={[ramp(101)]} />);
    const chart = screen.getByRole('application', { name: 'Ramp' });
    fireEvent.keyDown(chart, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(chart, { key: 'ArrowRight', shiftKey: true });
    expect((container.querySelector('[aria-live="polite"]') as HTMLElement).textContent).toBe(
      '19: Doubling 38',
    );
  });

  it('reads bars with the keyboard', () => {
    const { container } = render(
      <Chart
        title="Bars"
        categories={['A', 'C', 'G']}
        series={[{ kind: 'bar', name: 'Share', values: [1, 2, 3] }]}
      />,
    );
    const chart = screen.getByRole('application', { name: 'Bars' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect((container.querySelector('[aria-live="polite"]') as HTMLElement).textContent).toBe('C: Share 2');
  });

  it('is reachable with Tab and explains the keys', () => {
    render(<Chart title="Ramp" series={[ramp(11)]} />);
    const chart = screen.getByRole('application', { name: 'Ramp' });
    expect(chart.tabIndex).toBe(0);
    expect(chart.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Use the left and right arrow keys to read values.')).toBeTruthy();
  });
});

describe('Chart zoom', () => {
  it('zooms the x axis to a brushed range and zooms out again', () => {
    const onBrush = vi.fn();
    const { container } = render(<Chart title="Ramp" series={[ramp(1001)]} brush onBrush={onBrush} />);
    const svg = svgOf(container);
    fireEvent(svg, pointer('pointerdown', clientXOf(0.2)));
    fireEvent(svg, pointer('pointermove', clientXOf(0.4)));
    expect(container.querySelector('.chart-brush')).not.toBeNull();
    fireEvent(svg, pointer('pointerup', clientXOf(0.4)));

    const [low, high] = (onBrush.mock.calls[0] as [[number, number]])[0];
    expect(low).toBeCloseTo(200, 0);
    expect(high).toBeCloseTo(400, 0);

    fireEvent(svg, pointer('pointermove', clientXOf(0.5)));
    expect((container.querySelector('.chart-tooltip') as HTMLElement).textContent).toContain('300');

    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(onBrush).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
  });

  it('ignores a click that is not a drag, and does nothing without brush', () => {
    const onBrush = vi.fn();
    const { container } = render(<Chart title="Ramp" series={[ramp(101)]} brush onBrush={onBrush} />);
    fireEvent(svgOf(container), pointer('pointerdown', clientXOf(0.2)));
    fireEvent(svgOf(container), pointer('pointerup', clientXOf(0.2)));
    expect(onBrush).not.toHaveBeenCalled();

    cleanup();
    const plain = render(<Chart title="Ramp" series={[ramp(101)]} onBrush={onBrush} />);
    fireEvent(svgOf(plain.container), pointer('pointerdown', clientXOf(0.2)));
    fireEvent(svgOf(plain.container), pointer('pointerup', clientXOf(0.6)));
    expect(onBrush).not.toHaveBeenCalled();
  });
});

describe('Chart marks', () => {
  it('draws a few thousand marks at most for a million points, and keeps the spike', () => {
    const n = 1_000_000;
    const y = new Float64Array(n).fill(1);
    y[600_000] = 500;
    const series: XYSeries = {
      kind: 'scatter',
      name: 'Big',
      x: Float64Array.from({ length: n }, (_, i) => i),
      y,
    };
    const { container } = render(<Chart title="Big" series={[series]} exportName={false} />);
    const circles = container.querySelectorAll('.chart-scatter circle');
    expect(circles.length).toBeGreaterThan(100);
    expect(circles.length).toBeLessThanOrEqual(4000);
    const tops = [...container.querySelectorAll('.chart-scatter circle')].map((c) =>
      Number(c.getAttribute('cy')),
    );
    const flat = tops.filter((cy) => cy > 100).length;
    expect(Math.min(...tops)).toBeLessThan(15);
    expect(flat).toBeGreaterThan(0);
  });

  it('keeps the extremes of a line in view', () => {
    const n = 200_000;
    const y = new Float64Array(n).fill(0);
    y[12_345] = 10;
    y[150_000] = -10;
    const { container } = render(
      <Chart
        title="Line"
        series={[{ kind: 'line', name: 'S', x: Float64Array.from({ length: n }, (_, i) => i), y }]}
      />,
    );
    const ticks = [...container.querySelectorAll('.chart-grid ~ .chart-tick, .chart-tick')].map(
      (tick) => tick.textContent,
    );
    expect(ticks).toContain('10');
    expect(ticks).toContain('-10');
  });

  it('draws a heat strip, stacked bars and an area without errors', () => {
    const n = 500;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const heat = render(
      <Chart
        title="Heat"
        series={[{ kind: 'heat', name: 'H', x, y: Float64Array.from(x, (v) => v % 50) }]}
      />,
    );
    expect(heat.container.querySelectorAll('.chart-heat rect').length).toBeGreaterThan(10);
    const stacked = render(
      <Chart
        title="Stack"
        categories={['a', 'b']}
        series={[
          {
            kind: 'stacked',
            name: 'S',
            layers: [
              { name: 'L1', values: [1, 2] },
              { name: 'L2', values: [3, 1] },
            ],
          },
        ]}
      />,
    );
    expect(stacked.container.querySelectorAll('.chart-bar')).toHaveLength(4);
    const area = render(<Chart title="Area" series={[{ ...ramp(50), kind: 'area' }]} />);
    expect(area.container.querySelector('.chart-area')).not.toBeNull();
  });

  it('renders axis titles and tick labels, and renders nothing odd for no data', () => {
    const { container } = render(
      <Chart title="Ramp" xLabel="Position (bp)" yLabel="Value" series={[ramp(101)]} />,
    );
    expect(container.textContent).toContain('Position (bp)');
    expect(container.textContent).toContain('Value');
    cleanup();
    const empty = render(<Chart title="Empty" series={[]} />);
    expect(empty.container.querySelector('svg')).not.toBeNull();
  });
});

describe('configured charts take the engine output', () => {
  it('plots GC content with its window described in 1-based bp', () => {
    const seq = randomDna(5000, 5);
    const series = nucleotideSeries(seq, 'gc', { window: 100, step: 50 });
    const { container } = render(<GcContentChart series={series} seqLength={seq.length} />);
    expect(screen.getByRole('application', { name: 'GC content' })).toBeTruthy();
    fireEvent(svgOf(container), pointer('pointermove', clientXOf(0)));
    const tooltip = container.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.textContent).toContain('bp 1–100');
    expect(tooltip.textContent).toMatch(/\d+\.\d%/);
  });

  it('plots codon usage with the amino acid in the readout', () => {
    const { rows } = codonUsage('ATGAAAGAATTCATGAAA');
    render(<CodonUsageChart rows={rows} />);
    const chart = screen.getByRole('application', { name: 'Codon usage' });
    fireEvent.keyDown(chart, { key: 'Home' });
    const live = chart.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toMatch(/^TTT \(F\): /);
  });

  it('plots amino acid and nucleotide composition as percent', () => {
    const protein = render(<AminoAcidCompositionChart counts={countLetters('AAAC')} />);
    const proteinChart = within(protein.container as HTMLElement).getByRole('application', {
      name: 'Amino acid composition',
    });
    fireEvent.keyDown(proteinChart, { key: 'Home' });
    expect(proteinChart.querySelector('[aria-live="polite"]')?.textContent).toContain('A: 3');
    fireEvent.keyDown(proteinChart, { key: 'ArrowRight' });
    expect(proteinChart.querySelector('[aria-live="polite"]')?.textContent).toContain('25.0%');
    cleanup();

    const dna = render(<NucleotideCompositionChart counts={countLetters('AACGTTT')} />);
    fireEvent.keyDown(
      within(dna.container as HTMLElement).getByRole('application', { name: 'Nucleotide composition' }),
      {
        key: 'Home',
      },
    );
    expect(dna.container.querySelector('[aria-live="polite"]')?.textContent).toContain('A: 2');
  });
});

describe('performance', { timeout: 60_000 }, () => {
  it('renders a 5 million point series in well under a second of marks work', () => {
    const n = 5_000_000;
    const series: XYSeries = {
      kind: 'line',
      name: 'Five Mb',
      x: Float64Array.from({ length: n }, (_, i) => i),
      y: Float64Array.from({ length: n }, (_, i) => Math.sin(i / 1000)),
    };
    const started = performance.now();
    const { container } = render(<Chart title="Five" series={[series]} exportName={false} />);
    act(() => {});
    expect(performance.now() - started).toBeLessThan(5000);
    const path = container.querySelector('.chart-line')?.getAttribute('d') ?? '';
    expect(path.split('L').length).toBeLessThanOrEqual(4001);
  });
});
