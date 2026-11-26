import { useMemo } from 'preact/hooks';
import type { CodonUsageRow } from '../../../engine/composition';
import { type SeqDocument, workspace } from '../../../state/documents';
import { settings as appSettings, useAdvanced } from '../../../state/settings';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { AminoAcidCompositionChart, Chart, CodonUsageChart, SERIES_COLORS } from '../../viz';
import { orfSessionOf } from '../proteins/orfSession';
import { codonSessionOf } from './codonSession';
import { REFERENCE_SOURCE, REFERENCE_TABLES, SMALL_SAMPLE_CDS } from './references';
import {
  type ComparedRow,
  codonAdaptationIndex,
  compareWithReference,
  type ShareRow,
  withFamilyShare,
} from './usage';

/** What a scope hands to the report: the codon tally, or why there is none. */
export type UsageState =
  | { readonly status: 'pending' }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'empty'; readonly message: string; readonly goToProteins?: true }
  | {
      readonly status: 'ready';
      readonly rows: readonly CodonUsageRow[];
      readonly total: number;
      /** What was counted, e.g. "ORF3 (+1, 120 aa)". */
      readonly label: string;
    };

const fixed = (digits: number) => (value: unknown) => Number(value).toFixed(digits);
const grouped = (value: unknown) => Number(value).toLocaleString();
const percent = (value: unknown) => `${(Number(value) * 100).toFixed(1)}%`;

function useBaseColumns(): readonly TableColumn<ShareRow>[] {
  const language = appSettings.value.language;
  return useMemo(
    () => [
      { id: 'codon', header: t('codons.col.codon'), value: (row) => row.codon, width: 84 },
      {
        id: 'aa',
        header: t('codons.col.aminoAcid'),
        value: (row) => row.aminoAcid,
        width: 90,
        align: 'start',
      },
      {
        id: 'count',
        header: t('codons.col.count'),
        type: 'number',
        value: (row) => row.count,
        format: grouped,
        width: 90,
      },
      {
        id: 'share',
        header: t('codons.col.share'),
        type: 'number',
        value: (row) => row.share,
        format: percent,
        width: 130,
      },
      {
        id: 'perThousand',
        header: t('codons.col.perThousand'),
        type: 'number',
        value: (row) => row.perThousand,
        format: fixed(1),
        width: 130,
      },
      {
        id: 'rscu',
        header: t('codons.col.rscu'),
        type: 'number',
        value: (row) => row.rscu,
        format: fixed(2),
        width: 80,
      },
    ],
    [language],
  );
}

function useComparedColumns(
  base: readonly TableColumn<ShareRow>[],
  advanced: boolean,
): readonly TableColumn<ComparedRow>[] {
  const language = appSettings.value.language;
  return useMemo(() => {
    const columns: TableColumn<ComparedRow>[] = [
      ...base,
      {
        id: 'refPerThousand',
        header: t('codons.col.refPerThousand'),
        type: 'number',
        value: (row) => row.referencePerThousand,
        format: fixed(1),
        width: 150,
      },
      {
        id: 'difference',
        header: t('codons.col.difference'),
        type: 'number',
        value: (row) => row.difference,
        format: (value) => `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(1)}`,
        width: 130,
      },
    ];
    if (advanced)
      columns.push(
        {
          id: 'refRscu',
          header: t('codons.col.refRscu'),
          type: 'number',
          value: (row) => row.referenceRscu,
          format: fixed(2),
          width: 100,
        },
        {
          id: 'w',
          header: t('codons.col.adaptiveness'),
          type: 'number',
          value: (row) => row.adaptiveness,
          format: fixed(2),
          width: 90,
        },
      );
    return columns;
  }, [base, advanced, language]);
}

function Kpi({
  title,
  value,
  sub,
}: {
  readonly title: string;
  readonly value: string;
  readonly sub?: string;
}) {
  return (
    <div class="bracket-box pv-kpi">
      <div class="bracket-inner" />
      <div class="pv-kpi-title">{title}</div>
      <div class="pv-kpi-value">{value}</div>
      {sub && <div class="pv-kpi-sub">{sub}</div>}
    </div>
  );
}

/** Counts of the 20 amino acids that the codon tally codes for. */
function aminoAcidCounts(rows: readonly CodonUsageRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows)
    if (row.aminoAcid !== '*') counts[row.aminoAcid] = (counts[row.aminoAcid] ?? 0) + row.count;
  return counts;
}

/**
 * The Codons report for one tally: the 64-codon table, the usage chart, the amino-acid composition, and, when
 * the user picked a reference organism, the per-codon difference and the codon adaptation index.
 */
export function UsageReport({ doc, state }: { readonly doc: SeqDocument; readonly state: UsageState }) {
  const advanced = useAdvanced();
  const session = codonSessionOf(doc.id);
  const metric = session.metric.value;
  const reference = REFERENCE_TABLES.find((table) => table.id === session.reference.value) ?? null;
  const standardCode = orfSessionOf(doc.id).settings.value.table === 1;

  const shareRows = useMemo(() => (state.status === 'ready' ? withFamilyShare(state.rows) : []), [state]);
  const compared = useMemo(
    () => (reference && standardCode ? compareWithReference(shareRows, reference) : null),
    [reference, standardCode, shareRows],
  );
  const cai = useMemo(
    () =>
      compared
        ? codonAdaptationIndex(shareRows, new Map(compared.map((row) => [row.codon, row.adaptiveness])))
        : null,
    [compared, shareRows],
  );
  const baseColumns = useBaseColumns();
  const comparedColumns = useComparedColumns(baseColumns, advanced);

  if (state.status === 'pending') {
    return (
      <p class="pv-status" role="status">
        {t('codons.counting')}
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <p class="pv-status pv-failed" role="alert">
        {t('codons.failed', { reason: state.reason })}
      </p>
    );
  }
  if (state.status === 'empty') {
    return (
      <div class="pv-status">
        <p>{state.message}</p>
        {state.goToProteins && (
          <button type="button" class="chip-btn" onClick={() => workspace.setActiveTab(doc.id, 'proteins')}>
            {t('codons.openProteins')}
          </button>
        )}
      </div>
    );
  }
  if (state.total === 0) return <p class="pv-status">{t('codons.empty.none')}</p>;

  const name = doc.record.name;
  return (
    <>
      <div class="pv-kpi-grid">
        <Kpi title={t('codons.kpi.codons')} value={state.total.toLocaleString()} sub={state.label} />
        {reference && compared && (
          <Kpi
            title={t('codons.kpi.cai')}
            value={cai === null ? '–' : cai.toFixed(3)}
            sub={t('codons.kpi.caiAgainst', { host: reference.host })}
          />
        )}
      </div>

      <div class="bracket-box pv-card">
        <div class="bracket-inner" />
        <CodonUsageChart rows={state.rows} metric={metric} height={260} exportName={`${name}-codon-usage`} />
      </div>

      {compared && reference && (
        <div class="bracket-box pv-card">
          <div class="bracket-inner" />
          <Chart
            title={t('codons.chart.difference', { host: reference.host })}
            categories={compared.map((row) => row.codon)}
            series={[
              {
                kind: 'bar',
                name: t('codons.chart.differenceAxis'),
                values: compared.map((row) => row.difference),
                colors: compared.map((row) => (row.difference >= 0 ? SERIES_COLORS[0] : SERIES_COLORS[2])),
                format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
                describe: (i) => `${compared[i]?.codon} (${compared[i]?.aminoAcid})`,
              },
            ]}
            xLabel={t('chart.codon')}
            yLabel={t('codons.chart.differenceAxis')}
            height={240}
            exportName={`${name}-codon-difference-${reference.id}`}
          />
          <p class="pv-note">{t('codons.chart.differenceHint')}</p>
        </div>
      )}

      <div class="bracket-box pv-card">
        <div class="bracket-inner" />
        <AminoAcidCompositionChart
          counts={aminoAcidCounts(state.rows)}
          height={220}
          exportName={`${name}-amino-acids`}
        />
      </div>

      <div class="cv-table">
        {compared ? (
          <Table
            label={t('codons.table.label')}
            columns={comparedColumns}
            rows={compared}
            exportName={`${name}-codons-${reference?.id}`}
          />
        ) : (
          <Table
            label={t('codons.table.label')}
            columns={baseColumns}
            rows={shareRows}
            exportName={`${name}-codons`}
          />
        )}
      </div>

      {reference && compared && (
        <p class="pv-note">
          {t('codons.reference.source', {
            name: reference.name,
            cds: reference.cds.toLocaleString(),
            codons: reference.codons.toLocaleString(),
            retrieved: REFERENCE_SOURCE.retrieved,
          })}{' '}
          <a href={reference.url} target="_blank" rel="noopener noreferrer">
            {t('codons.reference.page')}
          </a>
          {reference.cds < SMALL_SAMPLE_CDS && <> {t('codons.reference.small', { cds: reference.cds })}</>}
        </p>
      )}
    </>
  );
}
