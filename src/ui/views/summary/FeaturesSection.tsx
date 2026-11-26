import { useMemo } from 'preact/hooks';
import type { DetectedFeature } from '../../../engine/features';
import { locationLength } from '../../../engine/location';
import { useAnalysis } from '../../../state/analysis';
import { type SeqDocument, workspace } from '../../../state/documents';
import type { Language } from '../../../state/settings';
import { viewOf } from '../../../state/view';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { featureColor } from '../../viz';
import { type FeatureRow, featureRows, featureTypeCounts, formatFixed, formatInt } from './model';
import { Pending } from './Pending';
import { Section } from './Section';

const ROW_PX = 28;
const TABLE_CHROME_PX = 32 + 44;
const MAX_TABLE_PX = 340;

/** Opens the Sequence view of the document at the feature's first base. */
function openInSequence(doc: SeqDocument, row: FeatureRow): void {
  viewOf(doc.id).goTo(row.position);
  workspace.setActiveTab(doc.id, 'sequence');
}

function typeLabel(type: DetectedFeature['type']): string {
  return t(`summary.feature.${type}`);
}

/**
 * The known elements the detection scan found (promoters, origins, resistance markers, tags), as a table. A click on a
 * row, or Enter on it, opens the Sequence view at that position. The scan runs off the main thread.
 */
export function FeaturesSection({
  doc,
  language,
}: {
  readonly doc: SeqDocument;
  readonly language: Language;
}) {
  const state = useAnalysis(doc, 'features', {});
  const features = state.status === 'ready' ? state.value : null;
  const rows = useMemo(() => (features ? featureRows(features) : []), [features]);
  const counts = useMemo(() => (features ? featureTypeCounts(features) : []), [features]);

  const columns = useMemo(
    (): TableColumn<FeatureRow>[] => [
      { id: 'name', header: t('summary.features.name'), value: (row) => row.feature.name, width: 170 },
      {
        id: 'type',
        header: t('summary.features.type'),
        value: (row) => row.feature.type,
        format: (value) => typeLabel(value as DetectedFeature['type']),
        width: 170,
      },
      { id: 'location', header: t('summary.features.location'), value: (row) => row.location, width: 190 },
      {
        id: 'length',
        header: t('summary.features.length'),
        type: 'number',
        value: (row) => locationLength(row.feature.location),
        format: (value) => formatInt(Number(value), language),
        width: 90,
      },
      {
        id: 'strand',
        header: t('summary.features.strand'),
        value: (row) => (row.feature.location.strand === 1 ? '+' : '−'),
        width: 80,
      },
      {
        id: 'identity',
        header: t('summary.features.identity'),
        type: 'number',
        value: (row) => row.feature.identity * 100,
        format: (value) => `${formatFixed(Number(value), 1, language)}%`,
        width: 100,
      },
    ],
    [language],
  );

  const height = Math.min(MAX_TABLE_PX, Math.max(3, rows.length) * ROW_PX + TABLE_CHROME_PX);
  return (
    <Section number="03" title={t('summary.section.features')}>
      <p class="summary-hint">{t('summary.features.intro')}</p>
      {counts.length > 0 && (
        <ul class="feature-chips" aria-label={t('summary.features.counts')}>
          {counts.map(([type, count]) => (
            <li key={type} class="feature-chip">
              <span
                class="feature-swatch"
                style={{ background: featureColor({ type }) }}
                aria-hidden="true"
              />
              {typeLabel(type)}
              <b>{formatInt(count, language)}</b>
            </li>
          ))}
        </ul>
      )}
      {features === null ? (
        <Pending state={state} height={height} message={t('summary.features.pending')} />
      ) : rows.length === 0 ? (
        <p class="summary-empty">{t('summary.features.none')}</p>
      ) : (
        <div class="features-table" style={{ height: `${height}px` }}>
          <Table
            label={t('summary.features.table')}
            columns={columns}
            rows={rows}
            exportName="detected-features"
            onRowClick={(row) => openInSequence(doc, row)}
          />
        </div>
      )}
    </Section>
  );
}
