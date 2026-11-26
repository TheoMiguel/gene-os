import { effect, type Signal, signal } from '@preact/signals';
import type { AlignMode, MultipleAlignment, PairwiseAlignment } from '../../../engine/align';
import { workspace } from '../../../state/documents';
import type { AlignJob, AlignOutcome } from './execute';
import {
  type AlignItem,
  type AlignmentDisplay,
  type AlignSetup,
  DEFAULT_SETUP,
  msaDisplay,
  pairDisplay,
} from './model';
import { startAlignment } from './run';

/** What one document's alignment panel is doing. */
export type RunState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly startedAt: number; readonly count: number }
  | { readonly status: 'failed'; readonly message: string }
  | {
      readonly status: 'too-large';
      readonly kind: 'pair' | 'msa';
      readonly cells: number;
      readonly limit: number;
      readonly mode: AlignMode;
    }
  | {
      readonly status: 'done';
      /** Changes with every finished run, so the display starts afresh. */
      readonly id: number;
      /** The form as it was when the run started. */
      readonly setup: AlignSetup;
      readonly kind: 'pair';
      readonly alignment: PairwiseAlignment;
      readonly display: AlignmentDisplay;
      readonly elapsedMs: number;
    }
  | {
      readonly status: 'done';
      readonly id: number;
      readonly setup: AlignSetup;
      readonly kind: 'msa';
      readonly alignment: MultipleAlignment;
      readonly display: AlignmentDisplay;
      readonly elapsedMs: number;
    };

interface PanelState {
  readonly setup: Signal<AlignSetup>;
  readonly run: Signal<RunState>;
  cancel: (() => void) | null;
}

const panels = new Map<string, PanelState>();
let finishedRuns = 0;

effect(() => {
  const open = new Set(workspace.documents.value.map((doc) => doc.id));
  for (const [id, panel] of panels) {
    if (open.has(id)) continue;
    panel.cancel?.();
    panels.delete(id);
  }
});

/** The setup and the run state of a document's alignment panel. The same objects every call, so a tab switch keeps them. */
export function alignPanelOf(docId: string): Pick<PanelState, 'setup' | 'run'> {
  let panel = panels.get(docId);
  if (!panel) {
    panel = {
      setup: signal({ ...DEFAULT_SETUP, picked: [docId] }),
      run: signal({ status: 'idle' }),
      cancel: null,
    };
    panels.set(docId, panel);
  }
  return panel;
}

/** Starts the job for `items`, replacing any run in progress. */
export function runAlignment(docId: string, job: AlignJob, items: readonly AlignItem[]): void {
  const panel = panels.get(docId);
  if (!panel) return;
  panel.cancel?.();
  const setup = panel.setup.value;
  const startedAt = performance.now();
  const labels = items.map((item) => item.label);
  panel.run.value = { status: 'running', startedAt, count: items.length };
  panel.cancel = startAlignment(job, (outcome) => {
    panel.cancel = null;
    panel.run.value = settle(outcome, labels, performance.now() - startedAt, setup);
  });
}

/** Stops the run in progress and returns the panel to idle. */
export function cancelAlignment(docId: string): void {
  const panel = panels.get(docId);
  if (!panel) return;
  panel.cancel?.();
  panel.cancel = null;
  panel.run.value = { status: 'idle' };
}

function settle(
  outcome: AlignOutcome,
  labels: readonly string[],
  elapsedMs: number,
  setup: AlignSetup,
): RunState {
  if (outcome.kind === 'error') return { status: 'failed', message: outcome.message };
  if (outcome.kind === 'pair') {
    const { result } = outcome;
    if (result.status === 'too-large') {
      return {
        status: 'too-large',
        kind: 'pair',
        cells: result.cells,
        limit: result.limit,
        mode: result.mode,
      };
    }
    return {
      status: 'done',
      id: ++finishedRuns,
      setup,
      kind: 'pair',
      alignment: result.alignment,
      display: pairDisplay(result.alignment, labels),
      elapsedMs,
    };
  }
  const { result } = outcome;
  if (result.status === 'too-large') {
    return { status: 'too-large', kind: 'msa', cells: result.cells, limit: result.limit, mode: 'global' };
  }
  return {
    status: 'done',
    id: ++finishedRuns,
    setup,
    kind: 'msa',
    alignment: result.alignment,
    display: msaDisplay(result.alignment, labels),
    elapsedMs,
  };
}
