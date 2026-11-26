// @vitest-environment jsdom
import { alignMultiple, alignPair } from '../../../engine/align';
import { buildAlignmentSvg } from './alignmentSvg';
import { msaDisplay, pairDisplay } from './model';

describe('alignment image', () => {
  it('draws a pair with its ruler, both rows and a match line, each as one text line', () => {
    const result = alignPair('ACGTACGTACGTACGTACGTACGT', 'ACGTACGAACGTACGTACG', { alphabet: 'dna' });
    if (result.status !== 'ok') throw new Error('expected an alignment');
    const display = pairDisplay(result.alignment, ['ref', 'read']);
    const svg = buildAlignmentSvg(display, 0, display.length);
    const rows = [...svg.querySelectorAll('text[textLength]')].map((t) => t.textContent);
    expect(rows).toEqual([display.rows[0], expect.stringMatching(/^[|:. ]+$/), display.rows[1]]);
    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toEqual(
      expect.arrayContaining(['10', '20', 'ref', 'read']),
    );
  });

  it('covers only the asked columns', () => {
    const result = alignPair('ACGTACGTACGTACGTACGTACGT', 'ACGTACGTACGTACGTACGTACGT', { alphabet: 'dna' });
    if (result.status !== 'ok') throw new Error('expected an alignment');
    const svg = buildAlignmentSvg(pairDisplay(result.alignment, ['a', 'b']), 5, 15);
    expect(svg.querySelector('text[textLength]')?.textContent).toBe('CGTACGTACG');
  });

  it('adds consensus and one conservation bar per column for a multiple alignment', () => {
    const result = alignMultiple(['ACGTACGTAC', 'ACGTACGTAC', 'ACGAACGTAC'], { alphabet: 'dna' });
    if (result.status !== 'ok') throw new Error('expected an alignment');
    const display = msaDisplay(result.alignment, ['a', 'b', 'c']);
    const svg = buildAlignmentSvg(display, 0, display.length);
    expect(svg.querySelectorAll('text[textLength]')).toHaveLength(4);
    const bars = [...svg.querySelectorAll('rect[fill-opacity="0.85"]')];
    expect(bars).toHaveLength(display.length);
  });

  it('writes literal colors, so a saved file needs no page to show them', () => {
    const result = alignPair('ACGT', 'ACGA', { alphabet: 'dna' });
    if (result.status !== 'ok') throw new Error('expected an alignment');
    const svg = buildAlignmentSvg(pairDisplay(result.alignment, ['a', 'b']), 0, 4);
    expect(svg.outerHTML).not.toContain('var(');
  });
});
