import { AMINO_ACIDS } from '../../engine/alphabet';
import type { CodonUsageRow, WindowSeries } from '../../engine/composition';
import type { MessageKey } from '../i18n';
import { t } from '../i18n';
import { Chart, type ChartProps } from './Chart';
import type { XYSeries } from './chartData';
import { SERIES_COLORS } from './colors';
import { formatNumber } from './scale';

/** Props every configured chart passes through to `Chart`. */
type Shared = Pick<ChartProps, 'height' | 'brush' | 'onBrush' | 'exportName'>;

interface WindowChartProps extends Shared {
  /** The engine's window series (`nucleotideSeries`, `cumulativeGcSkew`, `hydropathyProfile`). */
  readonly series: WindowSeries;
  /** Length of the sequence, to start the x axis at 0 and end it at the last base. */
  readonly seqLength?: number;
  /** Axis label of the x axis. Default: position in bp. */
  readonly xLabel?: string;
}

const percentTick = (v: number) => `${Math.round(v * 100)}%`;
const percentValue = (v: number) => `${(v * 100).toFixed(1)}%`;

function windowLine(
  name: string,
  ws: WindowSeries,
  seqLength: number | undefined,
  extra: Partial<XYSeries> = {},
): XYSeries {
  return {
    kind: 'line',
    name,
    x: ws.starts,
    y: ws.values,
    xOffset: ws.window / 2,
    describe: (i) => {
      const start = ws.starts[i] as number;
      return t('chart.bpRange', {
        start: start + 1,
        end: Math.min(start + ws.window, seqLength ?? Number.POSITIVE_INFINITY),
      });
    },
    ...extra,
  };
}

interface WindowConfig {
  readonly title: MessageKey;
  readonly axis: MessageKey;
  readonly yDomain?: readonly [number, number];
  readonly fraction?: boolean;
  readonly decimals?: number;
}

function WindowChart({
  config,
  series,
  seqLength,
  xLabel,
  ...rest
}: WindowChartProps & { config: WindowConfig }) {
  const title = t(config.title);
  const format = config.fraction ? percentValue : (v: number) => formatNumber(v, config.decimals ?? 2);
  return (
    <Chart
      title={title}
      series={[windowLine(title, series, seqLength, { format })]}
      xLabel={xLabel ?? t('chart.position')}
      yLabel={t(config.axis)}
      brush
      {...(seqLength === undefined ? {} : { xDomain: [0, seqLength] as const })}
      {...(config.yDomain ? { yDomain: config.yDomain } : {})}
      {...(config.fraction ? { formatY: percentTick } : {})}
      {...rest}
    />
  );
}

/** GC content over position. Takes `nucleotideSeries(seq, 'gc', ...)`. */
export function GcContentChart(props: WindowChartProps) {
  return (
    <WindowChart
      {...props}
      config={{ title: 'chart.title.gc', axis: 'chart.axis.percent', yDomain: [0, 1], fraction: true }}
    />
  );
}

/** AT content over position. Takes `nucleotideSeries(seq, 'at', ...)`. */
export function AtContentChart(props: WindowChartProps) {
  return (
    <WindowChart
      {...props}
      config={{ title: 'chart.title.at', axis: 'chart.axis.percent', yDomain: [0, 1], fraction: true }}
    />
  );
}

/** GC skew over position. Takes `nucleotideSeries(seq, 'gcSkew', ...)` or `cumulativeGcSkew`. */
export function GcSkewChart(props: WindowChartProps) {
  return (
    <WindowChart {...props} config={{ title: 'chart.title.gcSkew', axis: 'chart.axis.skew', decimals: 3 }} />
  );
}

/** Shannon entropy of the base composition over position. Takes `nucleotideSeries(seq, 'complexity', ...)`. */
export function ComplexityChart(props: WindowChartProps) {
  return (
    <WindowChart
      {...props}
      config={{ title: 'chart.title.complexity', axis: 'chart.axis.entropy', yDomain: [0, 2], decimals: 2 }}
    />
  );
}

/** Melting temperature over position. Takes `nucleotideSeries(seq, 'tm', ...)`. */
export function TmChart(props: WindowChartProps) {
  return <WindowChart {...props} config={{ title: 'chart.title.tm', axis: 'chart.axis.tm', decimals: 1 }} />;
}

/** Kyte-Doolittle hydropathy over residues. Takes `hydropathyProfile(protein, window)`. */
export function HydropathyChart({ xLabel, ...props }: WindowChartProps) {
  return (
    <WindowChart
      {...props}
      xLabel={xLabel ?? t('chart.residue')}
      config={{ title: 'chart.title.hydropathy', axis: 'chart.axis.hydropathy', decimals: 2 }}
    />
  );
}

/** Purine and pyrimidine content over position. Takes the `purine` and `pyrimidine` window series. */
export function PurinePyrimidineChart({
  purine,
  pyrimidine,
  seqLength,
  xLabel,
  ...rest
}: Shared & {
  readonly purine: WindowSeries;
  readonly pyrimidine: WindowSeries;
  readonly seqLength?: number;
  readonly xLabel?: string;
}) {
  return (
    <Chart
      title={t('chart.title.purine')}
      series={[
        windowLine(t('chart.series.purine'), purine, seqLength, { format: percentValue }),
        windowLine(t('chart.series.pyrimidine'), pyrimidine, seqLength, {
          format: percentValue,
          color: SERIES_COLORS[1],
        }),
      ]}
      xLabel={xLabel ?? t('chart.position')}
      yLabel={t('chart.axis.percent')}
      yDomain={[0, 1]}
      formatY={percentTick}
      brush
      {...(seqLength === undefined ? {} : { xDomain: [0, seqLength] as const })}
      {...rest}
    />
  );
}

const CODON_METRICS = {
  perThousand: { axis: 'chart.axis.perThousand', pick: (row: CodonUsageRow) => row.perThousand, decimals: 1 },
  rscu: { axis: 'chart.axis.rscu', pick: (row: CodonUsageRow) => row.rscu, decimals: 2 },
  count: { axis: 'chart.axis.count', pick: (row: CodonUsageRow) => row.count, decimals: 0 },
} as const satisfies Record<
  string,
  { axis: MessageKey; pick: (row: CodonUsageRow) => number; decimals: number }
>;

/** Codon bars in genetic-code table order; synonymous codons share a color. Takes `codonUsage(...).rows`. */
export function CodonUsageChart({
  rows,
  metric = 'perThousand',
  ...rest
}: Shared & { readonly rows: readonly CodonUsageRow[]; readonly metric?: keyof typeof CODON_METRICS }) {
  const { axis, pick, decimals } = CODON_METRICS[metric];
  let family = -1;
  let previous = '';
  const colors = rows.map((row) => {
    if (row.aminoAcid !== previous) family++;
    previous = row.aminoAcid;
    return SERIES_COLORS[family % 2] as string;
  });
  const title = t('chart.title.codonUsage');
  return (
    <Chart
      title={title}
      categories={rows.map((row) => row.codon)}
      series={[
        {
          kind: 'bar',
          name: t(axis),
          values: rows.map(pick),
          colors,
          format: (v) => formatNumber(v, decimals),
          describe: (i) => `${rows[i]?.codon} (${rows[i]?.aminoAcid})`,
        },
      ]}
      xLabel={t('chart.codon')}
      yLabel={t(axis)}
      {...rest}
    />
  );
}

/** Percent bars of a set of letters. Counts of other letters are left out of the total. */
function CompositionChart({
  letters,
  counts,
  title,
  xLabel,
  ...rest
}: Shared & {
  readonly letters: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
  readonly title: MessageKey;
  readonly xLabel: MessageKey;
}) {
  const total = letters.reduce((sum, letter) => sum + (counts[letter] ?? 0), 0);
  const percent = letters.map((letter) => (total === 0 ? 0 : (100 * (counts[letter] ?? 0)) / total));
  return (
    <Chart
      title={t(title)}
      categories={letters}
      series={[
        {
          kind: 'bar',
          name: t('chart.axis.percent'),
          values: percent,
          format: (v) => `${v.toFixed(1)}%`,
          describe: (i) => `${letters[i]}: ${counts[letters[i] as string] ?? 0}`,
        },
      ]}
      xLabel={t(xLabel)}
      yLabel={t('chart.axis.percent')}
      formatY={(v) => `${formatNumber(v, 0)}%`}
      {...rest}
    />
  );
}

/** Share of each of the 20 amino acids. Takes `countLetters(protein)`. */
export function AminoAcidCompositionChart({
  counts,
  ...rest
}: Shared & { readonly counts: Readonly<Record<string, number>> }) {
  return (
    <CompositionChart
      {...rest}
      letters={[...AMINO_ACIDS]}
      counts={counts}
      title="chart.title.aminoAcids"
      xLabel="chart.residue"
    />
  );
}

/** Share of A, C, G and T (or U). Takes `countLetters(seq)`. */
export function NucleotideCompositionChart({
  counts,
  alphabet = 'dna',
  ...rest
}: Shared & { readonly counts: Readonly<Record<string, number>>; readonly alphabet?: 'dna' | 'rna' }) {
  return (
    <CompositionChart
      {...rest}
      letters={alphabet === 'rna' ? ['A', 'C', 'G', 'U'] : ['A', 'C', 'G', 'T']}
      counts={counts}
      title="chart.title.nucleotides"
      xLabel="chart.residue"
    />
  );
}
