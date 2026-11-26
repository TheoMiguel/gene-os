import { useRef } from 'preact/hooks';
import type { OrganismInference } from '../../../engine/organism';
import type { AnalysisState } from '../../../state/analysis';
import type { Language } from '../../../state/settings';
import { ImageExportButtons } from '../../export/ImageExportButtons';
import { t } from '../../i18n';
import { formatFixed, formatInt, formatPercent } from './model';
import { OrganismArt } from './organismArt';

/** One plain sentence on what the call rests on, in the interface language. */
export function whyLine(inference: OrganismInference, language: Language): string {
  const { metrics, category } = inference;
  const params = {
    length: formatInt(metrics.length, language),
    gc: metrics.gc === undefined ? '' : formatPercent(metrics.gc, language),
    density: metrics.codingDensity === undefined ? '' : formatPercent(metrics.codingDensity, language, 0),
    parts: metrics.vectorParts.slice(0, 4).join(', '),
  };
  if (category === 'unknown')
    return t(
      metrics.codingDensity === undefined ? 'summary.org.why.unknownShort' : 'summary.org.why.unknown',
      params,
    );
  return t(`summary.org.why.${category}`, params);
}

function Metrics({ inference, language }: { inference: OrganismInference; language: Language }) {
  const { metrics } = inference;
  const rows: [string, string][] = [];
  if (metrics.gc !== undefined) rows.push([t('summary.org.metric.gc'), formatPercent(metrics.gc, language)]);
  if (metrics.codingDensity !== undefined)
    rows.push([t('summary.org.metric.coding'), formatPercent(metrics.codingDensity, language)]);
  if (metrics.gc3 !== undefined)
    rows.push([t('summary.org.metric.gc3'), formatPercent(metrics.gc3, language)]);
  if (metrics.cpgRatio !== undefined)
    rows.push([t('summary.org.metric.cpg'), formatFixed(metrics.cpgRatio, 2, language)]);
  if (metrics.vectorParts.length > 0)
    rows.push([t('summary.org.metric.parts'), formatInt(metrics.vectorParts.length, language)]);
  if (rows.length === 0) return null;
  return (
    <dl class="organism-metrics">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The organism card: the category the composition points to, a drawing of it, how sure the rule of thumb is and a
 * one-line reason. It always says that this is an inference, not an identification. While the scan runs the card
 * keeps its size, so the values arrive without moving anything.
 */
export function OrganismCard({
  state,
  language,
  advanced,
}: {
  readonly state: AnalysisState<OrganismInference>;
  readonly language: Language;
  readonly advanced: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const ready = state.status === 'ready' ? state.value : null;
  const category = ready?.category ?? 'unknown';

  const badge =
    state.status === 'pending'
      ? t('summary.org.pendingBadge')
      : state.status === 'failed'
        ? t('summary.org.failedBadge')
        : t('summary.org.badge');
  const title = ready
    ? t(`summary.org.cat.${ready.category}`)
    : state.status === 'pending'
      ? t('summary.org.pendingTitle')
      : t('summary.org.failedTitle');

  return (
    <section
      class="bracket-box organism-card"
      aria-labelledby="summary-organism-title"
      aria-busy={state.status === 'pending'}
    >
      <div class="bracket-inner" />
      <div class="organism-badge">{badge}</div>
      <h2 class="organism-title" id="summary-organism-title">
        {title}
      </h2>
      <div class={`organism-svg-wrap${ready ? '' : ' dim'}`}>
        <OrganismArt category={category} label={t(`summary.org.art.${category}`)} svgRef={svgRef} />
      </div>
      <div class="organism-confidence">
        {ready && (
          <>
            <span class="field-label">{t('summary.org.confidence')}</span>
            <meter min={0} max={1} value={ready.confidence} aria-label={t('summary.org.confidence')} />
            <span class="organism-confidence-value">{formatPercent(ready.confidence, language, 0)}</span>
          </>
        )}
      </div>
      <p class="organism-desc">
        {ready
          ? whyLine(ready, language)
          : state.status === 'pending'
            ? t('summary.org.pendingText')
            : t('summary.org.failedText', { reason: state.status === 'failed' ? state.reason : '' })}
      </p>
      {ready && advanced && <Metrics inference={ready} language={language} />}
      <p class="organism-disclaimer">{t('summary.org.disclaimer')}</p>
      <div class="organism-actions">
        {ready && <ImageExportButtons name="organism-inference" getSvg={() => svgRef.current} />}
      </div>
    </section>
  );
}
