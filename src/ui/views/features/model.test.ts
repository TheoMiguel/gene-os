import { circularLocation, linearLocation } from '../../../engine/location';
import type { Feature, Location } from '../../../engine/types';
import {
  buildLocation,
  contrastGrade,
  contrastRatio,
  draftOf,
  featureFromDraft,
  featureRows,
  featureTranslation,
  keepAsUserFeature,
  locationCoordinates,
  mergeDetected,
  newFeatureId,
  parseColor,
  selectableSpan,
  withStrand,
} from './model';

const feature = (patch: Partial<Feature> = {}): Feature => ({
  id: 'f1',
  type: 'promoter',
  name: 'lac',
  location: linearLocation(10, 40, 1),
  origin: 'file',
  ...patch,
});

describe('buildLocation', () => {
  it('reads 1-based inclusive positions on a linear molecule', () => {
    const built = buildLocation('11', '40', 1, 100, 'linear');
    expect(built).toMatchObject({ ok: true, wraps: false, length: 30 });
    expect(built.ok && built.location.segments).toEqual([{ start: 10, end: 40 }]);
  });

  it('turns a start after the end on a circular molecule into one feature with two segments', () => {
    const built = buildLocation('2,680', '4', 1, 2686, 'circular');
    expect(built).toMatchObject({ ok: true, wraps: true, length: 11 });
    expect(built.ok && built.location.segments).toEqual([
      { start: 2679, end: 2686 },
      { start: 0, end: 4 },
    ]);
  });

  it('lists the segments 5 prime to 3 prime on the reverse strand', () => {
    const built = buildLocation('2680', '4', -1, 2686, 'circular');
    expect(built.ok && built.location.segments).toEqual([
      { start: 0, end: 4 },
      { start: 2679, end: 2686 },
    ]);
  });

  it('refuses a backwards range on a linear molecule', () => {
    expect(buildLocation('40', '11', 1, 100, 'linear')).toEqual({ ok: false, error: 'backwards' });
  });

  it('refuses text and positions outside the sequence', () => {
    expect(buildLocation('a', '4', 1, 100, 'linear')).toEqual({ ok: false, error: 'notNumber' });
    expect(buildLocation('0', '4', 1, 100, 'linear')).toEqual({ ok: false, error: 'outOfRange' });
    expect(buildLocation('1', '101', 1, 100, 'circular')).toEqual({ ok: false, error: 'outOfRange' });
  });
});

describe('locationCoordinates', () => {
  it('gives back the numbers that built a location, on either strand', () => {
    for (const strand of [1, -1] as const) {
      const wrapped = circularLocation(2679, 11, 2686, strand);
      expect(locationCoordinates(wrapped, 2686)).toEqual({ from: 2680, to: 4 });
    }
    expect(locationCoordinates(linearLocation(10, 40, 1), 100)).toEqual({ from: 11, to: 40 });
  });

  it('leaves a join of other shapes alone', () => {
    const exons: Location = {
      strand: 1,
      segments: [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ],
    };
    expect(locationCoordinates(exons, 100)).toBeNull();
  });
});

describe('withStrand and selectableSpan', () => {
  it('reverses the segments of a join when the strand flips', () => {
    const wrapped = circularLocation(90, 20, 100, 1);
    expect(withStrand(wrapped, -1).segments).toEqual([
      { start: 0, end: 10 },
      { start: 90, end: 100 },
    ]);
  });

  it('offers the part before the origin to the shared selection', () => {
    expect(selectableSpan(circularLocation(90, 20, 100, 1))).toEqual({ start: 90, end: 100 });
    expect(selectableSpan(circularLocation(90, 20, 100, -1))).toEqual({ start: 90, end: 100 });
  });
});

describe('featureFromDraft', () => {
  const record = { topology: 'linear', seq: 'A'.repeat(100) } as const;
  const context = { record, id: 'user:1' };

  it('keeps the stored location, id, origin and qualifiers when only the name changes', () => {
    const base = feature({ qualifiers: { note: ['x'] } });
    const result = featureFromDraft({ ...draftOf(base, 100), name: ' renamed ' }, context, base);
    expect(result).toEqual({
      ok: true,
      feature: { ...base, name: 'renamed' },
    });
  });

  it('keeps a custom type in sourceKey and drops the key when the type changes', () => {
    const custom = featureFromDraft(
      { ...draftOf(null, 100, { from: 1, to: 5 }), name: 'x', type: 'custom', customType: 'my_kind' },
      context,
      null,
    );
    expect(custom.ok && custom.feature).toMatchObject({
      type: 'custom',
      sourceKey: 'my_kind',
      origin: 'user',
    });
    const stored = custom.ok ? custom.feature : feature();
    const changed = featureFromDraft({ ...draftOf(stored, 100), type: 'tag' }, context, stored);
    expect(changed.ok && 'sourceKey' in changed.feature).toBe(false);
  });

  it('rebuilds the location when the coordinates change', () => {
    const base = feature();
    const result = featureFromDraft({ ...draftOf(base, 100), from: '1', to: '5' }, context, base);
    expect(result.ok && result.feature.location.segments).toEqual([{ start: 0, end: 5 }]);
  });

  it('flips the strand of a join whose coordinates the form cannot edit', () => {
    const exons: Feature = {
      ...feature(),
      location: {
        strand: 1,
        segments: [
          { start: 0, end: 10 },
          { start: 20, end: 30 },
        ],
      },
    };
    const result = featureFromDraft({ ...draftOf(exons, 100), strand: -1 }, context, exons);
    expect(result.ok && result.feature.location).toEqual({
      strand: -1,
      segments: [
        { start: 20, end: 30 },
        { start: 0, end: 10 },
      ],
    });
  });

  it('reports a missing name and bad coordinates', () => {
    expect(featureFromDraft(draftOf(null, 100, { from: 1, to: 5 }), context, null)).toEqual({
      ok: false,
      error: 'noName',
    });
    expect(featureFromDraft({ ...draftOf(null, 100), name: 'x', from: '9', to: '2' }, context, null)).toEqual(
      { ok: false, error: 'backwards' },
    );
  });
});

describe('the feature list', () => {
  it('adds the detected features that no stored feature already covers', () => {
    const stored = [feature()];
    const same = feature({ id: 'detected:1', origin: 'detected' });
    const other = feature({ id: 'detected:2', name: 'ori', origin: 'detected' });
    expect(mergeDetected(stored, [same, other]).map((f) => f.id)).toEqual(['f1', 'detected:2']);
  });

  it('names a custom type by its own key in the rows', () => {
    const [row] = featureRows([feature({ type: 'custom', sourceKey: 'my_kind' })]);
    expect(row).toMatchObject({ typeName: 'my_kind', length: 30, span: '11..40' });
  });

  it('copies a detected feature into one the user owns, without the engine score', () => {
    const detected = { ...feature({ origin: 'detected', description: 'd' }), identity: 0.97, source: 'X' };
    const copy = keepAsUserFeature(detected, 'user:9');
    expect(copy).toEqual({
      id: 'user:9',
      type: 'promoter',
      name: 'lac',
      location: detected.location,
      origin: 'user',
      description: 'd',
    });
  });

  it('never reuses an id', () => {
    expect(newFeatureId([feature({ id: 'user:2' }), feature({ id: 'user:1' })])).toBe('user:3');
  });
});

describe('feature translation', () => {
  it('reads a reverse-strand feature in its own direction (standard code, NCBI table 1)', () => {
    const record = { seq: 'CCTTTCATCC', alphabet: 'dna' } as const;
    const reverse = feature({ location: linearLocation(2, 8, -1) });
    expect(featureTranslation(record, reverse)).toBe('MK');
  });
});

describe('color contrast', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2);
  });

  it('grades a ratio', () => {
    expect([contrastGrade(7), contrastGrade(3.5), contrastGrade(1.2)]).toEqual(['good', 'fair', 'low']);
  });

  it('reads hex and rgb colors', () => {
    expect(parseColor('#5aa9e6')).toEqual([90, 169, 230]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('var(--cyan)')).toBeNull();
  });
});
