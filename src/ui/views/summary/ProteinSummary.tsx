import { useAnalysis } from '../../../state/analysis';
import type { SeqDocument } from '../../../state/documents';
import { settings, useAdvanced } from '../../../state/settings';
import { t } from '../../i18n';
import { ProteinCharts } from './ChartsSection';
import { CompositionSection } from './CompositionSection';
import { buildKpis, KpiGrid, type PiSource } from './Kpis';
import { formatFixed } from './model';
import { OrganismCard } from './OrganismCard';
import { ProteinSection, type ProteinSource } from './ProteinSection';
import { RecordHeader } from './RecordHeader';

/** The Summary of a protein record: its own properties and a hydropathy curve in place of the nucleotide scans. */
export function ProteinSummary({ doc }: { readonly doc: SeqDocument }) {
  const language = settings.value.language;
  const advanced = useAdvanced();
  const { record } = doc;
  const stats = useAnalysis(doc, 'summary', {});
  const organism = useAnalysis(doc, 'organism', {});
  const properties = stats.status === 'ready' ? stats.value.protein : undefined;

  const pi: PiSource =
    stats.status === 'pending'
      ? { kind: 'pending' }
      : !properties || !Number.isFinite(properties.isoelectricPoint)
        ? { kind: 'failed' }
        : {
            kind: 'ready',
            value: properties.isoelectricPoint,
            note: t('summary.kpi.piProtein', { charge: formatFixed(properties.charge, 2, language) }),
          };
  const source: ProteinSource =
    stats.status === 'failed'
      ? { kind: 'failed', reason: stats.reason }
      : properties
        ? { kind: 'ready', properties }
        : { kind: 'pending' };

  const cards = buildKpis({
    record,
    language,
    stats,
    reading: { topology: record.topology, basis: 'stated' },
    pi,
    topologyControl: null,
  });

  return (
    <div class="summary" data-testid="summary">
      <RecordHeader record={record} cards={cards} />
      <div class="summary-hero">
        <OrganismCard state={organism} language={language} advanced={advanced} />
        <div class="summary-hero-side">
          {stats.status === 'failed' && (
            <p class="summary-error">{t('summary.stats.failed', { reason: stats.reason })}</p>
          )}
          <KpiGrid cards={cards} />
        </div>
      </div>
      <CompositionSection stats={stats} alphabet="protein" length={record.seq.length} language={language} />
      <ProteinCharts doc={doc} advanced={advanced} />
      <ProteinSection
        source={source}
        title={t('summary.section.protein')}
        language={language}
        minCodons={0}
      />
    </div>
  );
}
