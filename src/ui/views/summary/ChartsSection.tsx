import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { WindowSeries } from '../../../engine/composition';
import { type AnalysisState, useAnalysis } from '../../../state/analysis';
import type { SeqDocument } from '../../../state/documents';
import { t } from '../../i18n';
import { GcContentChart, GcSkewChart, HydropathyChart } from '../../viz';
import { clampWindow, defaultHydropathyWindow, defaultWindow, windowStep } from './model';
import { Pending } from './Pending';
import { Section } from './Section';

const CHART_HEIGHT = 230;

/**
 * Draws the latest finished result. While a new scan runs (the user changed the window) the previous curve stays,
 * dimmed, so the chart does not blink to an empty box. The first scan, and a failed one, show a box of the chart's size.
 */
function Plot<T>({
  state,
  render,
}: {
  readonly state: AnalysisState<T>;
  readonly render: (value: T) => ComponentChildren;
}) {
  const last = useRef<T | null>(null);
  if (state.status === 'ready') last.current = state.value;
  if (last.current !== null)
    return (
      <div class={`plot${state.status === 'pending' ? ' stale' : ''}`} aria-busy={state.status === 'pending'}>
        {render(last.current)}
        {state.status === 'failed' && (
          <p class="summary-error">{t('summary.failed', { reason: state.reason })}</p>
        )}
      </div>
    );
  return <Pending state={state} height={CHART_HEIGHT + 24} message={t('summary.charts.pending')} />;
}

interface WindowedProps {
  readonly doc: SeqDocument;
  readonly window: number;
}

function GcContentPlot({ doc, window }: WindowedProps) {
  const state = useAnalysis(doc, 'nucleotideSeries', { kind: 'gc', window, step: windowStep(window) });
  return (
    <Plot
      state={state}
      render={(series: WindowSeries) => (
        <GcContentChart
          series={series}
          seqLength={doc.record.seq.length}
          height={CHART_HEIGHT}
          exportName="gc-content"
        />
      )}
    />
  );
}

function GcSkewPlot({ doc, window }: WindowedProps) {
  const state = useAnalysis(doc, 'nucleotideSeries', { kind: 'gcSkew', window, step: windowStep(window) });
  return (
    <Plot
      state={state}
      render={(series: WindowSeries) => (
        <GcSkewChart
          series={series}
          seqLength={doc.record.seq.length}
          height={CHART_HEIGHT}
          exportName="gc-skew"
        />
      )}
    />
  );
}

function CumulativeSkewPlot({ doc, window }: WindowedProps) {
  const state = useAnalysis(doc, 'cumulativeGcSkew', { window });
  return (
    <div class="plot-with-note">
      <p class="plot-note">{t('summary.charts.cumulativeNote')}</p>
      <Plot
        state={state}
        render={(series: WindowSeries) => (
          <GcSkewChart
            series={series}
            seqLength={doc.record.seq.length}
            height={CHART_HEIGHT}
            exportName="cumulative-gc-skew"
          />
        )}
      />
    </div>
  );
}

function HydropathyPlot({ doc, window }: WindowedProps) {
  const state = useAnalysis(doc, 'hydropathy', { window });
  return (
    <Plot
      state={state}
      render={(series: WindowSeries) => (
        <HydropathyChart
          series={series}
          seqLength={doc.record.seq.length}
          height={CHART_HEIGHT}
          exportName="hydropathy"
        />
      )}
    />
  );
}

/** The window-size field of advanced mode. It commits on Enter or when it loses focus, and "Default" restores the derived size. */
function WindowField({
  value,
  fallback,
  length,
  unit,
  onChange,
}: {
  readonly value: number;
  readonly fallback: number;
  readonly length: number;
  readonly unit: string;
  readonly onChange: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    onChange(draft.trim() === '' || !Number.isFinite(parsed) ? null : clampWindow(parsed, length));
    setDraft(null);
  };
  return (
    <div class="window-field">
      <label class="field-label" for="summary-window">
        {t('summary.charts.window', { unit })}
      </label>
      <input
        id="summary-window"
        class="window-input"
        type="number"
        inputMode="numeric"
        min={Math.min(2, length)}
        max={length}
        value={draft ?? value}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      <button
        type="button"
        class="export-button"
        disabled={value === fallback}
        onClick={() => onChange(null)}
      >
        {t('summary.charts.windowReset', { value: fallback })}
      </button>
    </div>
  );
}

/**
 * GC content and GC skew along a DNA or RNA sequence. The window defaults to about 1% of the length, snapped to a round
 * number. Advanced mode lets the user set it and adds the cumulative skew, whose extremes mark the origin and the
 * terminus of replication in a bacterial genome.
 */
export function NucleotideCharts({
  doc,
  advanced,
}: {
  readonly doc: SeqDocument;
  readonly advanced: boolean;
}) {
  const length = doc.record.seq.length;
  const fallback = defaultWindow(length);
  const [custom, setCustom] = useState<number | null>(null);
  const window = custom === null ? fallback : clampWindow(custom, length);
  const scope = `${doc.id}:${length}:${doc.record.topology}`;

  return (
    <Section
      number="02"
      title={t('summary.section.charts')}
      actions={
        advanced && length >= 2 ? (
          <WindowField
            value={window}
            fallback={fallback}
            length={length}
            unit={t('summary.charts.unitBp')}
            onChange={setCustom}
          />
        ) : null
      }
    >
      {length < 2 ? (
        <p class="summary-empty">{t('summary.charts.tooShort')}</p>
      ) : (
        <div class="chart-grid">
          <GcContentPlot key={`gc:${scope}`} doc={doc} window={window} />
          <GcSkewPlot key={`skew:${scope}`} doc={doc} window={window} />
          {advanced && <CumulativeSkewPlot key={`cum:${scope}`} doc={doc} window={window} />}
        </div>
      )}
    </Section>
  );
}

/** The Kyte-Doolittle hydropathy curve of a protein, with the window size in advanced mode. */
export function ProteinCharts({ doc, advanced }: { readonly doc: SeqDocument; readonly advanced: boolean }) {
  const length = doc.record.seq.length;
  const fallback = defaultHydropathyWindow(length);
  const [custom, setCustom] = useState<number | null>(null);
  const window = custom === null ? fallback : clampWindow(custom, length);
  return (
    <Section
      number="02"
      title={t('summary.section.hydropathy')}
      actions={
        advanced && length >= 2 ? (
          <WindowField
            value={window}
            fallback={fallback}
            length={length}
            unit={t('summary.charts.unitAa')}
            onChange={setCustom}
          />
        ) : null
      }
    >
      {length < 2 ? (
        <p class="summary-empty">{t('summary.charts.tooShort')}</p>
      ) : (
        <div class="chart-grid single">
          <HydropathyPlot key={`${doc.id}:${length}`} doc={doc} window={window} />
        </div>
      )}
    </Section>
  );
}
