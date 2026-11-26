import {
  circularLocation,
  extractLocation,
  formatLocation,
  linearLocation,
  locationLength,
} from '../../../engine/location';
import { translate } from '../../../engine/translate';
import type {
  Feature,
  FeatureType,
  Location,
  SeqRecord,
  Span,
  Strand,
  Topology,
} from '../../../engine/types';

/** Why a coordinate pair cannot become a location. */
export type CoordinateError = 'notNumber' | 'outOfRange' | 'backwards';

export type CoordinateResult =
  | { readonly ok: true; readonly location: Location; readonly wraps: boolean; readonly length: number }
  | { readonly ok: false; readonly error: CoordinateError };

/** One line of the features table. */
export interface FeatureRow {
  readonly feature: Feature;
  readonly length: number;
  /** GenBank-style location in 1-based positions. */
  readonly span: string;
  /** The type the user sees: a custom type shows its own name. */
  readonly typeName: string;
}

const NUMBER_SEPARATORS = /[\s,_]/g;

function parsePosition(text: string): number | null {
  const cleaned = text.replace(NUMBER_SEPARATORS, '');
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/**
 * Turns the 1-based inclusive `from` and `to` a user typed into a location. On a circular molecule a `from`
 * greater than `to` runs through the origin and gives one feature with two segments. On a linear molecule it is
 * an error. Commas and spaces inside a number are ignored.
 */
export function buildLocation(
  from: string,
  to: string,
  strand: Strand,
  seqLength: number,
  topology: Topology,
): CoordinateResult {
  const first = parsePosition(from);
  const last = parsePosition(to);
  if (first === null || last === null) return { ok: false, error: 'notNumber' };
  if (first < 1 || last < 1 || first > seqLength || last > seqLength)
    return { ok: false, error: 'outOfRange' };
  const wraps = first > last;
  if (wraps && topology !== 'circular') return { ok: false, error: 'backwards' };
  const length = wraps ? seqLength - first + 1 + last : last - first + 1;
  const location =
    topology === 'circular'
      ? circularLocation(first - 1, length, seqLength, strand)
      : linearLocation(first - 1, last, strand);
  return { ok: true, location, wraps, length };
}

/**
 * The 1-based `from` and `to` that describe a location the editor can change: one segment, or the two segments of
 * a feature across the origin. A join of other shapes returns null and keeps its coordinates as they are.
 */
export function locationCoordinates(
  location: Location,
  seqLength: number,
): { readonly from: number; readonly to: number } | null {
  const [a, b] = location.segments;
  if (a === undefined) return null;
  if (b === undefined) return { from: a.start + 1, to: a.end };
  if (location.segments.length !== 2 || location.operator !== undefined) return null;
  const head = location.strand === 1 ? a : b;
  const tail = location.strand === 1 ? b : a;
  return head.end === seqLength && tail.start === 0 && tail.end < head.start
    ? { from: head.start + 1, to: tail.end }
    : null;
}

/** The same location read on the other strand. Segments stay in biological order, so a join reverses. */
export function withStrand(location: Location, strand: Strand): Location {
  if (location.strand === strand) return location;
  return { ...location, strand, segments: [...location.segments].reverse() as readonly Span[] };
}

/** The span of the feature on the top strand that the shared selection can show: the part before the origin. */
export function selectableSpan(location: Location): Span {
  const first = location.segments[0] as Span;
  const last = location.segments[location.segments.length - 1] as Span;
  if (location.segments.length === 1) return first;
  const head = location.strand === 1 ? first : last;
  return head;
}

const locationKey = (feature: Feature) =>
  `${feature.name}|${feature.location.strand}|${feature.location.segments.map((s) => `${s.start}-${s.end}`).join(',')}`;

/** The file's and the user's features, then the detected ones that no stored feature already covers. */
export function mergeDetected(stored: readonly Feature[], detected: readonly Feature[]): Feature[] {
  const known = new Set(stored.map(locationKey));
  return [...stored, ...detected.filter((feature) => !known.has(locationKey(feature)))];
}

/** One table row for each feature. */
export function featureRows(features: readonly Feature[]): FeatureRow[] {
  return features.map((feature) => ({
    feature,
    length: locationLength(feature.location),
    span: formatLocation(feature.location),
    typeName: feature.type === 'custom' && feature.sourceKey ? feature.sourceKey : feature.type,
  }));
}

/** An id no feature in `features` uses. */
export function newFeatureId(features: readonly Feature[]): string {
  const used = new Set(features.map((feature) => feature.id));
  let n = used.size + 1;
  while (used.has(`user:${n}`)) n++;
  return `user:${n}`;
}

/** A detected feature copied into a feature the user owns. The engine's score and source stay behind. */
export function keepAsUserFeature(feature: Feature, id: string): Feature {
  return {
    id,
    type: feature.type,
    name: feature.name,
    location: feature.location,
    origin: 'user',
    ...(feature.color === undefined ? {} : { color: feature.color }),
    ...(feature.description === undefined ? {} : { description: feature.description }),
  };
}

/** What the form holds. Positions stay text so a half-typed number does not jump. */
export interface FeatureDraft {
  readonly name: string;
  readonly type: FeatureType;
  readonly customType: string;
  readonly strand: Strand;
  /** Absent means the theme color of the type. */
  readonly color: string | undefined;
  readonly description: string;
  readonly from: string;
  readonly to: string;
}

/** Why a draft cannot be saved. */
export type DraftError = CoordinateError | 'noName';

export type DraftResult =
  | { readonly ok: true; readonly feature: Feature }
  | { readonly ok: false; readonly error: DraftError };

/** The form's starting values: a stored feature, or a blank one over `range` (1-based) when given. */
export function draftOf(
  feature: Feature | null,
  seqLength: number,
  range?: { readonly from: number; readonly to: number },
): FeatureDraft {
  if (!feature)
    return {
      name: '',
      type: 'misc_feature',
      customType: '',
      strand: 1,
      color: undefined,
      description: '',
      from: range ? String(range.from) : '',
      to: range ? String(range.to) : '',
    };
  const coordinates = locationCoordinates(feature.location, seqLength);
  return {
    name: feature.name,
    type: feature.type,
    customType: feature.type === 'custom' ? (feature.sourceKey ?? '') : '',
    strand: feature.location.strand,
    color: feature.color,
    description: feature.description ?? '',
    from: coordinates ? String(coordinates.from) : '',
    to: coordinates ? String(coordinates.to) : '',
  };
}

/**
 * Builds the feature the draft describes. With `base` it is an edit: the id, origin and qualifiers stay, and the
 * location stays as it was unless the user changed the coordinates or the strand. A custom type is kept in
 * `sourceKey`; any other type drops the old key, because the key would override the new type on export.
 */
export function featureFromDraft(
  draft: FeatureDraft,
  context: { readonly record: Pick<SeqRecord, 'topology' | 'seq'>; readonly id: string },
  base: Feature | null,
): DraftResult {
  const name = draft.name.trim();
  if (name === '') return { ok: false, error: 'noName' };
  const seqLength = context.record.seq.length;
  const original = base ? locationCoordinates(base.location, seqLength) : null;
  const editable = !base || original !== null;
  let location: Location;
  if (base && (!editable || (draft.from === String(original?.from) && draft.to === String(original?.to)))) {
    location = withStrand(base.location, draft.strand);
  } else {
    const built = buildLocation(draft.from, draft.to, draft.strand, seqLength, context.record.topology);
    if (!built.ok) return built;
    location = built.location;
  }
  const custom = draft.customType.trim();
  const sourceKey = draft.type === 'custom' ? custom : base && base.type === draft.type ? base.sourceKey : '';
  const description = draft.description.trim();
  return {
    ok: true,
    feature: {
      id: base?.id ?? context.id,
      type: draft.type,
      name,
      location,
      origin: base?.origin ?? 'user',
      ...(sourceKey ? { sourceKey } : {}),
      ...(draft.color ? { color: draft.color } : {}),
      ...(description ? { description } : {}),
      ...(base?.qualifiers ? { qualifiers: base.qualifiers } : {}),
    },
  };
}

/** The feature's sequence read in its own direction. */
export function featureSequence(record: Pick<SeqRecord, 'seq' | 'alphabet'>, feature: Feature): string {
  return extractLocation(record.seq, feature.location, record.alphabet);
}

/** The feature's sequence translated with the standard code, stop codons written `*`. */
export function featureTranslation(record: Pick<SeqRecord, 'seq' | 'alphabet'>, feature: Feature): string {
  return translate(featureSequence(record, feature));
}

/** The RGB of a CSS color the page can show, 0-255 each, or null when the text is not a color we read. */
export function parseColor(css: string): readonly [number, number, number] | null {
  const text = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as unknown as [
      number,
      number,
      number,
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(text);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: readonly [number, number, number]) =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** WCAG contrast ratio between two colors, 1 to 21. */
export function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `good` from 4.5, `fair` from 3 (the WCAG minimum for a graphic), else `low`. */
export type ContrastGrade = 'good' | 'fair' | 'low';

/** Grades a contrast ratio for a color drawn as a shape on the background. */
export function contrastGrade(ratio: number): ContrastGrade {
  return ratio >= 4.5 ? 'good' : ratio >= 3 ? 'fair' : 'low';
}
