import type { ComponentType } from 'preact';
import { ANALYSIS_TABS, type AnalysisTab, type SeqDocument, workspace } from '../state/documents';
import { sfx } from './actions';
import { docTabId, WORKSPACE_PANEL_ID } from './Header';
import { t } from './i18n';
import { eventTabIndex, nextTabIndex } from './tablist';
import { PANELS, type PanelProps } from './views';

const tabNumber = (tab: AnalysisTab) => String(ANALYSIS_TABS.indexOf(tab) + 1).padStart(2, '0');
const subTabId = (docId: string, tab: AnalysisTab) => `${docId}-tab-${tab}`;
const subPanelId = (docId: string) => `${docId}-panel`;

/** One open sequence: its title line, the numbered analysis tabs and the active tab's panel. */
export function DocumentView({ doc }: PanelProps) {
  const { record } = doc;
  const Panel = PANELS[doc.activeTab];

  const select = (tab: AnalysisTab) => {
    if (tab !== doc.activeTab) sfx('tab');
    workspace.setActiveTab(doc.id, tab);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const tab = ANALYSIS_TABS[nextTabIndex(event.key, eventTabIndex(event), ANALYSIS_TABS.length) ?? -1];
    if (!tab) return;
    event.preventDefault();
    select(tab);
    document.getElementById(subTabId(doc.id, tab))?.focus();
  };

  return (
    <div class="doc-view" role="tabpanel" id={WORKSPACE_PANEL_ID} aria-labelledby={docTabId(doc.id)}>
      <div class="doc-head">
        <h1 class="doc-title">{record.name}</h1>
        <span class="doc-meta">
          {t('doc.length', { length: record.seq.length.toLocaleString() })} ·{' '}
          {t(`topology.${record.topology}`)} · {t(`alphabet.${record.alphabet}`)}
        </span>
      </div>
      <div class="workspace-tabs" role="tablist" aria-label={t('doc.tabsLabel')} onKeyDown={onKeyDown}>
        {ANALYSIS_TABS.map((tab, index) => {
          const selected = tab === doc.activeTab;
          const classes = ['tab', tab === 'libraries' && 'tab-lib', selected && 'active'].filter(Boolean);
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={subTabId(doc.id, tab)}
              data-index={index}
              class={classes.join(' ')}
              aria-selected={selected}
              aria-controls={selected ? subPanelId(doc.id) : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab)}
            >
              {`${tabNumber(tab)} // ${t(`tab.${tab}`)}`}
            </button>
          );
        })}
      </div>
      <div
        class="tab-panel"
        role="tabpanel"
        id={subPanelId(doc.id)}
        aria-labelledby={subTabId(doc.id, doc.activeTab)}
      >
        <Panel doc={doc} />
      </div>
    </div>
  );
}
