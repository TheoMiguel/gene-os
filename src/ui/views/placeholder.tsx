import { ANALYSIS_TABS, type AnalysisTab, type SeqDocument } from '../../state/documents';
import { t } from '../i18n';

const tabNumber = (tab: AnalysisTab) => String(ANALYSIS_TABS.indexOf(tab) + 1).padStart(2, '0');

/** Stands in for a view that a later phase fills in. */
export function PlaceholderPanel({ doc }: { readonly doc: SeqDocument }) {
  return (
    <div class="bracket-box placeholder-card">
      <div class="bracket-inner" />
      <div class="stage-label">{tabNumber(doc.activeTab)}</div>
      <h2 class="stage-title">{t(`tab.${doc.activeTab}`)}</h2>
      <p class="placeholder-text">{t('doc.placeholder')}</p>
    </div>
  );
}
