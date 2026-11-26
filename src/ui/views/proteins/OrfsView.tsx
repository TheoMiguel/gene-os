import { useMemo, useState } from 'preact/hooks';
import { GENETIC_CODES } from '../../../engine/translate';
import { useAnalysis } from '../../../state/analysis';
import type { SeqDocument } from '../../../state/documents';
import { settings as appSettings, useAdvanced } from '../../../state/settings';
import { viewOf } from '../../../state/view';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { SegmentedField, SelectField } from './controls';
import { OrfMap } from './OrfMap';
import { OrfParams } from './OrfParams';
import { frameLabel, type OrfRow, orfRows } from './orfRows';
import { type OrfSettings, orfSessionOf, resolveSelectedOrf, scanParams, selectOrf } from './orfSession';
import { HydropathyBlock, ProteinInspector, Translation } from './ProteinDetail';
import { SixFrame } from './SixFrame';

type Mode = 'orfs' | 'frames';

const PEPTIDE_PREVIEW = 36;
const grouped = (value: unknown) => Number(value).toLocaleString();
const fixed = (digits: number) => (value: unknown) => Number(value).toFixed(digits);

function useColumns(): readonly TableColumn<OrfRow>[] {
  const language = appSettings.value.language;
  return useMemo(
    () => [
      { id: 'id', header: t('proteins.col.id'), value: (row) => row.id, width: 84 },
      { id: 'frame', header: t('proteins.col.frame'), value: (row) => frameLabel(row.frame), width: 72 },
      {
        id: 'start',
        header: t('proteins.col.start'),
        type: 'number',
        value: (row) => row.start,
        format: grouped,
        width: 100,
      },
      {
        id: 'end',
        header: t('proteins.col.end'),
        type: 'number',
        value: (row) => row.end,
        format: grouped,
        width: 100,
      },
      {
        id: 'aa',
        header: t('proteins.col.length'),
        type: 'number',
        value: (row) => row.lengthAa,
        format: grouped,
        width: 100,
      },
      {
        id: 'weight',
        header: t('proteins.col.weight'),
        type: 'number',
        value: (row) => row.weight,
        format: (value) => Math.round(Number(value)).toLocaleString(),
        width: 160,
      },
      {
        id: 'pI',
        header: t('proteins.col.pI'),
        type: 'number',
        value: (row) => row.pI,
        format: fixed(2),
        width: 72,
      },
      {
        id: 'gravy',
        header: t('proteins.col.gravy'),
        type: 'number',
        value: (row) => row.gravy,
        format: fixed(3),
        width: 84,
      },
      {
        id: 'startCodon',
        header: t('proteins.col.startCodon'),
        value: (row) => row.orf.startCodon,
        width: 100,
      },
      {
        id: 'stopCodon',
        header: t('proteins.col.stopCodon'),
        value: (row) => row.orf.stopCodon ?? '',
        width: 100,
      },
      {
        id: 'peptide',
        header: t('proteins.col.peptide'),
        value: (row) => row.orf.protein,
        format: (value) => {
          const text = String(value);
          return text.length > PEPTIDE_PREVIEW ? `${text.slice(0, PEPTIDE_PREVIEW)}…` : text;
        },
        width: 300,
        align: 'start',
      },
    ],
    [language],
  );
}

/** The Proteins view of a DNA or RNA record: ORF search, map, table and the selected ORF's protein. */
export function OrfsView({ doc }: { readonly doc: SeqDocument }) {
  const advanced = useAdvanced();
  const session = orfSessionOf(doc.id);
  const settings = session.settings.value;
  const view = viewOf(doc.id);
  const columns = useColumns();
  const [mode, setMode] = useState<Mode>('orfs');
  const { record } = doc;

  const state = useAnalysis(doc, 'orfs', scanParams(settings));
  const rows = useMemo(
    () => (state.status === 'ready' ? orfRows(state.value, record.seq.length) : []),
    [state, record.seq.length],
  );
  const selectedOrf =
    state.status === 'ready'
      ? resolveSelectedOrf(state.value, session.picked.value, view.selection.value)
      : null;
  const selected = rows.find((row) => row.orf === selectedOrf) ?? null;
  const change = (patch: Partial<OrfSettings>) => {
    session.settings.value = { ...settings, ...patch };
  };

  return (
    <div class="pv">
      <div class="bracket-box pv-card pv-controls">
        <div class="bracket-inner" />
        <SegmentedField
          legend={t('proteins.mode')}
          name={`${doc.id}-pv-mode`}
          value={mode}
          options={[
            { value: 'orfs' as Mode, label: t('proteins.mode.orfs') },
            { value: 'frames' as Mode, label: t('proteins.mode.frames') },
          ]}
          onChange={setMode}
        />
        {mode === 'orfs' ? (
          <OrfParams
            docId={doc.id}
            settings={settings}
            topology={record.topology}
            advanced={advanced}
            onChange={change}
          />
        ) : (
          advanced && (
            <SelectField
              id={`${doc.id}-frames-code`}
              label={t('proteins.param.table')}
              value={settings.table}
              options={GENETIC_CODES.map((code) => ({ value: code.id, label: `${code.id}. ${code.name}` }))}
              onChange={(table) => change({ table })}
            />
          )
        )}
      </div>

      {mode === 'frames' ? (
        <SixFrame doc={doc} table={settings.table} />
      ) : state.status === 'pending' ? (
        <p class="pv-status" role="status">
          {t('proteins.scanning')}
        </p>
      ) : state.status === 'failed' ? (
        <p class="pv-status pv-failed" role="alert">
          {t('proteins.failed', { reason: state.reason })}
        </p>
      ) : (
        <>
          <div class="bracket-box pv-stage">
            <div class="bracket-inner" />
            <div class="pv-stage-col">
              <div class="stage-label">01</div>
              <h2 class="stage-title">{t('proteins.stage.dna')}</h2>
              <OrfMap
                rows={rows}
                seqLength={record.seq.length}
                features={record.features}
                selected={selected}
                onSelect={(row) => selectOrf(doc.id, row.orf)}
                exportName={`${record.name}-orf-map`}
              />
            </div>
            <div class="pv-bridge" aria-hidden="true">
              <span>{t('proteins.bridge.frames')}</span>
              <div class="pv-bridge-pill">{t('proteins.bridge.translate')}</div>
              <span>→</span>
            </div>
            <div class="pv-stage-col">
              <div class="stage-label">02</div>
              <h2 class="stage-title">{t('proteins.stage.protein')}</h2>
              {selected ? (
                <>
                  <p class="pv-caption">
                    <strong>{selected.id}</strong> ·{' '}
                    {t('proteins.caption', {
                      frame: frameLabel(selected.frame),
                      aa: selected.lengthAa.toLocaleString(),
                      kda: (selected.weight / 1000).toFixed(1),
                      pI: selected.pI.toFixed(2),
                    })}
                  </p>
                  <Translation protein={selected.orf.protein} />
                  <HydropathyBlock
                    protein={selected.orf.protein}
                    window={settings.hydropathyWindow}
                    exportName={`${record.name}-${selected.id}`}
                  />
                </>
              ) : (
                <p class="pv-note">
                  {rows.length === 0 ? t('proteins.empty.none') : t('proteins.empty.select')}
                </p>
              )}
            </div>
          </div>

          {rows.length === 0 ? (
            <p class="pv-status">{t('proteins.empty.hint', { count: settings.minCodons })}</p>
          ) : (
            <div class="pv-table">
              <Table
                label={t('proteins.table.label')}
                columns={columns}
                rows={rows}
                exportName={`${record.name}-orfs`}
                onRowClick={(row) => selectOrf(doc.id, row.orf)}
              />
            </div>
          )}

          {selected && (
            <div class="bracket-box pv-card">
              <div class="bracket-inner" />
              <ProteinInspector
                title={selected.id}
                subtitle={t('proteins.subtitle', {
                  name: record.name,
                  frame: frameLabel(selected.frame),
                  start: selected.start.toLocaleString(),
                  end: selected.end.toLocaleString(),
                })}
                protein={selected.orf.protein}
                exportName={`${record.name}-${selected.id}`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
