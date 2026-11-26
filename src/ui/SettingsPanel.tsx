import { useEffect, useRef } from 'preact/hooks';
import { ClearSessionControl } from '../project/ClearSessionControl';
import {
  BACKGROUNDS,
  LANGUAGES,
  LUMINOSITIES,
  PALETTES,
  type Settings,
  settings,
  UI_MODES,
  updateSettings,
} from '../state/settings';
import { sfx } from './actions';
import { LANGUAGE_NAMES, t } from './i18n';

const FOCUSABLE = 'button, input:not([type="radio"]), select, input[type="radio"]:checked, [tabindex="0"]';

/** A radio group drawn as segmented buttons; native radios give arrow-key navigation. */
function Segmented<K extends keyof Settings>({
  name,
  legend,
  options,
  label,
  swatch,
}: {
  name: K;
  legend: string;
  options: readonly Settings[K][];
  label: (option: Settings[K]) => string;
  swatch?: boolean;
}) {
  const current = settings.value[name];
  return (
    <fieldset class="settings-field">
      <legend class="field-label">{legend}</legend>
      <div class={swatch ? 'swatch-grid' : 'seg-group'}>
        {options.map((option) => (
          <label
            key={String(option)}
            class={swatch ? 'swatch-btn' : 'seg-btn'}
            data-palette={swatch ? String(option) : undefined}
            title={swatch ? label(option) : undefined}
          >
            <input
              type="radio"
              class="visually-hidden"
              name={name}
              checked={option === current}
              onChange={() => {
                updateSettings({ [name]: option } as Partial<Settings>);
                sfx('click');
              }}
            />
            <span class={swatch ? 'visually-hidden' : undefined}>{label(option)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The gear menu (spec 3.6): a modal panel that traps focus, closes on Escape and restores focus. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { soundOn, volume, background } = settings.value;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div class="settings-layer">
      <div class="settings-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        class="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={onKeyDown}
      >
        <div class="bracket-inner" />
        <div class="settings-header">
          <h2 class="settings-title" id="settings-title">
            {t('settings.title')}
          </h2>
          <button type="button" class="settings-close" aria-label={t('settings.close')} onClick={onClose}>
            ×
          </button>
        </div>

        <Segmented
          name="language"
          legend={t('settings.language')}
          options={LANGUAGES}
          label={(lang) => LANGUAGE_NAMES[lang]}
        />
        <Segmented
          name="palette"
          legend={t('settings.palette')}
          options={PALETTES}
          label={(palette) => t(`palette.${palette}`)}
          swatch
        />
        <Segmented
          name="luminosity"
          legend={t('settings.luminosity')}
          options={LUMINOSITIES}
          label={(mode) => t(`luminosity.${mode}`)}
        />

        <div class="settings-field">
          <label class="field-label" for="settings-background">
            {t('settings.background')}
          </label>
          <select
            id="settings-background"
            value={background}
            onChange={(event) => {
              const value = BACKGROUNDS.find((id) => id === event.currentTarget.value);
              if (value) updateSettings({ background: value });
            }}
          >
            {BACKGROUNDS.map((id) => (
              <option key={id} value={id}>
                {t(`background.${id}`)}
              </option>
            ))}
          </select>
        </div>

        <fieldset class="settings-field">
          <legend class="field-label">{t('settings.sound')}</legend>
          <div class="sound-row">
            <label class="check">
              <input
                type="checkbox"
                checked={soundOn}
                onChange={(event) => {
                  updateSettings({ soundOn: event.currentTarget.checked });
                  sfx('click');
                }}
              />
              {t('settings.soundOn')}
            </label>
            <label class="volume">
              <span class="visually-hidden">{t('settings.volume')}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(volume * 100)}
                disabled={!soundOn}
                aria-valuetext={`${Math.round(volume * 100)}%`}
                onInput={(event) => updateSettings({ volume: Number(event.currentTarget.value) / 100 })}
                onChange={() => sfx('click')}
              />
            </label>
          </div>
        </fieldset>

        <Segmented
          name="mode"
          legend={t('settings.mode')}
          options={UI_MODES}
          label={(mode) => t(`mode.${mode}`)}
        />
        <p class="settings-hint">
          {t(settings.value.mode === 'advanced' ? 'mode.advancedHint' : 'mode.defaultHint')}
        </p>
        <ClearSessionControl />
      </div>
    </div>
  );
}
