import type { SeqDocument } from '../../state/documents';
import { NucleotideSummary } from './summary/NucleotideSummary';
import { ProteinSummary } from './summary/ProteinSummary';
import './summary/summary.css';

/**
 * The summary view, the first thing a user sees after loading a sequence: an organism inference beside the key
 * numbers, the composition, GC content and skew along the sequence, and the known elements found in it. It is keyed
 * by document, so switching tabs never shows one sequence's curves under another's name.
 */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  return doc.record.alphabet === 'protein' ? (
    <ProteinSummary key={doc.id} doc={doc} />
  ) : (
    <NucleotideSummary key={doc.id} doc={doc} />
  );
}
