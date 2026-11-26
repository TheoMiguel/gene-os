import { LADDERS, migrationPosition, simulateGel } from '../../../engine/gel';
import {
  autoLadder,
  bandBrightness,
  bandThickness,
  closeGroups,
  defaultAgarose,
  formatBp,
  jitter,
  RESOLVABLE_GAP,
  suggestAgarose,
} from './gelModel';

describe('closeGroups', () => {
  it('flags two fragments that the engine draws as one band', () => {
    const [group] = closeGroups([1000, 1010, 4000], 1);
    expect(group).toEqual({ sizes: [1010, 1000], merged: true, identical: false });
    const lane = simulateGel([{ label: 'x', sizes: [1000, 1010, 4000] }], 1)[0];
    expect(lane?.bands.filter((b) => b.sizes.length > 1)).toHaveLength(1);
  });

  it('flags fragments that are drawn apart but closer than the picture can tell', () => {
    const [group] = closeGroups([1000, 1060], 1);
    expect(group?.merged).toBe(false);
    expect(Math.abs(migrationPosition(1000, 1) - migrationPosition(1060, 1))).toBeLessThan(RESOLVABLE_GAP);
  });

  it('keeps well separated fragments out', () => {
    expect(closeGroups([500, 1000, 2000, 4000], 1)).toEqual([]);
  });

  it('says that identical fragments cannot be separated', () => {
    expect(closeGroups([800, 800], 1)).toEqual([{ sizes: [800, 800], merged: true, identical: true }]);
  });

  it('chains three neighbours into one group', () => {
    expect(closeGroups([1000, 1040, 1080], 1)[0]?.sizes).toEqual([1080, 1040, 1000]);
  });

  it('reads a size range at the edge of the gel as close: huge fragments compress toward the well', () => {
    expect(closeGroups([30000, 40000], 1)).toHaveLength(1);
  });
});

describe('suggestAgarose', () => {
  it('suggests a percentage that separates small fragments a low percentage cannot', () => {
    const sizes = [150, 200];
    expect(closeGroups(sizes, 0.7)).toHaveLength(1);
    const better = suggestAgarose(sizes, 0.7);
    expect(better).not.toBeNull();
    expect(closeGroups(sizes, better ?? 0.7).length).toBeLessThan(1);
  });

  it('returns null when no percentage does better', () => {
    expect(suggestAgarose([800, 800], 1)).toBeNull();
    expect(suggestAgarose([500, 1000, 2000], 1)).toBeNull();
  });
});

describe('defaultAgarose', () => {
  it('is 1 % when there is nothing to run', () => {
    expect(defaultAgarose([])).toBe(1);
  });

  it('picks a high percentage for small fragments and a low one for large fragments', () => {
    expect(defaultAgarose([120, 200, 350])).toBeGreaterThanOrEqual(1.5);
    expect(defaultAgarose([6000, 12000, 20000])).toBeLessThanOrEqual(0.8);
  });

  it('puts every fragment of a typical plasmid digest inside the resolving range', () => {
    const percent = defaultAgarose([2635, 51]);
    expect(percent).toBeGreaterThanOrEqual(0.6);
    expect(percent).toBeLessThanOrEqual(2);
  });
});

describe('autoLadder', () => {
  it('uses the engine suggestion, and the first ladder for an empty gel', () => {
    expect(autoLadder([250, 750]).id).toBeTruthy();
    expect(autoLadder([])).toBe(LADDERS[0]);
  });
});

describe('band look helpers', () => {
  it('make heavier bands thicker and brighter, within bounds', () => {
    expect(bandThickness(1)).toBeGreaterThan(bandThickness(0.1));
    expect(bandBrightness(1)).toBeGreaterThan(bandBrightness(0.1));
    expect(bandBrightness(0)).toBeGreaterThan(0);
    expect(bandBrightness(5)).toBeLessThanOrEqual(1);
  });

  it('jitter is stable and between 0 and 1', () => {
    expect(jitter(3, 4)).toBe(jitter(3, 4));
    for (let i = 0; i < 20; i++) {
      expect(jitter(i, 2)).toBeGreaterThanOrEqual(0);
      expect(jitter(i, 2)).toBeLessThanOrEqual(1);
    }
  });

  it('formats a size with thousands separators and the unit', () => {
    expect(formatBp(2686)).toBe('2,686 bp');
  });
});
