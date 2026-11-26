import { useEffect, useState } from 'preact/hooks';
import { workspace } from '../state/documents';
import { settings } from '../state/settings';
import {
  closeActiveDocument,
  loadInputs,
  notice,
  openFilesFromPicker,
  sfx,
  showNewSequence,
} from './actions';
import { unlockAudio } from './audio/sounds';
import { Background } from './backgrounds/Background';
import { DocumentView } from './DocumentView';
import { Header } from './Header';
import { t } from './i18n';
import { NewSequenceView } from './NewSequenceView';
import { SettingsPanel } from './SettingsPanel';
import { shortcuts } from './shortcuts';

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

/** True while files are dragged over the window; dropping them opens each one (spec 3.5). */
function useWindowFileDrop(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      void loadInputs(files.map((file) => ({ kind: 'file', file })));
    };
    window.addEventListener('dragenter', over);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', over);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return dragging;
}

function useAppShortcuts(): void {
  useEffect(() => {
    const detach = [
      shortcuts.on('newTab', showNewSequence),
      shortcuts.on('closeTab', closeActiveDocument),
      shortcuts.on('openFile', () => void openFilesFromPicker()),
    ];
    const onKeyDown = (event: KeyboardEvent) => shortcuts.handle(event);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      for (const off of detach) off();
    };
  }, []);
}

/** Browsers allow audio only after a user gesture, so the first pointer or key press starts it. */
function useAudioUnlock(): void {
  useEffect(() => {
    const detach = () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    const unlock = () => {
      unlockAudio();
      detach();
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return detach;
  }, []);
}

function StatusLine() {
  const current = notice.value;
  return (
    <div class={current ? `status-line ${current.tone}` : 'status-line'} role="status" aria-live="polite">
      {current && (
        <>
          <span>{t(current.key)}</span>
          <button
            type="button"
            class="status-dismiss"
            aria-label={t('status.dismiss')}
            onClick={() => (notice.value = null)}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

/** The application shell: background, header, the active view, settings and the drop overlay. */
export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dragging = useWindowFileDrop();
  useAppShortcuts();
  useAudioUnlock();

  const { background, palette, luminosity } = settings.value;
  const activeDoc = workspace.activeDocument.value;

  const toggleSettings = (open: boolean) => {
    setSettingsOpen(open);
    sfx(open ? 'panelOpen' : 'panelClose');
  };

  return (
    <>
      <Background scene={background} themeKey={`${palette}/${luminosity}`} />
      <div class="app-shell">
        <Header settingsOpen={settingsOpen} onToggleSettings={() => toggleSettings(!settingsOpen)} />
        <main class="workspace">
          {activeDoc ? <DocumentView key={activeDoc.id} doc={activeDoc} /> : <NewSequenceView />}
        </main>
        <StatusLine />
      </div>
      {settingsOpen && <SettingsPanel onClose={() => toggleSettings(false)} />}
      {dragging && (
        <div class="drop-overlay" aria-hidden="true">
          <div class="bracket-box drop-overlay-box">
            <div class="bracket-inner" />
            {t('newSeq.dropOverlay')}
          </div>
        </div>
      )}
    </>
  );
}
