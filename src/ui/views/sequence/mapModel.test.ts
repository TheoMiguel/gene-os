import { PUC19 } from '../../../../tests/fixtures/restriction/fixtures';
import goldenJson from '../../../../tests/oracle/restriction.json';
import { circularLocation, linearLocation } from '../../../engine/location';
import { ENZYME_CATALOG, scanSites } from '../../../engine/restriction';
import type { Enzyme, Feature } from '../../../engine/types';
import {
  featurePieces,
  isoschizomerKey,
  layoutFeatures,
  longestSpan,
  MAX_MAP_SITES,
  mapSites,
  oneEnzymePerSite,
  selectMapSites,
  splitAtOrigin,
} from './mapModel';

const golden = goldenJson as { search: Record<string, Record<string, number[]>> };

const feature = (id: string, start: number, end: number, strand: 1 | -1 = 1): Feature => ({
  id,
  type: 'CDS',
  name: id,
  origin: 'file',
  location: linearLocation(start, end, strand),
});

describe('features across the origin', () => {
  it('draws the two stored segments of an origin-spanning feature as one arc, whatever order the file wrote them in', () => {
    const forward = featurePieces(
      [
        { start: 2600, end: 2686 },
        { start: 0, end: 100 },
      ],
      2686,
      true,
    );
    const reverse = featurePieces(
      [
        { start: 0, end: 100 },
        { start: 2600, end: 2686 },
      ],
      2686,
      true,
    );
    expect(forward).toEqual([{ start: 2600, end: 2786 }]);
    expect(reverse).toEqual(forward);
  });

  it('keeps the segments of a linear molecule apart', () => {
    expect(
      featurePieces(
        [
          { start: 0, end: 100 },
          { start: 2600, end: 2686 },
        ],
        2686,
        false,
      ),
    ).toHaveLength(2);
  });

  it('puts an origin-spanning feature in a lane that only features clear of the origin share, and selects its longest part on a click', () => {
    const wrap: Feature = {
      id: 'wrap',
      type: 'CDS',
      name: 'wrap',
      origin: 'file',
      location: circularLocation(2600, 186, 2686, 1),
    };
    const { features, laneCount } = layoutFeatures(
      [wrap, feature('near', 50, 120), feature('far', 1000, 1500)],
      2686,
      true,
    );
    const [wrapped, near, far] = features;
    expect(wrapped?.pieces).toEqual([{ start: 2600, end: 2786 }]);
    expect(wrapped?.select).toEqual({ start: 0, end: 100 });
    expect(near?.lane).not.toBe(wrapped?.lane);
    expect(far?.lane).toBe(wrapped?.lane);
    expect(laneCount).toBe(2);
  });

  it('splits and measures spans', () => {
    expect(splitAtOrigin(2600, 2786, 2686)).toEqual([
      { start: 2600, end: 2686 },
      { start: 0, end: 100 },
    ]);
    expect(longestSpan(splitAtOrigin(2650, 2700, 2686))).toEqual({ start: 2650, end: 2686 });
  });
});

describe('restriction cuts on the map', () => {
  const scan = scanSites(PUC19, 'circular', ENZYME_CATALOG);

  it('numbers each single cutter like Bio.Restriction search on circular pUC19', () => {
    const expected = golden.search['pUC19/circular'] ?? {};
    const unique = mapSites(
      scan.sites.filter(({ topCuts }) => topCuts.length === 1),
      scan.length,
    );
    expect(unique.length).toBeGreaterThan(80);
    const wrong = unique.filter((site) => site.cut !== (expected[site.enzyme] ?? [])[0]);
    expect(wrong).toEqual([]);
  });

  it('orders cuts along the molecule and records where the recognition site is', () => {
    const sites = mapSites(
      scan.sites.filter(({ enzyme }) => enzyme.name === 'EcoRI'),
      scan.length,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ enzyme: 'EcoRI', cut: 396, siteStart: 395, siteEnd: 401, count: 1 });
  });

  it('draws one enzyme for each group of isoschizomers, preferring the one NEB sells', () => {
    const shown = selectMapSites(scan, 'unique', new Set()).sites.map((site) => site.enzyme);
    expect(shown).toContain('NdeI');
    expect(shown).not.toContain('FauNDI');
    const keys = shown.map((name) => isoschizomerKey(ENZYME_CATALOG.find((e) => e.name === name) as Enzyme));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every picked enzyme, even a second name for a site already drawn', () => {
    const shown = selectMapSites(scan, 'unique', new Set(['FauNDI'])).sites.map((site) => site.enzyme);
    expect(shown).toContain('FauNDI');
    expect(shown).not.toContain('NdeI');
  });

  it('shows more enzymes as the display widens, and none for none', () => {
    const count = (display: 'none' | 'unique' | 'few' | 'all') =>
      selectMapSites(scan, display, new Set()).sites.length;
    expect(count('none')).toBe(0);
    expect(count('unique')).toBeGreaterThan(20);
    expect(count('few')).toBeGreaterThan(count('unique'));
    expect(count('all')).toBeGreaterThan(count('few'));
  });

  it('draws a picked enzyme that cuts many times, which the display alone would hide', () => {
    const many = scan.sites.find(({ topCuts }) => topCuts.length >= 4);
    expect(many).toBeDefined();
    const name = many?.enzyme.name ?? '';
    expect(selectMapSites(scan, 'unique', new Set()).sites.some((s) => s.enzyme === name)).toBe(false);
    expect(
      selectMapSites(scan, 'unique', new Set([name])).sites.filter((s) => s.enzyme === name),
    ).toHaveLength(many?.topCuts.length ?? 0);
  });

  it('stops at the tick limit, rarest cutters first, and says how many cuts it left out', () => {
    const chosen = selectMapSites(scan, 'all', new Set(), 30);
    expect(chosen.sites.length).toBeLessThanOrEqual(30);
    expect(chosen.hidden).toBeGreaterThan(0);
    expect(chosen.sites.every((site) => site.count <= 2)).toBe(true);
    expect(selectMapSites(scan, 'all', new Set()).hidden).toBe(0);
    expect(MAX_MAP_SITES).toBeGreaterThan(1000);
  });

  it('groups enzymes by their shared key', () => {
    const sacI = scan.sites.filter(({ enzyme }) => ['SacI', 'Eco53kI'].includes(enzyme.name));
    expect(oneEnzymePerSite(sacI, new Set())).toHaveLength(Math.min(sacI.length, 2));
  });
});
