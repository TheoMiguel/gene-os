import { signal } from '@preact/signals';
import {
  DEFAULT_DESIGN,
  type DesignConstraints,
  PRIMER3_CONDITIONS,
  type PrimerPair,
} from '../../../engine/primers';
import type { PrimerConditions, Span } from '../../../engine/types';
import { perDocument } from '../gel/documentState';
import { createGelSettingsStore } from '../gel/GelPanel';

/** The design constraints as the user edits them, one number per control. */
export interface ConstraintInputs {
  readonly tmMin: number;
  readonly tmOpt: number;
  readonly tmMax: number;
  readonly lengthMin: number;
  readonly lengthOpt: number;
  readonly lengthMax: number;
  readonly gcMin: number;
  readonly gcMax: number;
  readonly maxDeltaTm: number;
  /** Strongest hairpin or dimer deltaG, kcal/mol, a primer may have. */
  readonly minStructureDg: number;
  readonly productMin: number;
  readonly productMax: number;
}

export const DEFAULT_INPUTS: ConstraintInputs = {
  tmMin: DEFAULT_DESIGN.tm.min,
  tmOpt: DEFAULT_DESIGN.tm.opt,
  tmMax: DEFAULT_DESIGN.tm.max,
  lengthMin: DEFAULT_DESIGN.length.min,
  lengthOpt: DEFAULT_DESIGN.length.opt,
  lengthMax: DEFAULT_DESIGN.length.max,
  gcMin: DEFAULT_DESIGN.gc.min,
  gcMax: DEFAULT_DESIGN.gc.max,
  maxDeltaTm: DEFAULT_DESIGN.maxDeltaTm,
  minStructureDg: DEFAULT_DESIGN.minStructureDg,
  productMin: DEFAULT_DESIGN.productSize.min,
  productMax: DEFAULT_DESIGN.productSize.max,
};

/** The engine's constraints for the inputs. The optimum is kept inside the range the user typed. */
export function toConstraints(
  inputs: ConstraintInputs,
  conditions: PrimerConditions,
): Partial<DesignConstraints> {
  const within = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  return {
    tm: { min: inputs.tmMin, opt: within(inputs.tmOpt, inputs.tmMin, inputs.tmMax), max: inputs.tmMax },
    length: {
      min: inputs.lengthMin,
      opt: within(inputs.lengthOpt, inputs.lengthMin, inputs.lengthMax),
      max: inputs.lengthMax,
    },
    gc: { min: inputs.gcMin, max: inputs.gcMax },
    maxDeltaTm: inputs.maxDeltaTm,
    minStructureDg: inputs.minStructureDg,
    productSize: { min: inputs.productMin, max: inputs.productMax },
    conditions,
  };
}

export type DesignState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' }
  | {
      readonly status: 'done';
      readonly pairs: readonly PrimerPair[];
      readonly constraints: Partial<DesignConstraints>;
      readonly target: Span;
    }
  | { readonly status: 'failed'; readonly reason: string };

/** What the Primers view remembers per document while the user visits other tabs. */
export const primersStateOf = perDocument(() => ({
  forward: signal(''),
  reverse: signal(''),
  forwardName: signal('Forward'),
  reverseName: signal('Reverse'),
  conditions: signal<PrimerConditions>(PRIMER3_CONDITIONS),
  /** Mismatches allowed when looking for binding sites. */
  mismatches: signal(2),
  /** The user agreed to scan a sequence that is too long to scan on every keystroke. */
  scanLarge: signal(false),
  regionStart: signal(''),
  regionEnd: signal(''),
  inputs: signal<ConstraintInputs>(DEFAULT_INPUTS),
  design: signal<DesignState>({ status: 'idle' }),
  pair: signal<number | null>(null),
  binding: signal<number | null>(null),
  product: signal<number | null>(null),
}));

export const primersGelOf = createGelSettingsStore();
