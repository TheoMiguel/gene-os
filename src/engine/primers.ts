import thermoParameters from '../data/thermo-parameters.json';
import { encodeBases, reverseComplement } from './alphabet';
import { findBindingSites } from './pcr';
import type { PrimerBinding, PrimerConditions, Span, Strand, Topology } from './types';

/** primer3 default reaction conditions (primer3-py `calc_tm`, `calc_hairpin`, ...). */
export const PRIMER3_CONDITIONS: PrimerConditions = { naMm: 50, mgMm: 1.5, dntpMm: 0.6, oligoNm: 50 };

/** A hairpin at or below this deltaG (kcal/mol, 37 °C) is reported as a problem. */
export const HAIRPIN_DG_LIMIT = -3;
/** A self- or cross-dimer at or below this deltaG (kcal/mol, 37 °C) is reported as a problem. */
export const DIMER_DG_LIMIT = -6;

const T_KELVIN = 273.15;
const T37 = 310.15;
const R = 1.987;

// ---------------------------------------------------------------------------
// Base codes and composition
// ---------------------------------------------------------------------------

/** G+C content in percent of all bases. */
export function gcPercent(seq: string): number {
  if (seq.length === 0) return 0;
  let gc = 0;
  for (const c of seq.toUpperCase()) if (c === 'G' || c === 'C') gc++;
  return (100 * gc) / seq.length;
}

// ---------------------------------------------------------------------------
// Melting temperature
// ---------------------------------------------------------------------------

// SantaLucia (1998) unified nearest-neighbor parameters as tabulated in primer3 oligotm.c, rows and columns
// A, C, G, T, N; enthalpy in 100 cal/mol and entropy in 0.1 cal/(K mol), both as stabilities (sign flipped).
const NN_DH = [
  [79, 84, 78, 72, 72],
  [85, 80, 106, 78, 78],
  [82, 98, 80, 84, 80],
  [72, 82, 85, 79, 72],
  [72, 80, 78, 72, 72],
];
const NN_DS = [
  [222, 224, 210, 204, 224],
  [227, 199, 272, 210, 272],
  [222, 244, 199, 224, 244],
  [213, 222, 227, 222, 227],
  [168, 210, 220, 215, 220],
];
// Duplex disruption free energy at 37 °C, cal/mol (oligotm.c DG table).
const NN_DG = [
  [1000, 1440, 1280, 880, 880],
  [1450, 1840, 2170, 1280, 1450],
  [1300, 2240, 1840, 1440, 1300],
  [580, 1300, 1450, 1000, 580],
  [580, 1300, 1280, 880, 580],
];

const at = (table: number[][], a: number, b: number) => table[a]?.[b] ?? 0;

/** Nearest-neighbor enthalpy (cal/mol) and entropy (cal/(K mol)) of a perfect duplex, with terminal terms. */
function duplexThermo(seq: ArrayLike<number>): { dH: number; dS: number } {
  let dh = 0;
  let ds = 0;
  for (const end of [seq[0], seq[seq.length - 1]]) {
    if (end === 0 || end === 3) {
      ds -= 41;
      dh -= 23;
    } else if (end === 1 || end === 2) {
      ds += 28;
      dh -= 1;
    }
  }
  for (let i = 0; i + 1 < seq.length; i++) {
    dh += at(NN_DH, seq[i] ?? 4, seq[i + 1] ?? 4);
    ds += at(NN_DS, seq[i] ?? 4, seq[i + 1] ?? 4);
  }
  return { dH: dh * -100, dS: ds * -0.1 };
}

/** primer3 `symmetry`: true when an even-length oligo equals its reverse complement. */
function isSelfComplementary(seq: string): boolean {
  return seq.length % 2 === 0 && reverseComplement(seq) === seq;
}

/** Sodium-equivalent of free Mg2+ (von Ahsen et al. 2001): 120 * sqrt([Mg] - [dNTP]), mM. */
function divalentToMonovalent(mgMm: number, dntpMm: number): number {
  return mgMm > dntpMm ? 120 * Math.sqrt(mgMm - dntpMm) : 0;
}

/**
 * Nearest-neighbor Tm (°C) as primer3 `calc_tm` computes it with its defaults: SantaLucia (1998) parameters,
 * SantaLucia salt correction with Mg2+ converted to a sodium equivalent, symmetry correction for
 * self-complementary oligos, and primer3's long-sequence formula above `maxNnLength` bases.
 */
export function tmNearestNeighbor(
  seq: string,
  conditions: PrimerConditions = PRIMER3_CONDITIONS,
  maxNnLength = 60,
) {
  const upper = seq.toUpperCase();
  const k = conditions.naMm + divalentToMonovalent(conditions.mgMm, conditions.dntpMm);
  if (upper.length > maxNnLength) {
    const gc = gcPercent(upper) / 100;
    return 81.5 + 16.6 * Math.log10(k / 1000) + 41 * gc - 600 / upper.length;
  }
  const { dH, dS } = duplexThermo(encodeBases(upper));
  const symmetric = isSelfComplementary(upper);
  const entropy = dS + (symmetric ? -1.4 : 0) + 0.368 * (upper.length - 1) * Math.log(k / 1000);
  const strands = symmetric ? 1e9 : 4e9;
  return dH / (entropy + R * Math.log(conditions.oligoNm / strands)) - T_KELVIN;
}

export interface BiopythonSalt {
  readonly naMm?: number;
  readonly kMm?: number;
  readonly trisMm?: number;
  readonly mgMm?: number;
  readonly dntpMm?: number;
  /** Concentration of the higher-concentrated strand, nM. Default 25. */
  readonly dnac1Nm?: number;
  /** Concentration of the lower-concentrated strand, nM. Default 25. */
  readonly dnac2Nm?: number;
}

/**
 * Biopython `Bio.SeqUtils.MeltingTemp.Tm_NN` with its defaults: table DNA_NN3, salt correction method 5,
 * Na 50 mM, strands 25 nM each. Non-ACGT letters are dropped first, as Biopython does.
 */
export function tmBiopythonNN(seq: string, salt: BiopythonSalt = {}): number {
  const clean = seq.toUpperCase().replace(/[^ACGT]/g, '');
  const { naMm = 50, kMm = 0, trisMm = 0, mgMm = 0, dntpMm = 0, dnac1Nm = 25, dnac2Nm = 25 } = salt;
  const mon = naMm + kMm + trisMm / 2 + divalentToMonovalent(mgMm, dntpMm);
  const { dH, dS } = duplexThermo(encodeBases(clean));
  const entropy = dS + 0.368 * (clean.length - 1) * Math.log(mon / 1000);
  return dH / (entropy + R * Math.log((dnac1Nm - dnac2Nm / 2) * 1e-9)) - T_KELVIN;
}

/** Wallace rule (Thein & Wallace 1986): 4 °C per G or C plus 2 °C per A or T (Biopython `Tm_Wallace`). */
export function tmWallace(seq: string): number {
  let tm = 0;
  for (const c of seq.toUpperCase()) tm += c === 'G' || c === 'C' ? 4 : c === 'A' || c === 'T' ? 2 : 0;
  return tm;
}

/** GC-content Tm, Biopython `Tm_GC` defaults (value set 7): 81.5 + 0.41 %GC - 600/N + 16.6 log10([Na+]). */
export function tmGC(seq: string, naMm = 50): number {
  return 81.5 + 0.41 * gcPercent(seq) - 600 / seq.length + 16.6 * Math.log10(naMm / 1000);
}

/**
 * 3' end stability as primer3 defines it (`end_oligodg`): the deltaG of disrupting the duplex formed by the last
 * `bases` nucleotides, kcal/mol. Bigger means a more stable, more sticky 3' end.
 */
export function endStability(seq: string, bases = 5): number {
  const tail = encodeBases(seq.slice(-bases));
  if (tail.length < 2) return 0;
  let dg = -1960;
  if (tail[0] === 0 || tail[0] === 3) dg -= 50;
  for (let i = 0; i + 1 < tail.length; i++) dg += at(NN_DG, tail[i] ?? 4, tail[i + 1] ?? 4);
  const last = tail[tail.length - 1];
  if (last === 0 || last === 3) dg -= 50;
  return dg / 1000;
}

// ---------------------------------------------------------------------------
// Secondary structures (hairpin, dimers)
// ---------------------------------------------------------------------------

interface ThermoTable {
  readonly dh: readonly (number | null)[];
  readonly ds: readonly (number | null)[];
}

/** One energy quantity (enthalpy, entropy or free energy at 37 °C) for every table of the model. */
interface EnergyTables {
  readonly stack: Float64Array;
  readonly stackMismatch: Float64Array;
  readonly terminalMismatch: Float64Array;
  readonly hairpinMismatch: Float64Array;
  readonly dangle3: Float64Array;
  readonly dangle5: Float64Array;
  readonly interiorLoop: Float64Array;
  readonly bulgeLoop: Float64Array;
  readonly hairpinLoop: Float64Array;
  readonly atPenalty: number;
  readonly loopAsymmetry: number;
}

type Quantity = 'h' | 's' | 'g';
const INVALID = Number.POSITIVE_INFINITY;

function quantity(dh: number | null | undefined, ds: number | null | undefined, which: Quantity): number {
  if (dh === null || dh === undefined || ds === null || ds === undefined || !Number.isFinite(dh))
    return INVALID;
  if (which === 'h') return dh;
  return which === 's' ? ds : dh - T37 * ds;
}

/** Thermodynamic tables (SantaLucia & Hicks 2004, as distributed with primer3 thal) for one quantity. */
function energyTables(which: Quantity): EnergyTables {
  const P = thermoParameters;
  const table = (t: ThermoTable) => Float64Array.from(t.dh, (dh, i) => quantity(dh, t.ds[i], which));
  // thal marks impossible loop sizes with entropy -1.
  const loops = (kind: 'interior' | 'bulge' | 'hairpin') =>
    Float64Array.from(P.loopsDh[kind], (dh, i) => {
      const ds = P.loopsDs[kind][i];
      return ds === -1 ? INVALID : quantity(dh, ds, which);
    });
  // thal: AT closing penalty 2.2 kcal/mol and 6.9 e.u.; internal-loop asymmetry -0.3 kcal/mol as entropy.
  const asymmetryS = -300 / T37;
  return {
    stack: table(P.stack),
    stackMismatch: table(P.stackMismatch),
    terminalMismatch: table(P.terminalMismatch),
    hairpinMismatch: table(P.hairpinMismatch),
    dangle3: table(P.dangle3),
    dangle5: table(P.dangle5),
    interiorLoop: loops('interior'),
    bulgeLoop: loops('bulge'),
    hairpinLoop: loops('hairpin'),
    atPenalty: quantity(2200, 6.9, which),
    loopAsymmetry: quantity(0, asymmetryS, which),
  };
}

const G = energyTables('g');
const H = energyTables('h');
const S = energyTables('s');
const MAX_LOOP = 30;
const DUPLEX_INIT = { h: 200, s: -5.7 };

const pairs = (a: number, b: number) => a < 4 && b < 4 && a + b === 3;

function lookup4(table: Float64Array, a = 4, b = 4, c = 4, d = 4): number {
  if (a > 3 || b > 3 || c > 3 || d > 3) return INVALID;
  return table[((a * 4 + b) * 4 + c) * 4 + d] ?? INVALID;
}

function lookup3(table: Float64Array, a = 4, b = 4, c = 4): number {
  if (a > 3 || b > 3 || c > 3) return INVALID;
  return table[(a * 4 + b) * 4 + c] ?? INVALID;
}

const atPenalty = (t: EnergyTables, base: number) => (base === 0 || base === 3 ? t.atPenalty : 0);

/** Entropy salt correction per base pair beyond the first (thal `saltCorrectS`), cal/(K mol). */
function saltEntropy(conditions: PrimerConditions): number {
  return (
    0.368 * Math.log((conditions.naMm + divalentToMonovalent(conditions.mgMm, conditions.dntpMm)) / 1000)
  );
}

/** How the free end of a helix is treated: bare, or with a terminal mismatch or dangling bases. */
type EndOption = 'none' | 'mismatch' | 'dangle3' | 'dangle5' | 'dangles';

/**
 * Energy of the free end of a helix at pair (x, y) whose unpaired neighbours are `x1` (next to x) and `y1`
 * (next to y): AT penalty plus the given end option. Arguments follow thal's table addressing.
 */
function helixEnd(t: EnergyTables, option: EndOption, x: number, y: number, x1 = 4, y1 = 4): number {
  const d3 = () => lookup3(t.dangle3, y, y1, x);
  const d5 = () => lookup3(t.dangle5, y, x, x1);
  const extra =
    option === 'none'
      ? 0
      : option === 'mismatch'
        ? lookup4(t.hairpinMismatch, y, y1, x, x1)
        : option === 'dangle3'
          ? d3()
          : option === 'dangle5'
            ? d5()
            : d3() + d5();
  return atPenalty(t, x) + extra;
}

/** The end option with the lowest free energy at 37 °C for the neighbours that exist. */
function bestEnd(x: number, y: number, x1: number | undefined, y1: number | undefined): EndOption {
  const options: EndOption[] = ['none'];
  if (x1 !== undefined && y1 !== undefined) options.push('mismatch');
  if (x1 === undefined || y1 === undefined || !pairs(x1, y1)) {
    if (y1 !== undefined) options.push('dangle3');
    if (x1 !== undefined) options.push('dangle5');
    if (x1 !== undefined && y1 !== undefined) options.push('dangles');
  }
  let best: EndOption = 'none';
  let bestG = INVALID;
  for (const option of options) {
    const g = helixEnd(G, option, x, y, x1, y1);
    if (g < bestG) {
      bestG = g;
      best = option;
    }
  }
  return best;
}

/**
 * Energy of the loop between an outer pair and an inner pair with `x` and `y` unpaired bases on each side
 * (thal `calc_bulge_internal`). `outer` is (a1, the base after it, its partner b1, the base after b1); `inner`
 * is (a2, the base before it, its partner b2, the base before b2), "before" and "after" read toward the loop.
 */
function loopClosure(
  t: EnergyTables,
  x: number,
  y: number,
  outer: readonly [number, number, number, number],
  inner: readonly [number, number, number, number],
): number {
  const [a1, a1n, b1, b1n] = outer;
  const [a2, a2p, b2, b2p] = inner;
  const size = x + y;
  if (x === 0 || y === 0) {
    if (size === 1) return (t.bulgeLoop[0] ?? INVALID) + lookup4(t.stack, a1, a2, b1, b2);
    return (t.bulgeLoop[size - 1] ?? INVALID) + atPenalty(t, a1) + atPenalty(t, a2);
  }
  if (x === 1 && y === 1)
    return lookup4(t.stackMismatch, a1, a1n, b1, b1n) + lookup4(t.stackMismatch, b2, b2p, a2, a2p);
  return (
    (t.interiorLoop[size - 1] ?? INVALID) +
    lookup4(t.terminalMismatch, a1, a1n, b1, b1n) +
    lookup4(t.terminalMismatch, b2, b2p, a2, a2p) +
    t.loopAsymmetry * Math.abs(x - y)
  );
}

/** Per-cell helix state of the dynamic programme, struct-of-arrays. */
class Helices {
  readonly g: Float64Array;
  readonly h: Float64Array;
  readonly s: Float64Array;
  readonly pairCount: Int32Array;
  readonly link: Int32Array;

  constructor(size: number) {
    this.g = new Float64Array(size).fill(INVALID);
    this.h = new Float64Array(size);
    this.s = new Float64Array(size);
    this.pairCount = new Int32Array(size);
    this.link = new Int32Array(size).fill(-1);
  }

  set(cell: number, g: number, h: number, s: number, pairCount: number, link: number): void {
    this.g[cell] = g;
    this.h[cell] = h;
    this.s[cell] = s;
    this.pairCount[cell] = pairCount;
    this.link[cell] = link;
  }
}

function finish(h: number, s: number, pairCount: number, conditions: PrimerConditions): number {
  return (h - T37 * (s + saltEntropy(conditions) * Math.max(0, pairCount - 1))) / 1000;
}

export interface DimerStructure {
  /** deltaG at 37 °C, kcal/mol; 0 when no structure forms. */
  readonly dg: number;
  /** Paired bases: index in the first oligo, index in the second oligo (both 5'→3'). */
  readonly pairs: readonly (readonly [number, number])[];
  /** Text alignment: first oligo 5'→3', pair marks, second oligo 3'→5'. */
  readonly alignment: readonly [string, string, string];
}

export interface HairpinStructure {
  /** deltaG at 37 °C, kcal/mol; 0 when no structure forms. */
  readonly dg: number;
  /** Paired bases (i < j). */
  readonly pairs: readonly (readonly [number, number])[];
  /** Dot-bracket notation of the fold. */
  readonly dotBracket: string;
}

/**
 * Most stable duplex between two oligos (a self-dimer when both are the same), with its deltaG and alignment.
 *
 * The energy model follows primer3 `thal` with the SantaLucia & Hicks (2004) parameters: stacks, single
 * mismatches, bulges and internal loops up to 30 unpaired bases, terminal mismatches and dangling ends,
 * bimolecular initiation and salt correction. Each helix keeps the path of lowest free energy, a
 * simplification of thal's mixed Tm/deltaG choices, so values can differ slightly from `calc_heterodimer`.
 */
export function dimer(
  first: string,
  second: string,
  conditions: PrimerConditions = PRIMER3_CONDITIONS,
): DimerStructure {
  const a = encodeBases(first);
  const b = encodeBases(second).reverse();
  const n = a.length;
  const m = b.length;
  const cells = new Helices(n * m);
  let best = { g: 0, h: 0, s: 0, pairCount: 0, cell: -1 };

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const ai = a[i] ?? 4;
      const bj = b[j] ?? 4;
      if (!pairs(ai, bj)) continue;
      const cell = i * m + j;
      const left = bestEnd(ai, bj, a[i - 1], b[j - 1]);
      let g = helixEnd(G, left, ai, bj, a[i - 1], b[j - 1]);
      let h = helixEnd(H, left, ai, bj, a[i - 1], b[j - 1]);
      let s = helixEnd(S, left, ai, bj, a[i - 1], b[j - 1]);
      let count = 1;
      let link = -1;
      if (i > 0 && j > 0 && (cells.g[cell - m - 1] ?? INVALID) < INVALID) {
        const prev = cell - m - 1;
        const step = lookup4(G.stack, a[i - 1], ai, b[j - 1], bj);
        if ((cells.g[prev] ?? 0) + step < g) {
          g = (cells.g[prev] ?? 0) + step;
          h = (cells.h[prev] ?? 0) + lookup4(H.stack, a[i - 1], ai, b[j - 1], bj);
          s = (cells.s[prev] ?? 0) + lookup4(S.stack, a[i - 1], ai, b[j - 1], bj);
          count = (cells.pairCount[prev] ?? 0) + 1;
          link = prev;
        }
      }
      for (let x = 0; x <= MAX_LOOP && i - 1 - x >= 0; x++) {
        for (let y = x === 0 ? 1 : 0; x + y <= MAX_LOOP && j - 1 - y >= 0; y++) {
          const prev = (i - 1 - x) * m + (j - 1 - y);
          const before = cells.g[prev] ?? INVALID;
          if (before === INVALID) continue;
          const p = i - 1 - x;
          const q = j - 1 - y;
          const outer = [a[p] ?? 4, a[p + 1] ?? 4, b[q] ?? 4, b[q + 1] ?? 4] as const;
          const inner = [ai, a[i - 1] ?? 4, bj, b[j - 1] ?? 4] as const;
          const loopG = loopClosure(G, x, y, outer, inner);
          if (before + loopG < g) {
            g = before + loopG;
            h = (cells.h[prev] ?? 0) + loopClosure(H, x, y, outer, inner);
            s = (cells.s[prev] ?? 0) + loopClosure(S, x, y, outer, inner);
            count = (cells.pairCount[prev] ?? 0) + 1;
            link = prev;
          }
        }
      }
      cells.set(cell, g, h, s, count, link);
      const right = bestEnd(bj, ai, b[j + 1], a[i + 1]);
      const total = g + helixEnd(G, right, bj, ai, b[j + 1], a[i + 1]) + DUPLEX_INIT.h - T37 * DUPLEX_INIT.s;
      if (total < best.g) {
        best = {
          g: total,
          h: h + helixEnd(H, right, bj, ai, b[j + 1], a[i + 1]) + DUPLEX_INIT.h,
          s: s + helixEnd(S, right, bj, ai, b[j + 1], a[i + 1]) + DUPLEX_INIT.s,
          pairCount: count,
          cell,
        };
      }
    }
  }

  const paired: [number, number][] = [];
  for (let cell = best.cell; cell >= 0; cell = cells.link[cell] ?? -1) {
    paired.unshift([Math.floor(cell / m), m - 1 - (cell % m)]);
  }
  const dg = best.cell < 0 ? 0 : finish(best.h, best.s, best.pairCount, conditions);
  return { dg, pairs: paired, alignment: alignDimer(first, second, paired) };
}

/**
 * Most stable single hairpin of an oligo (loop of 3 to 30 bases), built with the same energy model as `dimer`
 * and no initiation term.
 *
 * thal keeps the fold with the highest melting temperature, which can be a short GC-rich stem with a small
 * deltaG; this function keeps the fold with the lowest deltaG at 37 °C. It therefore never misses a stable
 * hairpin that primer3 reports, but it can report a long stable stem where primer3 reports a weaker one.
 */
export function hairpin(seq: string, conditions: PrimerConditions = PRIMER3_CONDITIONS): HairpinStructure {
  const a = encodeBases(seq);
  const n = a.length;
  const cells = new Helices(n * n);

  for (let span = 4; span < n; span++) {
    for (let i = 0; i + span < n; i++) {
      const j = i + span;
      const ai = a[i] ?? 4;
      const aj = a[j] ?? 4;
      if (!pairs(ai, aj)) continue;
      const cell = i * n + j;
      const loopSize = span - 1;
      const close = (t: EnergyTables) =>
        (t.hairpinLoop[Math.min(loopSize, MAX_LOOP) - 1] ?? INVALID) +
        (loopSize > 3 ? lookup4(t.hairpinMismatch, ai, a[i + 1], aj, a[j - 1]) : atPenalty(t, ai));
      let g = close(G);
      let h = close(H);
      let s = close(S);
      let count = 1;
      let link = -1;
      const stacked = cell + n - 1;
      if ((cells.g[stacked] ?? INVALID) < INVALID) {
        const step = lookup4(G.stack, ai, a[i + 1], aj, a[j - 1]);
        if ((cells.g[stacked] ?? 0) + step < g) {
          g = (cells.g[stacked] ?? 0) + step;
          h = (cells.h[stacked] ?? 0) + lookup4(H.stack, ai, a[i + 1], aj, a[j - 1]);
          s = (cells.s[stacked] ?? 0) + lookup4(S.stack, ai, a[i + 1], aj, a[j - 1]);
          count = (cells.pairCount[stacked] ?? 0) + 1;
          link = stacked;
        }
      }
      for (let x = 0; x <= MAX_LOOP; x++) {
        for (let y = x === 0 ? 1 : 0; x + y <= MAX_LOOP; y++) {
          const ii = i + 1 + x;
          const jj = j - 1 - y;
          if (jj - ii < 4) break;
          const within = ii * n + jj;
          if ((cells.g[within] ?? INVALID) === INVALID) continue;
          const outer = [ai, a[i + 1] ?? 4, aj, a[j - 1] ?? 4] as const;
          const inner = [a[ii] ?? 4, a[ii - 1] ?? 4, a[jj] ?? 4, a[jj + 1] ?? 4] as const;
          const loopG = loopClosure(G, x, y, outer, inner);
          if ((cells.g[within] ?? 0) + loopG < g) {
            g = (cells.g[within] ?? 0) + loopG;
            h = (cells.h[within] ?? 0) + loopClosure(H, x, y, outer, inner);
            s = (cells.s[within] ?? 0) + loopClosure(S, x, y, outer, inner);
            count = (cells.pairCount[within] ?? 0) + 1;
            link = within;
          }
        }
      }
      cells.set(cell, g, h, s, count, link);
    }
  }

  let best = { g: INVALID, h: 0, s: 0, pairCount: 0, cell: -1 };
  for (let i = 0; i < n; i++) {
    for (let j = i + 4; j < n; j++) {
      const cell = i * n + j;
      const g = cells.g[cell] ?? INVALID;
      if (g === INVALID) continue;
      const ai = a[i] ?? 4;
      const aj = a[j] ?? 4;
      const x1 = i > 0 ? a[i - 1] : undefined;
      const option = bestEnd(ai, aj, x1, a[j + 1]);
      const total = g + helixEnd(G, option, ai, aj, x1, a[j + 1]);
      if (total < best.g) {
        best = {
          g: total,
          h: (cells.h[cell] ?? 0) + helixEnd(H, option, ai, aj, x1, a[j + 1]),
          s: (cells.s[cell] ?? 0) + helixEnd(S, option, ai, aj, x1, a[j + 1]),
          pairCount: cells.pairCount[cell] ?? 0,
          cell,
        };
      }
    }
  }
  const dg = best.cell < 0 ? 0 : finish(best.h, best.s, best.pairCount, conditions);
  const paired: [number, number][] = [];
  if (dg < 0) {
    for (let cell = best.cell; cell >= 0; cell = cells.link[cell] ?? -1)
      paired.push([Math.floor(cell / n), cell % n]);
  }
  const dots = Array.from({ length: n }, () => '.');
  for (const [i, j] of paired) {
    dots[i] = '(';
    dots[j] = ')';
  }
  return { dg: Math.min(0, dg), pairs: paired, dotBracket: dots.join('') };
}

function alignDimer(first: string, second: string, paired: readonly (readonly [number, number])[]) {
  const top: string[] = [];
  const mid: string[] = [];
  const bottom: string[] = [];
  const b = second.toUpperCase().split('').reverse();
  const a = first.toUpperCase().split('');
  const column = (x: string, bar: string, y: string) => {
    top.push(x);
    mid.push(bar);
    bottom.push(y);
  };
  let i = 0;
  let j = 0;
  for (const [pi, pjForward] of paired) {
    const pj = b.length - 1 - pjForward;
    const gap = Math.max(pi - i, pj - j);
    for (let k = 0; k < gap; k++) {
      const ai = pi - gap + k;
      const bj = pj - gap + k;
      column(ai >= i ? (a[ai] ?? ' ') : ' ', ' ', bj >= j ? (b[bj] ?? ' ') : ' ');
    }
    column(a[pi] ?? ' ', '|', b[pj] ?? ' ');
    i = pi + 1;
    j = pj + 1;
  }
  const tail = Math.max(a.length - i, b.length - j);
  for (let k = 0; k < tail; k++) column(a[i + k] ?? ' ', ' ', b[j + k] ?? ' ');
  return [top.join(''), mid.join(''), bottom.join('')] as const;
}

// ---------------------------------------------------------------------------
// Primer analysis
// ---------------------------------------------------------------------------

export interface PrimerAnalysis {
  readonly length: number;
  readonly gcPercent: number;
  /** Nearest-neighbor Tm as primer3 computes it, °C. */
  readonly tm: number;
  readonly tmBasic: { readonly wallace: number; readonly gc: number; readonly biopythonNN: number };
  /** primer3 3' end stability, kcal/mol (bigger is stickier). */
  readonly endStability: number;
  readonly hairpin: HairpinStructure & { readonly problem: boolean };
  readonly selfDimer: DimerStructure & { readonly problem: boolean };
  /** Every binding site on the template, both strands, mismatches included. Absent without a template. */
  readonly bindingSites?: readonly PrimerBinding[];
}

export interface AnalysisOptions {
  readonly conditions?: PrimerConditions;
  readonly template?: { readonly seq: string; readonly topology: Topology };
  /** Mismatches allowed for the specificity scan. Default 3. */
  readonly maxMismatches?: number;
}

/** Everything about one primer the user typed: Tm by several methods, GC, 3' stability, structures, specificity. */
export function analyzePrimer(seq: string, options: AnalysisOptions = {}): PrimerAnalysis {
  const conditions = options.conditions ?? PRIMER3_CONDITIONS;
  const fold = hairpin(seq, conditions);
  const self = dimer(seq, seq, conditions);
  const base = {
    length: seq.length,
    gcPercent: gcPercent(seq),
    tm: tmNearestNeighbor(seq, conditions),
    tmBasic: { wallace: tmWallace(seq), gc: tmGC(seq, conditions.naMm), biopythonNN: tmBiopythonNN(seq) },
    endStability: endStability(seq),
    hairpin: { ...fold, problem: fold.dg <= HAIRPIN_DG_LIMIT },
    selfDimer: { ...self, problem: self.dg <= DIMER_DG_LIMIT },
  };
  if (!options.template) return base;
  const bindingSites = findBindingSites(
    { id: 'query', name: 'query', seq },
    options.template.seq,
    options.template.topology,
    {
      maxMismatches: options.maxMismatches ?? 3,
    },
  );
  return { ...base, bindingSites };
}

/** Cross-dimer between the two primers of a pair, and their Tm difference. */
export function analyzePair(
  forward: string,
  reverse: string,
  conditions: PrimerConditions = PRIMER3_CONDITIONS,
) {
  const cross = dimer(forward, reverse, conditions);
  return {
    crossDimer: { ...cross, problem: cross.dg <= DIMER_DG_LIMIT },
    deltaTm: Math.abs(tmNearestNeighbor(forward, conditions) - tmNearestNeighbor(reverse, conditions)),
  };
}

// ---------------------------------------------------------------------------
// Automatic design
// ---------------------------------------------------------------------------

export interface DesignConstraints {
  readonly tm: { readonly min: number; readonly opt: number; readonly max: number };
  readonly length: { readonly min: number; readonly opt: number; readonly max: number };
  readonly gc: { readonly min: number; readonly max: number };
  /** Lowest deltaG (kcal/mol) a primer's hairpin or self-dimer, or the pair's cross-dimer, may reach. */
  readonly minStructureDg: number;
  readonly maxDeltaTm: number;
  readonly productSize: { readonly min: number; readonly max: number };
  readonly conditions: PrimerConditions;
  /** Pairs to return. */
  readonly count: number;
}

export const DEFAULT_DESIGN: DesignConstraints = {
  tm: { min: 57, opt: 60, max: 63 },
  length: { min: 18, opt: 20, max: 25 },
  gc: { min: 40, max: 60 },
  minStructureDg: DIMER_DG_LIMIT,
  maxDeltaTm: 3,
  productSize: { min: 100, max: 1000 },
  conditions: PRIMER3_CONDITIONS,
  count: 5,
};

export interface DesignedPrimer {
  /** 5'→3'. */
  readonly seq: string;
  readonly strand: Strand;
  /** Template span the primer covers. */
  readonly span: Span;
  readonly tm: number;
  readonly gcPercent: number;
  readonly endStability: number;
  readonly hairpinDg: number;
  readonly selfDimerDg: number;
  readonly penalty: number;
}

export interface PrimerPair {
  readonly forward: DesignedPrimer;
  readonly reverse: DesignedPrimer;
  readonly productSize: number;
  readonly deltaTm: number;
  readonly crossDimerDg: number;
  readonly penalty: number;
}

/**
 * Penalty of one primer, the primer3 default weighting: 1 per °C away from the optimum Tm and 1 per base away
 * from the optimum length, plus 0.1 per kcal/mol of hairpin or self-dimer deltaG below 0.
 */
function primerPenalty(
  tm: number,
  length: number,
  hairpinDg: number,
  selfDimerDg: number,
  c: DesignConstraints,
) {
  return Math.abs(tm - c.tm.opt) + Math.abs(length - c.length.opt) + 0.1 * (-hairpinDg - selfDimerDg);
}

/** Pair penalty: both primer penalties, plus the Tm difference, plus 0.1 per kcal/mol of cross-dimer deltaG. */
function pairPenalty(forward: DesignedPrimer, reverse: DesignedPrimer, deltaTm: number, crossDg: number) {
  return forward.penalty + reverse.penalty + deltaTm - 0.1 * crossDg;
}

/** How many single primers per side survive into pairing. */
const CANDIDATES_PER_SIDE = 60;

/** Primers whose template span lies inside `[from, to)` and that pass the Tm, GC and structure limits. */
function candidates(
  template: string,
  strand: Strand,
  from: number,
  to: number,
  c: DesignConstraints,
): DesignedPrimer[] {
  const found: DesignedPrimer[] = [];
  for (let start = Math.max(0, from); start < Math.min(to, template.length); start++) {
    for (let length = c.length.min; length <= c.length.max; length++) {
      const end = start + length;
      if (end > to) continue;
      const region = template.slice(start, end).toUpperCase();
      if (/[^ACGT]/.test(region)) continue;
      const seq = strand === 1 ? region : reverseComplement(region);
      const gc = gcPercent(seq);
      if (gc < c.gc.min || gc > c.gc.max) continue;
      const tm = tmNearestNeighbor(seq, c.conditions);
      if (tm < c.tm.min || tm > c.tm.max) continue;
      found.push({
        seq,
        strand,
        span: { start, end },
        tm,
        gcPercent: gc,
        endStability: endStability(seq),
        hairpinDg: 0,
        selfDimerDg: 0,
        penalty: primerPenalty(tm, length, 0, 0, c),
      });
    }
  }
  // Fold only the best candidates by Tm and length; structure checks are the expensive part.
  found.sort((x, y) => x.penalty - y.penalty);
  const checked: DesignedPrimer[] = [];
  for (const primer of found) {
    if (checked.length >= CANDIDATES_PER_SIDE) break;
    const hairpinDg = hairpin(primer.seq, c.conditions).dg;
    const selfDimerDg = dimer(primer.seq, primer.seq, c.conditions).dg;
    if (hairpinDg < c.minStructureDg || selfDimerDg < c.minStructureDg) continue;
    const length = primer.span.end - primer.span.start;
    checked.push({
      ...primer,
      hairpinDg,
      selfDimerDg,
      penalty: primerPenalty(primer.tm, length, hairpinDg, selfDimerDg, c),
    });
  }
  return checked;
}

/**
 * Design primer pairs that amplify `target` from a linear template, ranked by penalty (lowest first).
 *
 * The forward primer ends before the target and the reverse primer starts after it, so every product covers the
 * target. Each returned pair meets every constraint: Tm, length and GC ranges per primer, hairpin and self-dimer
 * deltaG, cross-dimer deltaG, Tm difference and product size.
 */
export function designPrimers(
  template: string,
  target: Span,
  constraints: Partial<DesignConstraints> = {},
): PrimerPair[] {
  const c: DesignConstraints = { ...DEFAULT_DESIGN, ...constraints };
  const windowStart = Math.max(0, target.end - c.productSize.max);
  const windowEnd = Math.min(template.length, target.start + c.productSize.max);
  const forwards = candidates(template, 1, windowStart, target.start, c);
  const reverses = candidates(template, -1, target.end, windowEnd, c);
  const result: PrimerPair[] = [];
  for (const forward of forwards) {
    for (const reverse of reverses) {
      const productSize = reverse.span.end - forward.span.start;
      if (productSize < c.productSize.min || productSize > c.productSize.max) continue;
      const deltaTm = Math.abs(forward.tm - reverse.tm);
      if (deltaTm > c.maxDeltaTm) continue;
      const crossDimerDg = dimer(forward.seq, reverse.seq, c.conditions).dg;
      if (crossDimerDg < c.minStructureDg) continue;
      result.push({
        forward,
        reverse,
        productSize,
        deltaTm,
        crossDimerDg,
        penalty: pairPenalty(forward, reverse, deltaTm, crossDimerDg),
      });
    }
  }
  return result.sort((x, y) => x.penalty - y.penalty).slice(0, c.count);
}
