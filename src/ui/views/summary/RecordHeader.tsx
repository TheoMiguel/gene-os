import type { SeqRecord } from '../../../engine/types';
import { copyText } from '../../export/clipboard';
import { reportCopy } from '../../export/feedback';
import { t } from '../../i18n';
import { type KpiCardData, kpiText } from './Kpis';

/** The record's own description, accession and source organism as the file gives them, with a button that copies the KPI cards. */
export function RecordHeader({
  record,
  cards,
}: {
  readonly record: SeqRecord;
  readonly cards: readonly KpiCardData[];
}) {
  const { description, metadata } = record;
  const copy = async () => reportCopy(await copyText(kpiText(cards)));
  return (
    <header class="summary-record">
      <div class="summary-record-text">
        <p class="summary-description">
          {description.trim() === '' ? t('summary.record.noDescription') : description}
        </p>
        {(metadata.accession || metadata.organism) && (
          <p class="summary-meta">
            {metadata.accession && (
              <span>
                <span class="field-label">{t('summary.record.accession')}</span> {metadata.accession}
              </span>
            )}
            {metadata.organism && (
              <span>
                <span class="field-label">{t('summary.record.organism')}</span> {metadata.organism}
              </span>
            )}
          </p>
        )}
      </div>
      <button type="button" class="export-button" onClick={() => void copy()}>
        {t('summary.copy')}
      </button>
    </header>
  );
}
