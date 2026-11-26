import { readFileSync } from 'node:fs';

/**
 * Layout contracts that no jsdom test can observe, because jsdom has no layout engine. Each one failed
 * in a real browser once: with nine sequences open at 1024 px the header grew past the window and took
 * the new-sequence button off screen, while spec 3.9 forbids a page scrollbar that could bring it back.
 */
const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');

function rules(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing block ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

describe('shell layout contracts', () => {
  it('constrains the shell grid to one column, so a wide row cannot stretch the page', () => {
    expect(rules('.app-shell')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it('scrolls the sequence tab list itself, so the new-sequence button stays reachable', () => {
    expect(rules('.seq-tabs')).toMatch(/overflow-x:\s*auto/);
    expect(rules('.seq-tabs')).toMatch(/min-width:\s*0/);
    expect(rules('.seq-tab')).toMatch(/flex:\s*0 0 auto/);
  });

  it('keeps the strip around the tab list from scrolling, so the button is outside the scroller', () => {
    expect(rules('.tab-strip')).toMatch(/overflow:\s*hidden/);
  });
});
