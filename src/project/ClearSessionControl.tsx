import { useState } from 'preact/hooks';
import { notice } from '../ui/actions';
import { t } from '../ui/i18n';
import { sessionController } from './session';

/** The settings control that empties the stored session (spec 8.1). Open sequences stay open. */
export function ClearSessionControl() {
  const [busy, setBusy] = useState(false);
  const clear = async () => {
    setBusy(true);
    try {
      await sessionController().clear();
      notice.value = { key: 'settings.sessionCleared', tone: 'info' };
    } catch {
      notice.value = { key: 'session.saveFailed', tone: 'error' };
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset class="settings-field">
      <legend class="field-label">{t('settings.session')}</legend>
      <button type="button" class="secondary" disabled={busy} onClick={() => void clear()}>
        {t('settings.clearSession')}
      </button>
      <p class="settings-hint">{t('settings.clearSessionHint')}</p>
    </fieldset>
  );
}
