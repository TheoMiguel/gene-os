import { workspace } from '../state/documents';
import { sfx, showNewSequence } from './actions';
import { t } from './i18n';
import { Logo } from './Logo';
import { eventTabIndex, nextTabIndex } from './tablist';

/** DOM id of a document's header tab, which labels the workspace panel. */
export const docTabId = (docId: string) => `doctab-${docId}`;
export const WORKSPACE_PANEL_ID = 'workspace-panel';

function focusDocTab(docId: string) {
  document.getElementById(docTabId(docId))?.focus();
}

function SequenceTabs() {
  const docs = workspace.documents.value;
  const activeId = workspace.activeId.value;
  const focusable = docs.some((doc) => doc.id === activeId) ? activeId : docs[0]?.id;

  const select = (docId: string) => {
    if (docId !== activeId) sfx('tab');
    workspace.activate(docId);
  };

  const close = (docId: string) => {
    sfx('click');
    workspace.close(docId);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = eventTabIndex(event);
    const doc = docs[index];
    if (!doc) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      close(doc.id);
      const next = workspace.activeId.value;
      if (next) focusDocTab(next);
      return;
    }
    const target = docs[nextTabIndex(event.key, index, docs.length) ?? -1];
    if (!target) return;
    event.preventDefault();
    select(target.id);
    focusDocTab(target.id);
  };

  return (
    <div class="seq-tabs" role="tablist" aria-label={t('header.tabsLabel')} onKeyDown={onKeyDown}>
      {docs.map((doc, index) => {
        const selected = doc.id === activeId;
        const name = doc.record.name;
        return (
          <div key={doc.id} class={selected ? 'seq-tab active' : 'seq-tab'}>
            <button
              type="button"
              role="tab"
              id={docTabId(doc.id)}
              data-index={index}
              aria-selected={selected}
              aria-controls={selected ? WORKSPACE_PANEL_ID : undefined}
              tabIndex={doc.id === focusable ? 0 : -1}
              title={name}
              class="seq-tab-label"
              onClick={() => select(doc.id)}
            >
              {name}
            </button>
            <button
              type="button"
              class="seq-tab-close"
              tabIndex={-1}
              aria-label={t('header.closeTab', { name })}
              title={t('header.closeTab', { name })}
              onClick={() => close(doc.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.3 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.3-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
    </svg>
  );
}

/** The fixed top bar: logo, title, one tab per open sequence, "+" and the settings gear (spec 3.1). */
export function Header({
  settingsOpen,
  onToggleSettings,
}: {
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  const newViewActive = workspace.activeId.value === null;
  return (
    <header class="top-bar">
      <div class="brand-cluster">
        <Logo size={26} />
        <span class="brand-title-text">GENE_OS</span>
      </div>
      <div class="brand-divider" />
      <div class="tab-strip">
        <SequenceTabs />
        <button
          type="button"
          class={newViewActive ? 'new-tab-btn active' : 'new-tab-btn'}
          aria-label={t('header.newSequence')}
          title={`${t('header.newSequence')} (Ctrl+N)`}
          aria-current={newViewActive ? 'page' : undefined}
          onClick={showNewSequence}
        >
          +
        </button>
      </div>
      <button
        type="button"
        id="gear-button"
        class={settingsOpen ? 'gear-btn active' : 'gear-btn'}
        aria-label={t('header.settings')}
        title={t('header.settings')}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={onToggleSettings}
      >
        <GearIcon />
      </button>
    </header>
  );
}
