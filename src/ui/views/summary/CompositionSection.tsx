import { useMemo } from 'preact/hooks';
import type { SequenceSummary } from '../../../engine/summary';
import type { Alphabet } from '../../../engine/types';
import type { AnalysisState } from '../../../state/analysis';
import type { Language } from '../../../state/settings';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { AminoAcidCompositionChart, NucleotideCompositionChart } from '../../viz';
import { type CompositionRow, compositionRows, formatFixed, formatInt, OTHER_LETTER } from './model';
import { Pending } from './Pending';
import { Section } from './Section';

const ROW_PX = 28;
const TABLE_CHROME_PX = 32 + 88;
const MAX_TABLE_PX = 380;
const CHART_HEIGHT = 260;

/** Table and chart of nucleotide or residue counts, from the one `summary` scan. */
export function CompositionSection({
  stats,
  alphabet,
  length,
  language,
}: {
  readonly stats: AnalysisState<SequenceSummary>;
  readonly alphabet: Alphabet;
  readonly length: number;
  readonly language: Language;
}) {
  const ready = stats.status === 'ready' ? stats.value : null;
  const rows = useMemo(
    () => (ready ? compositionRows(ready.counts, alphabet, length) : []),
    [ready, alphabet, length],
  );
  const protein = alphabet === 'protein';

  const columns = useMemo((): TableColumn<CompositionRow>[] => {
    const label = (row: CompositionRow) =>
      row.letter === OTHER_LETTER ? t('summary.composition.other') : row.letter;
    return [
      {
        id: 'letter',
        header: protein ? t('summary.composition.residue') : t('summary.composition.base'),
        value: label,
        width: protein ? 110 : 150,
      },
      ...(protein
        ? [
            {
              id: 'code',
              header: t('summary.composition.code'),
              value: (row: CompositionRow) => row.name,
              width: 80,
            },
          ]
        : []),
      {
        id: 'count',
        header: t('summary.composition.count'),
        type: 'number' as const,
        value: (row: CompositionRow) => row.count,
        format: (value) => formatInt(Number(value), language),
        width: 120,
      },
      {
        id: 'share',
        header: t('summary.composition.share'),
        type: 'number' as const,
        value: (row: CompositionRow) => row.fraction * 100,
        format: (value) => `${formatFixed(Number(value), 2, language)}%`,
        width: 110,
      },
    ];
  }, [protein, language]);

  const tableHeight = Math.min(MAX_TABLE_PX, rows.length * ROW_PX + TABLE_CHROME_PX);
  const reservedRows = protein ? 21 : 5;
  const placeholderHeight = Math.min(MAX_TABLE_PX, reservedRows * ROW_PX + TABLE_CHROME_PX);

  return (
    <Section number="01" title={t('summary.section.composition')}>
      <div class="composition-grid">
        <div class="composition-table" style={{ height: `${ready ? tableHeight : placeholderHeight}px` }}>
          {ready ? (
            <Table
              label={t('summary.composition.table')}
              columns={columns}
              rows={rows}
              exportName="composition"
            />
          ) : (
            <Pending state={stats} height={placeholderHeight} message={t('summary.composition.pending')} />
          )}
        </div>
        <div class="composition-chart">
          {ready ? (
            protein ? (
              <AminoAcidCompositionChart counts={ready.counts} height={CHART_HEIGHT} />
            ) : (
              <NucleotideCompositionChart
                counts={ready.counts}
                alphabet={alphabet === 'rna' ? 'rna' : 'dna'}
                height={CHART_HEIGHT}
              />
            )
          ) : (
            <Pending state={stats} height={CHART_HEIGHT} message={t('summary.composition.pending')} />
          )}
        </div>
      </div>
    </Section>
  );
}
