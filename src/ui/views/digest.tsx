import type { SeqDocument } from '../../state/documents';
import { PlaceholderPanel } from './placeholder';

/** The digest view. */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  return <PlaceholderPanel doc={doc} />;
}
