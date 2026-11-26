import { useMemo, useState } from 'preact/hooks';
import { proteinProperties } from '../../../engine/summary';
import { useAnalysis } from '../../../state/analysis';
import type { SeqDocument } from '../../../state/documents';
import { settings, useAdvanced } from '../../../state/settings';
import { t } from '../../i18n';
import { BaseStrip } from './BaseStrip';
import { NucleotideCharts } from './ChartsSection';
import { CompositionSection } from './CompositionSection';
import { FeaturesSection } from './FeaturesSection';
import { buildKpis, KpiGrid, type PiSource } from './Kpis';
import { compositionRows, formatInt, longestOrfs, minOrfCodons, readTopology, statesTopology } from './model';
import { OrganismCard } from './OrganismCard';
import { ProteinSection, type ProteinSource } from './ProteinSection';
import { RecordHeader } from './RecordHeader';
import { TopologyControl } from './TopologyControl';
import { topologyChosen } from './topology';

const PICKABLE_ORFS = 10;

/** The Summary of a DNA or RNA record. */
export function NucleotideSummary({ doc }: { readonly doc: SeqDocument }) {
  const language = settings.value.language;
  const advanced = useAdvanced();
  const { record } = doc;
  const length = record.seq.length;

  const stats = useAnalysis(doc, 'summary', {});
  const organism = useAnalysis(doc, 'organism', {});
  const minCodons = minOrfCodons(length);
  const orfs = useAnalysis(doc, 'orfs', { minCodons });
  const [picked, setPicked] = useState(0);

  const reading = readTopology(
    record,
    topologyChosen(doc.id),
    organism.status === 'ready' ? organism.value : organism.status,
  );

  const orfList = orfs.status === 'ready' ? orfs.value : null;
  const choices = useMemo(() => (orfList ? longestOrfs(orfList, PICKABLE_ORFS) : []), [orfList]);
  const index = Math.min(picked, Math.max(0, choices.length - 1));
  const orf = choices[index];
  const properties = useMemo(() => (orf ? proteinProperties(orf.protein) : null), [orf]);

  const pi: PiSource =
    orfs.status === 'pending'
      ? { kind: 'pending' }
      : orfs.status === 'failed'
        ? { kind: 'failed' }
        : !orf || !properties || !Number.isFinite(properties.isoelectricPoint)
          ? { kind: 'none' }
          : {
              kind: 'ready',
              value: properties.isoelectricPoint,
              note: t('summary.kpi.piOrf', { length: formatInt(orf.lengthAa, language) }),
            };

  const source: ProteinSource =
    orfs.status === 'failed'
      ? { kind: 'failed', reason: orfs.reason }
      : orfs.status === 'pending'
        ? { kind: 'pending' }
        : properties
          ? { kind: 'ready', properties, picker: { orfs: choices, index, onPick: setPicked } }
          : { kind: 'none' };

  const showControl = !statesTopology(record) || advanced;
  const cards = buildKpis({
    record,
    language,
    stats,
    reading,
    pi,
    topologyControl: showControl ? (
      <TopologyControl docId={doc.id} current={record.topology} reading={reading} />
    ) : null,
  });
  const rows = stats.status === 'ready' ? compositionRows(stats.value.counts, record.alphabet, length) : null;

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
          <div class="bracket-box strip-card" aria-busy={rows === null}>
            <div class="bracket-inner" />
            <div class="field-label">{t('summary.strip.title')}</div>
            {rows ? (
              <BaseStrip rows={rows} alphabet={record.alphabet} language={language} />
            ) : (
              <div class="strip-placeholder" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
      <CompositionSection stats={stats} alphabet={record.alphabet} length={length} language={language} />
      <NucleotideCharts doc={doc} advanced={advanced} />
      <FeaturesSection doc={doc} language={language} />
      <ProteinSection
        source={source}
        title={t('summary.section.translation')}
        language={language}
        minCodons={minCodons}
      />
    </div>
  );
}
