import { useEffect, useState } from 'preact/hooks';
import { findBindingSites, simulatePcr } from '../../../engine/pcr';
import type { Amplicon, Primer, PrimerBinding, Topology } from '../../../engine/types';

/** Longest sequence scanned on every edit. Above this the user starts the scan, because one scan costs about 40 ms per Mb per primer. */
export const AUTO_SCAN_LIMIT = 2_000_000;

const DEBOUNCE_MS = 350;

export type ScanState =
  | { readonly status: 'idle' }
  | { readonly status: 'skipped' }
  | { readonly status: 'pending' }
  | {
      readonly status: 'ready';
      readonly bindings: readonly PrimerBinding[];
      readonly amplicons: readonly Amplicon[];
    };

/** Every binding site of the primers on the sequence and every PCR product, found after the user stops typing. */
export function computeScan(
  primers: readonly Primer[],
  seq: string,
  topology: Topology,
  maxMismatches: number,
): { bindings: PrimerBinding[]; amplicons: Amplicon[] } {
  return {
    bindings: primers.flatMap((primer) => findBindingSites(primer, seq, topology, { maxMismatches })),
    amplicons: simulatePcr(primers, seq, topology, { maxMismatches }),
  };
}

/**
 * Runs the specificity scan and the virtual PCR for the primers a short moment after they last changed, so typing
 * stays smooth. A sequence over `AUTO_SCAN_LIMIT` bases waits until `allowLarge` is true.
 */
export function usePrimerScan(
  primers: readonly Primer[],
  seq: string,
  topology: Topology,
  maxMismatches: number,
  allowLarge: boolean,
): ScanState {
  const [state, setState] = useState<ScanState>({ status: 'idle' });
  const key = primers.map((p) => `${p.id}:${p.seq}`).join('|');

  useEffect(() => {
    if (primers.length === 0 || seq.length === 0) {
      setState({ status: 'idle' });
      return;
    }
    if (seq.length > AUTO_SCAN_LIMIT && !allowLarge) {
      setState({ status: 'skipped' });
      return;
    }
    setState({ status: 'pending' });
    const timer = setTimeout(() => {
      setState({ status: 'ready', ...computeScan(primers, seq, topology, maxMismatches) });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, seq, topology, maxMismatches, allowLarge]);

  return state;
}
