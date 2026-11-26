import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { FEATURE_TYPES, type Feature, type FeatureOrigin } from '../../engine/types';
import { useAnalysis } from '../../state/analysis';
import type { SeqDocument } from '../../state/documents';
import { editFeatures, viewOf } from '../../state/view';
import type { Cell } from '../export';
import { t } from '../i18n';
import { Table, type TableColumn } from '../table';
import { ConfirmDelete, FeatureEditor } from './features/FeatureEditor';
import { type FeatureRow, featureRows, mergeDetected, selectableSpan } from './features/model';
import './features/features.css';

const ORIGINS: readonly FeatureOrigin[] = ['file', 'user', 'detected'];
type Editing =
  | { readonly kind: 'none' }
  | { readonly kind: 'new' }
  | { readonly kind: 'feature'; readonly id: string };

/** Looks for known elements in a nucleotide record and hands them to `children`. */
function WithDetected({
  doc,
  children,
}: {
  readonly doc: SeqDocument;
  readonly children: (
    detected: readonly Feature[],
    status: 'pending' | 'ready' | string,
  ) => ComponentChildren;
}) {
  const state = useAnalysis(doc, 'features', {});
  if (state.status === 'ready') return <>{children(state.value, 'ready')}</>;
  return <>{children([], state.status === 'pending' ? 'pending' : state.reason)}</>;
}

/** The features view: every annotation of the record in one table, with the form to add, edit and delete them. */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  if (doc.record.alphabet === 'protein') return <FeaturesBody doc={doc} detected={[]} detection="ready" />;
  return (
    <WithDetected doc={doc}>
      {(detected, detection) => <FeaturesBody doc={doc} detected={detected} detection={detection} />}
    </WithDetected>
  );
}

function FeaturesBody({
  doc,
  detected,
  detection,
}: {
  readonly doc: SeqDocument;
  readonly detected: readonly Feature[];
  readonly detection: string;
}) {
  const { record } = doc;
  const view = viewOf(doc.id);
  const [typeFilter, setTypeFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [showDetected, setShowDetected] = useState(true);
  const [editing, setEditing] = useState<Editing>({ kind: 'none' });
  const [picked, setPicked] = useState<{
    readonly rows: readonly FeatureRow[];
    readonly ids: readonly string[];
  }>({
    rows: [],
    ids: [],
  });

  const all = useMemo(
    () => mergeDetected(record.features, showDetected ? detected : []),
    [record.features, detected, showDetected],
  );
  const allRows = useMemo(() => featureRows(all), [all]);
  const rows = useMemo(
    () =>
      allRows.filter(
        (row) =>
          (typeFilter === '' || row.typeName === typeFilter) &&
          (originFilter === '' || row.feature.origin === originFilter),
      ),
    [allRows, typeFilter, originFilter],
  );
  const types = useMemo(() => [...new Set(allRows.map((row) => row.typeName))].sort(), [allRows]);

  const selectedIds = picked.rows === rows ? picked.ids : [];

  const counts = useMemo(() => {
    const byOrigin = { file: 0, user: 0, detected: 0 };
    for (const f of all) byOrigin[f.origin]++;
    return byOrigin;
  }, [all]);

  const typeLabel = (name: string) =>
    (FEATURE_TYPES as readonly string[]).includes(name)
      ? t(`feat.type.${name as (typeof FEATURE_TYPES)[number]}`)
      : name;

  const columns: TableColumn<FeatureRow>[] = [
    { id: 'name', header: t('features.col.name'), width: 170, value: (r) => r.feature.name },
    {
      id: 'type',
      header: t('features.col.type'),
      width: 170,
      value: (r) => r.typeName,
      format: (v) => typeLabel(String(v)),
    },
    {
      id: 'start',
      header: t('features.col.start'),
      type: 'number',
      width: 80,
      value: (r) => selectableSpan(r.feature.location).start + 1,
    },
    { id: 'span', header: t('features.col.span'), width: 170, value: (r) => r.span },
    {
      id: 'length',
      header: t('features.col.length'),
      type: 'number',
      width: 90,
      value: (r) => r.length,
      format: (v) => (typeof v === 'number' ? v.toLocaleString() : ''),
    },
    {
      id: 'strand',
      header: t('features.col.strand'),
      width: 80,
      value: (r) => (r.feature.location.strand === 1 ? '+' : '-'),
    },
    {
      id: 'origin',
      header: t('features.col.origin'),
      width: 110,
      value: (r) => r.feature.origin,
      format: (v) => t(`features.origin.${v as FeatureOrigin}`),
    },
    { id: 'color', header: t('features.col.color'), width: 100, value: (r) => r.feature.color ?? '' },
    {
      id: 'description',
      header: t('features.col.description'),
      width: 260,
      value: (r): Cell => r.feature.description ?? '',
    },
  ];

  const editedFeature =
    editing.kind === 'feature' ? (all.find((feature) => feature.id === editing.id) ?? null) : null;

  const pick = (row: FeatureRow) => {
    setEditing({ kind: 'feature', id: row.feature.id });
    const span = selectableSpan(row.feature.location);
    view.select(span.start, span.end, row.feature.location.strand);
    view.reveal(span.start);
  };

  const finish = (id: string | null) => setEditing(id === null ? { kind: 'none' } : { kind: 'feature', id });

  const deletable = selectedIds.filter((id) => record.features.some((f) => f.id === id));
  const deleteSelected = () => {
    const doomed = new Set(deletable);
    editFeatures(doc.id, `remove ${doomed.size} features`, (list) => list.filter((f) => !doomed.has(f.id)));
    setEditing({ kind: 'none' });
  };

  const select = (indexes: readonly number[]) =>
    setPicked({ rows, ids: indexes.map((index) => (rows[index] as FeatureRow).feature.id) });

  return (
    <div class="features-view">
      <section class="bracket-box features-main">
        <div class="bracket-inner" />
        <div class="features-bar">
          <h2 class="section-title">{t('features.label')}</h2>
          <span class="features-count" role="status">
            {t('features.count', {
              total: all.length.toLocaleString(),
              mine: counts.user,
              file: counts.file,
              detected: counts.detected,
            })}
          </span>
          <button type="button" class="primary-btn" onClick={() => setEditing({ kind: 'new' })}>
            {t('features.add')}
          </button>
        </div>
        <div class="features-filters">
          <label class="field inline">
            <span class="field-label">{t('features.filterType')}</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter((e.currentTarget as HTMLSelectElement).value)}
            >
              <option value="">{t('features.all')}</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label class="field inline">
            <span class="field-label">{t('features.filterOrigin')}</span>
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter((e.currentTarget as HTMLSelectElement).value)}
            >
              <option value="">{t('features.all')}</option>
              {ORIGINS.map((origin) => (
                <option key={origin} value={origin}>
                  {t(`features.origin.${origin}`)}
                </option>
              ))}
            </select>
          </label>
          {record.alphabet !== 'protein' && (
            <label class="check">
              <input
                type="checkbox"
                checked={showDetected}
                onChange={(e) => setShowDetected((e.currentTarget as HTMLInputElement).checked)}
              />
              {t('features.showDetected')}
            </label>
          )}
          {deletable.length > 0 && (
            <ConfirmDelete
              label={t('features.deleteSelected', { count: deletable.length })}
              prompt={t('features.deleteSelectedConfirm', { count: deletable.length })}
              onConfirm={deleteSelected}
            />
          )}
        </div>
        {showDetected && detection === 'pending' && <p class="note">{t('features.detecting')}</p>}
        {showDetected && detection !== 'pending' && detection !== 'ready' && (
          <p class="form-error" role="alert">
            {t('features.detectFailed', { reason: detection })}
          </p>
        )}
        {counts.detected > 0 && <p class="note">{t('features.detectedNote')}</p>}
        <p class="note">{t('features.bulkHint')}</p>
        <div class="features-table">
          {allRows.length === 0 && detection !== 'pending' ? (
            <p class="empty-state">{t('features.empty')}</p>
          ) : (
            <Table
              label={t('features.label')}
              columns={columns}
              rows={rows}
              exportName={`${record.name}-features`}
              initialSort={{ column: 'start', direction: 'asc' }}
              onRowClick={pick}
              onSelectionChange={select}
            />
          )}
        </div>
      </section>
      <aside class="bracket-box features-side" aria-label={t('features.editor.new')}>
        <div class="bracket-inner" />
        {editing.kind === 'none' || (editing.kind === 'feature' && !editedFeature) ? (
          <p class="note">{t('features.editor.pick')}</p>
        ) : (
          <FeatureEditor
            key={editing.kind === 'new' ? 'new' : editing.id}
            doc={doc}
            feature={editedFeature}
            onDone={finish}
          />
        )}
      </aside>
    </div>
  );
}
