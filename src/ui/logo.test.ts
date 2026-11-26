import favicon from '../../public/favicon.svg?raw';
import { FAVICON_COLORS, logoSvg } from './logo';

describe('favicon', () => {
  it('is the logo geometry in the default colors', () => {
    // On drift, regenerate public/favicon.svg with logoSvg(FAVICON_COLORS).
    expect(favicon).toBe(logoSvg(FAVICON_COLORS));
  });
});
