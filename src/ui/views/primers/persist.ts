import { batch } from '@preact/signals';
import type { DesignedPrimer, PrimerPair } from '../../../engine/primers';
import { PRIMER3_CONDITIONS } from '../../../engine/primers';
import type { PrimerConditions, Span } from '../../../engine/types';
import { registerProjectSection } from '../../../project/sections';
import {
  type ConstraintInputs,
  DEFAULT_INPUTS,
  type DesignState,
  primersStateOf,
  toConstraints,
} from './state';

/** What the project file and the stored session keep of one document's Primers view. */
interface PrimersSnapshot {
  readonly forward: string;
  readonly reverse: string;
  readonly forwardName: string;
  readonly reverseName: string;
  readonly conditions: PrimerConditions;
  readonly mismatches: number;
  readonly regionStart: string;
  readonly regionEnd: string;
  readonly inputs: ConstraintInputs;
  /** The designed pairs with the region and settings they were designed for, or null when none were designed. */
  readonly design: {
    readonly pairs: readonly PrimerPair[];
    readonly target: Span;
    readonly inputs: ConstraintInputs;
    readonly conditions: PrimerConditions;
  } | null;
  readonly pair: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

/** The numbers of `raw` that are numbers, over the defaults. Anything else in `raw` is dropped. */
function numbersOver<T extends object>(defaults: T, raw: unknown): T {
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  if (isRecord(raw)) for (const key of Object.keys(defaults)) if (isNumber(raw[key])) out[key] = raw[key];
  return out as T;
}

function readSpan(raw: unknown): Span | null {
  return isRecord(raw) && isNumber(raw.start) && isNumber(raw.end) && raw.start >= 0 && raw.end > raw.start
    ? { start: raw.start, end: raw.end }
    : null;
}

function readDesigned(raw: unknown): DesignedPrimer | null {
  if (!isRecord(raw) || typeof raw.seq !== 'string' || (raw.strand !== 1 && raw.strand !== -1)) return null;
  const span = readSpan(raw.span);
  const numbers = ['tm', 'gcPercent', 'endStability', 'hairpinDg', 'selfDimerDg', 'penalty'] as const;
  if (!span || !numbers.every((key) => isNumber(raw[key]))) return null;
  return { ...(raw as unknown as DesignedPrimer), span };
}

function readPair(raw: unknown): PrimerPair | null {
  if (!isRecord(raw)) return null;
  const forward = readDesigned(raw.forward);
  const reverse = readDesigned(raw.reverse);
  const numbers = ['productSize', 'deltaTm', 'crossDimerDg', 'penalty'] as const;
  if (!forward || !reverse || !numbers.every((key) => isNumber(raw[key]))) return null;
  return { ...(raw as unknown as PrimerPair), forward, reverse };
}

function readDesign(raw: unknown): PrimersSnapshot['design'] {
  if (!isRecord(raw) || !Array.isArray(raw.pairs)) return null;
  const pairs = raw.pairs.map(readPair).filter((pair): pair is PrimerPair => pair !== null);
  const target = readSpan(raw.target);
  if (pairs.length === 0 || !target) return null;
  return {
    pairs,
    target,
    inputs: numbersOver(DEFAULT_INPUTS, raw.inputs),
    conditions: numbersOver(PRIMER3_CONDITIONS, raw.conditions),
  };
}

/**
 * Reads a stored Primers value. A damaged value gives the defaults for what it lost: it never throws and never
 * puts a malformed pair on screen.
 */
function parseSnapshot(raw: unknown): PrimersSnapshot | null {
  if (!isRecord(raw)) return null;
  const design = readDesign(raw.design);
  const pair =
    isNumber(raw.pair) && design && raw.pair >= 0 && raw.pair < design.pairs.length ? raw.pair : null;
  return {
    forward: text(raw.forward, ''),
    reverse: text(raw.reverse, ''),
    forwardName: text(raw.forwardName, 'Forward'),
    reverseName: text(raw.reverseName, 'Reverse'),
    conditions: numbersOver(PRIMER3_CONDITIONS, raw.conditions),
    mismatches: isNumber(raw.mismatches) ? raw.mismatches : 2,
    regionStart: text(raw.regionStart, ''),
    regionEnd: text(raw.regionEnd, ''),
    inputs: numbersOver(DEFAULT_INPUTS, raw.inputs),
    design,
    pair,
  };
}

/** The pairs of a finished design, with what they were designed for. A design in progress or failed is not kept. */
function snapshotDesign(
  design: DesignState,
  inputs: ConstraintInputs,
  conditions: PrimerConditions,
): PrimersSnapshot['design'] {
  return design.status === 'done' ? { pairs: design.pairs, target: design.target, inputs, conditions } : null;
}

const DEFAULTS = JSON.stringify(parseSnapshot({}));

/**
 * The Primers view's per-document state in the project file and the stored session: the typed primers, the
 * conditions, the design settings and the designed pairs. A document whose view the user never touched stores nothing.
 */
registerProjectSection({
  key: 'primers',
  read(docId) {
    const state = primersStateOf.find(docId);
    if (!state) return undefined;
    const conditions = state.conditions.value;
    const inputs = state.inputs.value;
    const snapshot: PrimersSnapshot = {
      forward: state.forward.value,
      reverse: state.reverse.value,
      forwardName: state.forwardName.value,
      reverseName: state.reverseName.value,
      conditions,
      mismatches: state.mismatches.value,
      regionStart: state.regionStart.value,
      regionEnd: state.regionEnd.value,
      inputs,
      design: snapshotDesign(state.design.value, inputs, conditions),
      pair: state.pair.value,
    };
    return JSON.stringify(snapshot) === DEFAULTS ? undefined : snapshot;
  },
  write(docId, value) {
    const snapshot = parseSnapshot(value);
    if (!snapshot) return;
    const state = primersStateOf(docId);
    batch(() => {
      state.forward.value = snapshot.forward;
      state.reverse.value = snapshot.reverse;
      state.forwardName.value = snapshot.forwardName;
      state.reverseName.value = snapshot.reverseName;
      state.conditions.value = snapshot.conditions;
      state.mismatches.value = snapshot.mismatches;
      state.regionStart.value = snapshot.regionStart;
      state.regionEnd.value = snapshot.regionEnd;
      state.inputs.value = snapshot.inputs;
      state.design.value = snapshot.design
        ? {
            status: 'done',
            pairs: snapshot.design.pairs,
            target: snapshot.design.target,
            constraints: toConstraints(snapshot.design.inputs, snapshot.design.conditions),
          }
        : { status: 'idle' };
      state.pair.value = snapshot.pair;
    });
  },
});
