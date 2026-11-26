import { baseMask } from '../../../engine/alphabet';
import {
  DIMER_DG_LIMIT,
  type DimerStructure,
  type HairpinStructure,
  type PrimerAnalysis,
} from '../../../engine/primers';

export type Severity = 'good' | 'warn' | 'bad';

/** Everything a finding can say about a primer or a pair; each id has a message and a fix in the dictionaries. */
export type FindingId =
  | 'short'
  | 'long'
  | 'tmLow'
  | 'tmHigh'
  | 'gcLow'
  | 'gcHigh'
  | 'stickyEnd'
  | 'run'
  | 'repeat'
  | 'degenerate'
  | 'hairpin'
  | 'selfDimer'
  | 'crossDimer'
  | 'deltaTm';

export interface Finding {
  readonly id: FindingId;
  readonly severity: Exclude<Severity, 'good'>;
  readonly params: Readonly<Record<string, string | number>>;
  /** The offending structure drawn as text, when there is one. */
  readonly drawing?: readonly string[];
}

export type Verdict = 'good' | 'caution' | 'redesign';

/** A hairpin or dimer this stable (kcal/mol) is a failure, not only a caution. */
const HAIRPIN_BAD_DG = -6;
const DIMER_BAD_DG = -9;
const MAX_END_STABILITY = 9;

/** Characters of a primer the user typed, upper-case, with spaces and line breaks removed. */
export function cleanPrimer(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** The characters of a primer that are not IUPAC nucleotide letters. Empty when the primer can be analyzed. */
export function invalidCharacters(seq: string): string[] {
  return [...new Set([...seq].filter((c) => baseMask(c) === 0))];
}

const gcOf = (seq: string) => [...seq].filter((c) => c === 'G' || c === 'C').length;

/** The longest run of one repeated base, and the longest run of one repeated dinucleotide in repeats. */
function repeats(seq: string): { run: number; dinucleotide: number } {
  let run = 0;
  let current = 0;
  for (let i = 0; i < seq.length; i++) {
    current = i > 0 && seq[i] === seq[i - 1] ? current + 1 : 1;
    run = Math.max(run, current);
  }
  let dinucleotide = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    if (seq[i] === seq[i + 1]) continue;
    let count = 1;
    while (seq.startsWith(seq.slice(i, i + 2), i + count * 2)) count++;
    dinucleotide = Math.max(dinucleotide, count);
  }
  return { run, dinucleotide };
}

/** Text drawing of a dimer: first oligo 5'→3', the pairs, second oligo 3'→5'. */
export function dimerDrawing(structure: DimerStructure): string[] {
  const [top, marks, bottom] = structure.alignment;
  return [`5' ${top} 3'`, `   ${marks}`, `3' ${bottom} 5'`];
}

/** Text drawing of a hairpin: the sequence with its dot-bracket fold under it, parentheses for paired bases. */
export function hairpinDrawing(seq: string, structure: HairpinStructure): string[] {
  return [`5' ${seq} 3'`, `   ${structure.dotBracket}`];
}

/** A dimer's 3' end pairs when either oligo's last base is paired, which lets the polymerase extend it. */
function threePrimePairs(structure: DimerStructure, firstLength: number, secondLength: number): boolean {
  return structure.pairs.some(([a, b]) => a === firstLength - 1 || b === secondLength - 1);
}

/** Problems of one primer (length, Tm, GC, 3' end, repeats, hairpin, self-dimer), most serious first. */
export function checkPrimer(seq: string, analysis: PrimerAnalysis): Finding[] {
  const found: Finding[] = [];
  const add = (
    id: FindingId,
    severity: Finding['severity'],
    params: Finding['params'] = {},
    drawing?: string[],
  ) => found.push({ id, severity, params, ...(drawing ? { drawing } : {}) });
  const tm = analysis.tm.toFixed(1);
  const gc = analysis.gcPercent.toFixed(0);

  if (analysis.hairpin.problem)
    add(
      'hairpin',
      analysis.hairpin.dg <= HAIRPIN_BAD_DG ? 'bad' : 'warn',
      { dg: analysis.hairpin.dg.toFixed(1), pairs: analysis.hairpin.pairs.length },
      hairpinDrawing(seq, analysis.hairpin),
    );
  if (analysis.selfDimer.problem) {
    const threePrime = threePrimePairs(analysis.selfDimer, seq.length, seq.length);
    add(
      'selfDimer',
      analysis.selfDimer.dg <= DIMER_BAD_DG || threePrime ? 'bad' : 'warn',
      { dg: analysis.selfDimer.dg.toFixed(1), end: threePrime ? 'yes' : 'no' },
      dimerDrawing(analysis.selfDimer),
    );
  }
  if (analysis.length < 18) add('short', 'warn', { length: analysis.length });
  if (analysis.length > 30) add('long', 'warn', { length: analysis.length });
  if (analysis.tm < 55) add('tmLow', 'warn', { tm });
  if (analysis.tm > 65) add('tmHigh', 'warn', { tm });
  if (analysis.gcPercent < 40) add('gcLow', 'warn', { gc });
  if (analysis.gcPercent > 60) add('gcHigh', 'warn', { gc });
  if (gcOf(seq.slice(-5)) >= 4 || analysis.endStability > MAX_END_STABILITY)
    add('stickyEnd', 'warn', { stability: analysis.endStability.toFixed(1) });
  const { run, dinucleotide } = repeats(seq);
  if (run >= 4) add('run', 'warn', { run });
  if (dinucleotide >= 4) add('repeat', 'warn', { repeats: dinucleotide });
  if (invalidCharacters(seq).length === 0 && [...seq].some((c) => !'ACGT'.includes(c)))
    add('degenerate', 'warn');
  return found.sort((a, b) => Number(b.severity === 'bad') - Number(a.severity === 'bad'));
}

/** Problems that belong to the pair: the cross-dimer and a melting-temperature gap. */
export function checkPair(
  forward: string,
  reverse: string,
  pair: { readonly crossDimer: DimerStructure & { readonly problem: boolean }; readonly deltaTm: number },
): Finding[] {
  const found: Finding[] = [];
  if (pair.crossDimer.dg <= DIMER_DG_LIMIT) {
    const threePrime = threePrimePairs(pair.crossDimer, forward.length, reverse.length);
    found.push({
      id: 'crossDimer',
      severity: pair.crossDimer.dg <= DIMER_BAD_DG || threePrime ? 'bad' : 'warn',
      params: { dg: pair.crossDimer.dg.toFixed(1), end: threePrime ? 'yes' : 'no' },
      drawing: dimerDrawing(pair.crossDimer),
    });
  }
  if (pair.deltaTm > 3)
    found.push({
      id: 'deltaTm',
      severity: pair.deltaTm > 5 ? 'bad' : 'warn',
      params: { delta: pair.deltaTm.toFixed(1) },
    });
  return found;
}

/** One verdict for a set of findings: redesign when any is bad, caution when any warns, else good. */
export function verdictOf(findings: readonly Finding[]): Verdict {
  if (findings.some((f) => f.severity === 'bad')) return 'redesign';
  return findings.length > 0 ? 'caution' : 'good';
}
