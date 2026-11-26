// @vitest-environment jsdom
import { signal } from '@preact/signals';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { LADDERS } from '../../../engine/gel';
import { updateSettings } from '../../../state/settings';
import { serializeSvg } from '../../export/svg';
import { GelFigure } from './Gel';
import { GelPanel } from './GelPanel';

const ladder = LADDERS.find((l) => l.id === 'neb-1kb') ?? (LADDERS[0] as (typeof LADDERS)[number]);

beforeEach(() => updateSettings({ language: 'en' }));
afterEach(cleanup);

describe('GelFigure', () => {
  const lanes = [
    { id: 'a', label: 'EcoRI', sizes: [2635, 51] },
    { id: 'b', label: 'HindIII', sizes: [2686] },
  ];

  it('draws a ladder lane and one lane per sample, and names the ladder and the agarose on the picture', () => {
    const { container } = render(<GelFigure lanes={lanes} ladder={ladder} agarose={1} selected={null} />);
    expect(container.querySelectorAll('.gel-well')).toHaveLength(3);
    expect(container.textContent).toContain('1 kb DNA Ladder');
    expect(container.textContent).toContain('1.0 % agarose');
    expect(container.textContent).toContain('EcoRI');
  });

  it('labels the ladder bands with their sizes', () => {
    const { container } = render(<GelFigure lanes={lanes} ladder={ladder} agarose={1} selected={null} />);
    const labels = [...container.querySelectorAll('.gel-size')].map((el) => el.textContent);
    expect(labels).toContain('10,002');
    expect(labels).toContain('2,635');
  });

  it('makes each sample band a button that names its size and selects its fragment on click and Enter', () => {
    const picked: [string, readonly number[]][] = [];
    render(
      <GelFigure
        lanes={lanes}
        ladder={ladder}
        agarose={1}
        selected={null}
        onSelect={(lane, sizes) => picked.push([lane, sizes])}
      />,
    );
    const band = screen.getByRole('button', { name: 'EcoRI: 2,635 bp' });
    fireEvent.click(band);
    fireEvent.keyDown(band, { key: 'Enter' });
    expect(picked).toEqual([
      ['a', [2635]],
      ['a', [2635]],
    ]);
  });

  it('shows a tooltip with the size when the pointer is over a band', () => {
    const { container } = render(<GelFigure lanes={lanes} ladder={ladder} agarose={1} selected={null} />);
    expect(container.querySelector('.gel-tip-text')).toBeNull();
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'HindIII: 2,686 bp' }));
    expect(container.querySelector('.gel-tip-text')?.textContent).toBe('2,686 bp');
  });

  it('draws two fragments that co-migrate as one band, and names both', () => {
    render(
      <GelFigure
        lanes={[{ id: 'm', label: 'mix', sizes: [1000, 1008] }]}
        ladder={ladder}
        agarose={1}
        selected={null}
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('1,008 + 1,000 bp');
  });

  it('marks the selected band', () => {
    const { container } = render(
      <GelFigure lanes={lanes} ladder={ladder} agarose={1} selected={{ lane: 'a', size: 51 }} />,
    );
    expect(container.querySelectorAll('.gel-selected')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'EcoRI: 51 bp' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('exports as a standalone SVG without the interface-only marks', () => {
    const { container } = render(
      <GelFigure lanes={lanes} ladder={ladder} agarose={1} selected={{ lane: 'a', size: 51 }} />,
    );
    const { text } = serializeSvg(container.querySelector('svg') as SVGSVGElement);
    expect(text).toContain('<svg');
    expect(text).toContain('1 kb DNA Ladder');
    expect(text).not.toContain('gel-selected');
  });
});

describe('GelPanel', () => {
  const settings = () => ({ ladder: signal<string | null>(null), agarose: signal<number | null>(null) });

  it('preselects the suggested ladder and lets the user change it', () => {
    const state = settings();
    render(
      <GelPanel
        title="Gel"
        settings={state}
        lanes={[{ id: 'a', label: 'x', sizes: [250, 750] }]}
        selected={null}
        exportName="gel"
      />,
    );
    const select = screen.getByLabelText('Ladder') as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toContain('suggested');
    const other = LADDERS.find((l) => l.id !== select.value);
    fireEvent.change(select, { target: { value: other?.id } });
    expect(state.ladder.value).toBe(other?.id);
  });

  it('warns about fragments that run together and fixes it with the suggested agarose', () => {
    const state = settings();
    state.agarose.value = 0.7;
    render(
      <GelPanel
        title="Gel"
        settings={state}
        lanes={[{ id: 'a', label: 'EcoRI+PstI', sizes: [150, 200, 3000] }]}
        selected={null}
        exportName="gel"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('EcoRI+PstI');
    expect(alert.textContent).toContain('200, 150');
    fireEvent.click(screen.getByRole('button', { name: /^Use \d\.\d %$/ }));
    expect(state.agarose.value).toBeGreaterThan(0.7);
  });

  it('shows a hint instead of bands when there is nothing to run', () => {
    render(<GelPanel title="Gel" settings={settings()} lanes={[]} selected={null} exportName="gel" />);
    expect(screen.getByText(/Nothing to run yet/)).toBeTruthy();
  });

  it('offers SVG and PNG export', () => {
    render(<GelPanel title="Gel" settings={settings()} lanes={[]} selected={null} exportName="gel" />);
    expect(screen.getByRole('button', { name: 'Save SVG' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save PNG' })).toBeTruthy();
  });
});
