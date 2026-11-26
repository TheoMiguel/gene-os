import { useState } from 'preact/hooks';
import { loadPreset, PRESETS, type PresetInfo } from '../../../data/presets';
import { workspace } from '../../../state/documents';
import { notice, sfx } from '../../actions';
import { t } from '../../i18n';
import './libraries.css';

/** Opens an example as a document. Resolves to false when it could not be read. */
async function openPreset(id: string): Promise<boolean> {
  try {
    workspace.open(await loadPreset(id));
    notice.value = null;
    sfx('loaded');
    return true;
  } catch {
    sfx('error');
    return false;
  }
}

const sizeText = (preset: PresetInfo) =>
  t('lib.preset.meta', {
    length: preset.length.toLocaleString(),
    unit: t('lib.unit.bp'),
    topology: t(preset.topology === 'circular' ? 'topology.circular' : 'topology.linear'),
    features: preset.features,
  });

/**
 * The shipped example sequences (spec 6.2). They open with no network: each is a public record read through the
 * format readers, so it carries the features of its record. `chips` is the short list of the new-sequence view;
 * `cards` adds the description and the record each one came from.
 */
export function ExamplePresets({ variant }: { variant: 'chips' | 'cards' }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const open = async (preset: PresetInfo) => {
    setBusy(preset.id);
    setFailed((await openPreset(preset.id)) ? null : preset.name);
    setBusy(null);
  };

  return (
    <div class="presets">
      <ul class={variant === 'chips' ? 'lib-chips preset-list' : 'preset-cards preset-list'}>
        {PRESETS.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              class={variant === 'chips' ? 'chip-btn' : 'preset-card'}
              disabled={busy !== null}
              aria-label={t('lib.preset.open', { name: preset.name })}
              title={`${preset.description} ${sizeText(preset)}`}
              onClick={() => void open(preset)}
            >
              <span class="preset-name">
                {busy === preset.id ? t('lib.preset.opening', { name: preset.name }) : preset.name}
              </span>
              {variant === 'cards' && (
                <>
                  <span class="preset-meta">{sizeText(preset)}</span>
                  <span class="preset-desc">{preset.description}</span>
                  <span class="preset-source">
                    {preset.accession
                      ? `${t('lib.preset.record', { accession: preset.accession })}${
                          preset.region ? `, ${t('lib.preset.region', { region: preset.region })}` : ''
                        }`
                      : preset.source}
                  </span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div role="status" aria-live="polite">
        {failed && <p class="lib-status lib-error">{t('lib.preset.failed', { name: failed })}</p>}
      </div>
    </div>
  );
}
