import { useState } from 'preact/hooks';
import { formatLocation } from '../../../engine/location';
import { FEATURE_TYPES, type Feature, type FeatureType, type Strand } from '../../../engine/types';
import type { SeqDocument } from '../../../state/documents';
import { addFeature, editFeatures, removeFeature, viewOf } from '../../../state/view';
import { copyText, reportCopy } from '../../export';
import { t } from '../../i18n';
import { ColorPicker } from './ColorPicker';
import {
  buildLocation,
  type DraftError,
  draftOf,
  type FeatureDraft,
  featureFromDraft,
  featureSequence,
  featureTranslation,
  keepAsUserFeature,
  locationCoordinates,
  newFeatureId,
} from './model';

export interface FeatureEditorProps {
  readonly doc: SeqDocument;
  /** The feature to edit, or null to add one. */
  readonly feature: Feature | null;
  /** Called with the id of the feature that was added or changed, or with null when the editor closes. */
  readonly onDone: (id: string | null) => void;
}

/** Asks "are you sure" next to the button, so a delete never needs a dialog. */
export function ConfirmDelete({
  prompt,
  label,
  onConfirm,
}: {
  readonly prompt: string;
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" class="secondary danger" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <span class="confirm" role="alert">
      <span>{prompt}</span>
      <button type="button" class="secondary danger" onClick={onConfirm}>
        {t('features.deleteYes')}
      </button>
      <button type="button" class="secondary" onClick={() => setAsking(false)}>
        {t('features.cancel')}
      </button>
    </span>
  );
}

/**
 * The annotation form. A new feature starts from the shared selection when there is one. A detected feature is
 * shown read-only, with the way to copy it into the user's own annotations.
 */
export function FeatureEditor({ doc, feature, onDone }: FeatureEditorProps) {
  const { record } = doc;
  const view = viewOf(doc.id);
  const selection = view.selection.value;
  const protein = record.alphabet === 'protein';
  const unit = t(protein ? 'features.unit.aa' : 'features.unit.bp');
  const range = selection ? { from: selection.start + 1, to: selection.end } : undefined;
  const [draft, setDraft] = useState<FeatureDraft>(() => draftOf(feature, record.seq.length, range));
  const [error, setError] = useState<DraftError | null>(null);
  const set = (patch: Partial<FeatureDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const detected = feature?.origin === 'detected';
  const fixed = feature !== null && locationCoordinates(feature.location, record.seq.length) === null;
  const preview = fixed
    ? null
    : buildLocation(draft.from, draft.to, draft.strand, record.seq.length, record.topology);

  const save = (event: Event) => {
    event.preventDefault();
    const result = featureFromDraft(draft, { record, id: newFeatureId(record.features) }, feature);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const saved = result.feature;
    if (feature)
      editFeatures(doc.id, `edit ${saved.name}`, (list) => list.map((f) => (f.id === saved.id ? saved : f)));
    else addFeature(doc.id, saved);
    onDone(saved.id);
  };

  const keep = () => {
    if (!feature) return;
    const copy = keepAsUserFeature(feature, newFeatureId(record.features));
    addFeature(doc.id, copy);
    onDone(copy.id);
  };

  if (feature && detected)
    return (
      <div class="feature-editor">
        <h3 class="editor-title">{t('features.editor.detected')}</h3>
        <p class="editor-name">{feature.name}</p>
        <p class="editor-span">{formatLocation(feature.location)}</p>
        <p class="note">{t('features.detectedNote')}</p>
        <div class="editor-actions">
          <button type="button" class="primary-btn" onClick={keep}>
            {t('features.keep')}
          </button>
          <FeatureCopyButtons doc={doc} feature={feature} />
        </div>
      </div>
    );

  const from = (value: number) => String(value + 1);
  return (
    <form class="feature-editor" onSubmit={save} noValidate>
      <h3 class="editor-title">{t(feature ? 'features.editor.edit' : 'features.editor.new')}</h3>
      <label class="field">
        <span class="field-label">{t('features.field.name')}</span>
        <input
          type="text"
          value={draft.name}
          aria-invalid={error === 'noName'}
          onInput={(event) => set({ name: (event.currentTarget as HTMLInputElement).value })}
        />
      </label>
      <div class="field-row">
        <label class="field">
          <span class="field-label">{t('features.field.type')}</span>
          <select
            value={draft.type}
            onChange={(event) =>
              set({ type: (event.currentTarget as HTMLSelectElement).value as FeatureType })
            }
          >
            {FEATURE_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`feat.type.${type}`)}
              </option>
            ))}
          </select>
        </label>
        {draft.type === 'custom' && (
          <label class="field">
            <span class="field-label">{t('features.field.customType')}</span>
            <input
              type="text"
              value={draft.customType}
              onInput={(event) => set({ customType: (event.currentTarget as HTMLInputElement).value })}
            />
          </label>
        )}
        {!protein && (
          <label class="field">
            <span class="field-label">{t('features.field.strand')}</span>
            <select
              value={String(draft.strand)}
              onChange={(event) =>
                set({ strand: Number((event.currentTarget as HTMLSelectElement).value) as Strand })
              }
            >
              <option value="1">{t('features.strand.forward')}</option>
              <option value="-1">{t('features.strand.reverse')}</option>
            </select>
          </label>
        )}
      </div>

      {fixed && feature ? (
        <p class="note">
          {formatLocation(feature.location)}. {t('features.fixedCoordinates')}
        </p>
      ) : (
        <>
          <div class="field-row">
            <label class="field">
              <span class="field-label">{t('features.field.from')}</span>
              <input
                type="text"
                inputMode="numeric"
                value={draft.from}
                aria-invalid={error === 'notNumber' || error === 'outOfRange' || error === 'backwards'}
                onInput={(event) => set({ from: (event.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <button
              type="button"
              class="secondary mini"
              disabled={!selection}
              title={t('features.fromSelection')}
              aria-label={t('features.fromSelection')}
              onClick={() => selection && set({ from: from(selection.start) })}
            >
              ⇤
            </button>
            <label class="field">
              <span class="field-label">{t('features.field.to')}</span>
              <input
                type="text"
                inputMode="numeric"
                value={draft.to}
                aria-invalid={error === 'notNumber' || error === 'outOfRange' || error === 'backwards'}
                onInput={(event) => set({ to: (event.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <button
              type="button"
              class="secondary mini"
              disabled={!selection}
              title={t('features.toSelection')}
              aria-label={t('features.toSelection')}
              onClick={() => selection && set({ to: String(selection.end) })}
            >
              ⇥
            </button>
            <button
              type="button"
              class="secondary"
              disabled={!selection}
              onClick={() => selection && set({ from: from(selection.start), to: String(selection.end) })}
            >
              {t('features.useSelection')}
            </button>
          </div>
          {!selection && <p class="note">{t('features.noSelection')}</p>}
          {record.topology === 'circular' && <p class="note">{t('features.originHint')}</p>}
          {preview?.ok && (
            <p class="note" role="status">
              {t('features.preview', {
                span: formatLocation(preview.location),
                length: preview.length.toLocaleString(),
                unit,
              })}
              {preview.wraps && ` ${t('features.crossesOrigin')}`}
            </p>
          )}
        </>
      )}

      <ColorPicker value={draft.color} type={draft.type} onChange={(color) => set({ color })} />
      <label class="field">
        <span class="field-label">{t('features.field.description')}</span>
        <textarea
          rows={2}
          value={draft.description}
          onInput={(event) => set({ description: (event.currentTarget as HTMLTextAreaElement).value })}
        />
      </label>

      {error && (
        <p class="form-error" role="alert">
          {t(`features.error.${error}`)}
        </p>
      )}
      <div class="editor-actions">
        <button type="submit" class="primary-btn">
          {t(feature ? 'features.save' : 'features.create')}
        </button>
        <button type="button" class="secondary" onClick={() => onDone(null)}>
          {t('features.cancel')}
        </button>
        {feature && (
          <>
            <FeatureCopyButtons doc={doc} feature={feature} />
            <ConfirmDelete
              label={t('features.delete')}
              prompt={t('features.deleteConfirm', { name: feature.name })}
              onConfirm={() => {
                removeFeature(doc.id, feature.id);
                onDone(null);
              }}
            />
          </>
        )}
      </div>
    </form>
  );
}

/** Copies a feature's sequence, or its translation for a nucleotide record. */
export function FeatureCopyButtons({
  doc,
  feature,
}: {
  readonly doc: SeqDocument;
  readonly feature: Feature;
}) {
  const { record } = doc;
  const copy = async (text: string) => reportCopy(await copyText(text));
  return (
    <>
      <button type="button" class="secondary" onClick={() => void copy(featureSequence(record, feature))}>
        {t('features.copySequence')}
      </button>
      {record.alphabet !== 'protein' && (
        <button
          type="button"
          class="secondary"
          onClick={() => void copy(featureTranslation(record, feature))}
        >
          {t('features.copyTranslation')}
        </button>
      )}
    </>
  );
}
