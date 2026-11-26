import { PUC19 } from '../../../../tests/fixtures/restriction/fixtures';
import { digest, ENZYME_CATALOG, scanSites } from '../../../engine/restriction';
import { updateSettings } from '../../../state/settings';
import { chosenSites, endLabel, enzymeRows, fragmentRows, NO_FILTER, siteWithCut } from './model';

const named = (...names: string[]) => ENZYME_CATALOG.filter((enzyme) => names.includes(enzyme.name));
const enzyme = (name: string) => named(name)[0] as (typeof ENZYME_CATALOG)[number];

beforeEach(() => updateSettings({ language: 'en' }));

describe('enzyme rows', () => {
  const scan = scanSites(PUC19, 'circular', named('EcoRI', 'HindIII', 'SmaI', 'AatII', 'PvuII', 'BsaI'));

  it('counts how often each enzyme cuts pUC19 (unique MCS cutters cut once, PvuII twice)', () => {
    const cuts = Object.fromEntries(enzymeRows(scan, NO_FILTER).map((row) => [row.enzyme.name, row.cuts]));
    expect(cuts.EcoRI).toBe(1);
    expect(cuts.HindIII).toBe(1);
    expect(cuts.SmaI).toBe(1);
    expect(cuts.PvuII).toBe(2);
  });

  it('filters by end type, cut count and supplier', () => {
    const blunt = enzymeRows(scan, { ...NO_FILTER, endType: 'blunt' }).map((row) => row.enzyme.name);
    expect(blunt).toContain('SmaI');
    expect(blunt).not.toContain('EcoRI');
    const doubles = enzymeRows(scan, { ...NO_FILTER, cuts: 'double' }).map((row) => row.enzyme.name);
    expect(doubles).toContain('PvuII');
    expect(doubles).not.toContain('EcoRI');
    const neb = enzymeRows(scan, { ...NO_FILTER, supplier: 'N' });
    expect(neb.length).toBeGreaterThan(0);
    expect(neb.every((row) => row.enzyme.suppliers.includes('N'))).toBe(true);
  });
});

describe('siteWithCut', () => {
  it('marks the top-strand cut inside the site', () => {
    expect(siteWithCut(enzyme('EcoRI'))).toBe('G^AATTC');
    expect(siteWithCut(enzyme('SmaI'))).toBe('CCC^GGG');
  });

  it('shows the cut offsets of an enzyme that cuts outside its site', () => {
    expect(siteWithCut(enzyme('BsaI'))).toBe('GGTCTC (7/11)');
  });
});

describe('fragment rows', () => {
  const scan = scanSites(PUC19, 'circular', named('EcoRI', 'HindIII'));
  const rows = fragmentRows(PUC19, digest(PUC19, 'circular', chosenSites(scan, ['EcoRI', 'HindIII'])));

  it('turns a double digest of circular pUC19 into two fragments that add up to the plasmid', () => {
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.length, 0)).toBe(PUC19.length);
    expect(rows.map((row) => row.length).sort((a, b) => a - b)).toEqual([51, 2635]);
  });

  it('reports 1-based inclusive positions, and the fragment across the origin as wrapping', () => {
    const small = rows.find((row) => row.length === 51);
    const large = rows.find((row) => row.length === 2635);
    expect(small?.wraps).toBe(false);
    expect(small?.start).toBe((small?.firstSegment.start ?? 0) + 1);
    expect(large?.wraps).toBe(true);
    expect(large?.sequence()).toHaveLength(2635);
  });

  it('cuts the sequence of a fragment from the parent', () => {
    for (const row of rows) {
      const wrapped = PUC19.slice(row.start - 1) + PUC19.slice(0, row.end);
      expect(row.sequence()).toBe(row.wraps ? wrapped : PUC19.slice(row.start - 1, row.end));
    }
  });

  it('describes the ends with their enzyme and overhang', () => {
    const labels = rows.flatMap((row) => [endLabel(row.left), endLabel(row.right)]);
    expect(labels).toContain("EcoRI · 5' overhang AATT");
    expect(labels).toContain("HindIII · 5' overhang AGCT");
  });

  it('labels a blunt end, a 3-prime overhang and a molecule terminus', () => {
    expect(endLabel({ kind: 'cut', enzyme: 'SmaI', end: 'blunt', overhang: '' })).toBe('SmaI · blunt');
    expect(endLabel({ kind: 'cut', enzyme: 'PstI', end: 'three_prime', overhang: 'TGCA' })).toBe(
      "PstI · 3' overhang TGCA",
    );
    expect(endLabel({ kind: 'terminus' })).toBe('Molecule end');
  });
});
