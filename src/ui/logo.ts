/**
 * Geometry of the GENE_OS mark: a "G" ring and crossbar with a double helix inside the curve, whose base
 * pairs are horizontal bars. One source for the header logo and the favicon.
 */
export const LOGO = {
  viewBox: '0 0 64 64',
  /** The G: an open ring from the upper right, counter-clockwise to the crossbar. */
  ring: 'M48.97 15.03A24 24 0 1 0 56 32H39',
  ringWidth: 7,
  strands: ['M25 17Q39 24.5 25 32T25 47', 'M25 17Q11 24.5 25 32T25 47'],
  strandWidth: 3,
  /** Base pairs: y and half-width of each bar, centred on the helix axis. */
  pairs: [
    { y: 21.5, half: 4.5 },
    { y: 27.5, half: 4.5 },
    { y: 36.5, half: 4.5 },
    { y: 42.5, half: 4.5 },
  ],
  axisX: 25,
  pairWidth: 2.5,
} as const;

export interface LogoColors {
  readonly ring: string;
  readonly helix: string;
}

/** Standalone SVG markup of the mark, for the favicon. */
export function logoSvg(colors: LogoColors): string {
  const stroke = (color: string, width: number, cap = 'butt') =>
    `fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="${cap}"`;
  const strands = LOGO.strands.map(
    (d) => `<path d="${d}" ${stroke(colors.helix, LOGO.strandWidth, 'round')}/>`,
  );
  const pairs = LOGO.pairs.map(
    ({ y, half }) =>
      `<path d="M${LOGO.axisX - half} ${y}H${LOGO.axisX + half}" ${stroke(colors.helix, LOGO.pairWidth)}/>`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO.viewBox}">`,
    `<path d="${LOGO.ring}" ${stroke(colors.ring, LOGO.ringWidth)}/>`,
    ...strands,
    ...pairs,
    '</svg>',
    '',
  ].join('\n');
}

/** Favicon colors: the V1.2.0 teal accent and cyan. */
export const FAVICON_COLORS: LogoColors = { ring: '#63c7b2', helix: '#58b4d1' };
