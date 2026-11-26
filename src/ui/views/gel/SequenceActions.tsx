import type { SeqRecord } from '../../../engine/types';
import { copyText, downloadSequence, reportCopy, reportSave } from '../../export';
import { t } from '../../i18n';

/** Copy the sequence of a fragment or PCR product, or save it as a FASTA or GenBank file. */
export function SequenceActions({ record }: { readonly record: SeqRecord }) {
  return (
    <span class="export-buttons">
      <button
        type="button"
        class="export-button"
        onClick={async () => reportCopy(await copyText(record.seq))}
      >
        {t('seqActions.copy')}
      </button>
      <button
        type="button"
        class="export-button"
        onClick={async () => reportSave(await downloadSequence(record, 'fasta'))}
      >
        {t('seqActions.fasta')}
      </button>
      <button
        type="button"
        class="export-button"
        onClick={async () => reportSave(await downloadSequence(record, 'genbank'))}
      >
        {t('seqActions.genbank')}
      </button>
    </span>
  );
}
