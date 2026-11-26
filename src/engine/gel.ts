import ladderCatalog from '../data/ladders.json';

/** A commercial DNA ladder with the vendor's band sizes and band masses for a reference load. */
export interface Ladder {
  readonly id: string;
  readonly vendor: string;
  readonly name: string;
  readonly catalog: string;
  /** Vendor page or manual the band data comes from. */
  readonly source: string;
  /** Total DNA mass, ng, that the band masses refer to. */
  readonly loadNg: number;
  readonly note: string;
  /** Largest band first. */
  readonly bands: readonly { readonly bp: number; readonly ng: number; readonly reference?: boolean }[];
}

export const LADDERS: readonly Ladder[] = ladderCatalog as readonly Ladder[];

export type GelSample =
  | {
      readonly label: string;
      /** Fragment lengths, one entry per molecule species; the species are equimolar. */
      readonly sizes: readonly number[];
      /** Total DNA loaded, ng. Defaults to 500. */
      readonly loadNg?: number;
    }
  | { readonly label: string; readonly ladder: Ladder; readonly loadNg?: number };

export interface GelBand {
  /** Fragment lengths that run together in this band. */
  readonly sizes: readonly number[];
  /** 0 at the well, 1 at the bottom of the gel. */
  readonly position: number;
  /** DNA mass in the band, ng. */
  readonly massNg: number;
  /** Mass relative to the heaviest band on the whole gel, 0..1. */
  readonly intensity: number;
  readonly reference: boolean;
}

export interface GelLane {
  readonly label: string;
  /** Bands from the well down. */
  readonly bands: readonly GelBand[];
}

const DEFAULT_LOAD_NG = 500;
/** Bands closer than this (fraction of the lane) are seen as one band. */
const BAND_RESOLUTION = 0.008;

/**
 * Size range (bp) that an agarose gel of a given percentage separates well, from the standard table in
 * Sambrook & Russell, Molecular Cloning: A Laboratory Manual, 3rd ed. (2001), chapter 5.
 */
const RESOLVING_RANGES: readonly (readonly [percent: number, minBp: number, maxBp: number])[] = [
  [0.3, 5000, 60000],
  [0.6, 1000, 20000],
  [0.7, 800, 10000],
  [0.9, 500, 7000],
  [1.2, 400, 6000],
  [1.5, 200, 3000],
  [2.0, 100, 2000],
];

/** Resolving range of an agarose percentage, interpolated in log space between table rows and clamped. */
export function resolvingRange(agarosePercent: number): { readonly minBp: number; readonly maxBp: number } {
  const first = RESOLVING_RANGES[0] as (typeof RESOLVING_RANGES)[number];
  const last = RESOLVING_RANGES[RESOLVING_RANGES.length - 1] as (typeof RESOLVING_RANGES)[number];
  if (agarosePercent <= first[0]) return { minBp: first[1], maxBp: first[2] };
  if (agarosePercent >= last[0]) return { minBp: last[1], maxBp: last[2] };
  const upper = RESOLVING_RANGES.findIndex(([percent]) => percent >= agarosePercent);
  const row = RESOLVING_RANGES[upper] as (typeof RESOLVING_RANGES)[number];
  if (row[0] === agarosePercent) return { minBp: row[1], maxBp: row[2] };
  const [p0, min0, max0] = RESOLVING_RANGES[upper - 1] as (typeof RESOLVING_RANGES)[number];
  const [p1, min1, max1] = row;
  const t = (agarosePercent - p0) / (p1 - p0);
  const lerpLog = (a: number, b: number) => 10 ** (Math.log10(a) + t * (Math.log10(b) - Math.log10(a)));
  return { minBp: lerpLog(min0, min1), maxBp: lerpLog(max0, max1) };
}

/**
 * Migration distance of a linear double-stranded fragment, 0 (well) to 1 (bottom).
 *
 * Model: distance follows log(size) through the gel's resolving range, which maps onto 0.1..0.9 of the lane;
 * a tanh curve compresses fragments outside the range toward the well (large) and the front (small), as
 * agarose stops resolving them. It is a display model, not a calibrated prediction.
 */
export function migrationPosition(bp: number, agarosePercent: number): number {
  const { minBp, maxBp } = resolvingRange(agarosePercent);
  const t = (Math.log10(maxBp) - Math.log10(bp)) / (Math.log10(maxBp) - Math.log10(minBp));
  const steepness = 2 * Math.atanh(0.8);
  return 0.5 + 0.5 * Math.tanh(steepness * (t - 0.5));
}

interface RawBand {
  readonly bp: number;
  readonly massNg: number;
  readonly reference: boolean;
}

function rawBands(sample: GelSample): RawBand[] {
  if ('ladder' in sample) {
    const scale = (sample.loadNg ?? sample.ladder.loadNg) / sample.ladder.loadNg;
    return sample.ladder.bands.map((b) => ({
      bp: b.bp,
      massNg: b.ng * scale,
      reference: b.reference === true,
    }));
  }
  const totalBp = sample.sizes.reduce((sum, bp) => sum + bp, 0);
  const load = sample.loadNg ?? DEFAULT_LOAD_NG;
  return sample.sizes.map((bp) => ({
    bp,
    massNg: totalBp > 0 ? (load * bp) / totalBp : 0,
    reference: false,
  }));
}

function mergeBands(raw: readonly RawBand[], agarosePercent: number): Omit<GelBand, 'intensity'>[] {
  const placed = raw
    .map((band) => ({ ...band, position: migrationPosition(band.bp, agarosePercent) }))
    .sort((a, b) => a.position - b.position);
  const merged: { sizes: number[]; position: number; massNg: number; reference: boolean }[] = [];
  for (const band of placed) {
    const previous = merged[merged.length - 1];
    if (previous && band.position - previous.position < BAND_RESOLUTION) {
      const massNg = previous.massNg + band.massNg;
      previous.position =
        massNg > 0
          ? (previous.position * previous.massNg + band.position * band.massNg) / massNg
          : previous.position;
      previous.massNg = massNg;
      previous.sizes.push(band.bp);
      previous.reference ||= band.reference;
    } else {
      merged.push({
        sizes: [band.bp],
        position: band.position,
        massNg: band.massNg,
        reference: band.reference,
      });
    }
  }
  return merged;
}

/**
 * Lay out lanes of an agarose gel: band positions and intensities, no drawing.
 *
 * A sample's DNA mass splits over its fragments in proportion to their length (equimolar fragments), so longer
 * fragments give brighter bands; a ladder uses the vendor's band masses. Fragments that run closer than the gel
 * can resolve merge into one band whose mass is the sum. Intensity is the band mass over the heaviest band on
 * the gel.
 */
export function simulateGel(samples: readonly GelSample[], agarosePercent = 1): GelLane[] {
  const lanes = samples.map((sample) => ({
    label: sample.label,
    bands: mergeBands(rawBands(sample), agarosePercent),
  }));
  const heaviest = Math.max(0, ...lanes.flatMap((lane) => lane.bands.map((b) => b.massNg)));
  return lanes.map((lane) => ({
    label: lane.label,
    bands: lane.bands.map((b) => ({ ...b, intensity: heaviest > 0 ? b.massNg / heaviest : 0 })),
  }));
}

/**
 * Pick the ladder whose bands best bracket the given fragment sizes.
 *
 * Score, highest wins: fragments inside the ladder's size range count most; then each fragment's distance (in
 * log size) to the nearest ladder band, so a fragment sits next to a band it can be read against; then the
 * part of the ladder's range that no fragment needs, so a tight ladder beats a very wide one.
 */
export function suggestLadder(sizes: readonly number[], ladders: readonly Ladder[] = LADDERS): Ladder {
  const logs = sizes.filter((bp) => bp > 0).map(Math.log10);
  let best = ladders[0] as Ladder;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const ladder of ladders) {
    const bandLogs = ladder.bands.map((b) => Math.log10(b.bp));
    const top = Math.max(...bandLogs);
    const bottom = Math.min(...bandLogs);
    const covered = logs.filter((x) => x >= bottom - 0.02 && x <= top + 0.02).length;
    const nearest = logs.reduce((sum, x) => sum + Math.min(...bandLogs.map((b) => Math.abs(b - x))), 0);
    const needTop = logs.length ? Math.max(...logs) : top;
    const needBottom = logs.length ? Math.min(...logs) : bottom;
    const unused = Math.max(0, top - needTop) + Math.max(0, needBottom - bottom);
    const score = covered * 10 - nearest / Math.max(1, logs.length) - 0.5 * unused;
    if (score > bestScore) {
      best = ladder;
      bestScore = score;
    }
  }
  return best;
}
