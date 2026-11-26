import type { SeqDocument } from '../../state/documents';
import { OrfsView } from './proteins/OrfsView';
import { ProteinRecordView } from './proteins/ProteinRecordView';
import './proteins/proteins.css';

/** The proteins view: ORF search and protein inspector for DNA, the whole chain for a protein record. */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  return doc.record.alphabet === 'protein' ? <ProteinRecordView doc={doc} /> : <OrfsView doc={doc} />;
}
