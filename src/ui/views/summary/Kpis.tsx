import type { ComponentChildren } from 'preact';
import type { SequenceSummary } from '../../../engine/summary';
import type { Alphabet, SeqRecord } from '../../../engine/types';
import type { AnalysisState } from '../../../state/analysis';
import type { Language } from '../../../state/settings';
import { t } from '../../i18n';
import {
  formatFixed,
  formatInt,
  formatLength,
  formatMass,
  formatPercent,
  roughSize,
  type TopologyBasis,
  type TopologyReading,
} from './model';

/** Where the isoelectric point of the molecule comes from. */
export type PiSource =
  | { readonly kind: 'pending' | 'failed' | 'none' }
  | { readonly kind: 'ready'; readonly value: number; readonly note: string };

/** One card of the grid. A `null` value or note means "still being calculated". */
export interface KpiCardData {
  readonly id: string;
  readonly label: string;
  readonly value: string | null;
  readonly sub: string | null;
  readonly extra?: ComponentChildren;
}

interface KpiInputs {
  readonly record: SeqRecord;
  readonly language: Language;
  readonly stats: AnalysisState<SequenceSummary>;
  readonly reading: TopologyReading;
  readonly pi: PiSource;
  readonly topologyControl: ComponentChildren;
}

const DASH = '—';

const TOPOLOGY_NOTE: Readonly<Record<Exclude<TopologyBasis, 'pending'>, Parameters<typeof t>[0]>> = {
  stated: 'summary.topology.stated',
  chosen: 'summary.topology.chosen',
  overlap: 'summary.topology.overlap',
  vector: 'summary.topology.vector',
  assumed: 'summary.topology.assumed',
  unavailable: 'summary.topology.unavailable',
};

function otherCharacters(stats: SequenceSummary, alphabet: Alphabet): number {
  const plain = alphabet === 'protein' ? 'ACDEFGHIKLMNPQRSTVWY' : alphabet === 'rna' ? 'ACGU' : 'ACGT';
  let count = 0;
  for (const [letter, n] of Object.entries(stats.counts)) if (!plain.includes(letter)) count += n;
  return count;
}

function typeSub(stats: SequenceSummary | null, alphabet: Alphabet, language: Language): string | null {
  if (!stats) return null;
  const other = otherCharacters(stats, alphabet);
  if (other > 0) return t('summary.kpi.otherChars', { count: formatInt(other, language) });
  return t(alphabet === 'protein' ? 'summary.kpi.standardResidues' : 'summary.kpi.plainBases');
}

function piCard(pi: PiSource, language: Language): Pick<KpiCardData, 'value' | 'sub'> {
  switch (pi.kind) {
    case 'pending':
      return { value: null, sub: null };
    case 'failed':
      return { value: DASH, sub: t('summary.kpi.piFailed') };
    case 'none':
      return { value: DASH, sub: t('summary.kpi.piNoOrf') };
    case 'ready':
      return { value: formatFixed(pi.value, 2, language), sub: pi.note };
  }
}

/** The KPI cards of the summary, in display order. A nucleotide record gets six, a protein four. */
export function buildKpis(inputs: KpiInputs): KpiCardData[] {
  const { record, language, stats, reading, pi, topologyControl } = inputs;
  const { alphabet } = record;
  const value = stats.status === 'ready' ? stats.value : null;
  const failed = stats.status === 'failed';
  const fromStats = (make: (s: SequenceSummary) => string): string | null =>
    value ? make(value) : failed ? DASH : null;

  const length: KpiCardData = {
    id: 'length',
    label: t('summary.kpi.length'),
    value: formatLength(record.seq.length, alphabet, language),
    sub: roughSize(record.seq.length, language) ?? ' ',
  };
  const type: KpiCardData = {
    id: 'type',
    label: t('summary.kpi.type'),
    value: t(`alphabet.${alphabet}`),
    sub: failed ? DASH : typeSub(value, alphabet, language),
  };
  const piData = piCard(pi, language);
  const piKpi: KpiCardData = { id: 'pi', label: t('summary.kpi.pi'), ...piData };

  if (alphabet === 'protein') {
    return [
      length,
      type,
      {
        id: 'weight',
        label: t('summary.kpi.weight'),
        value: fromStats((s) => formatMass(s.weight, language)),
        sub: value
          ? t('summary.kpi.weightProtein', { value: formatInt(Math.round(value.weight), language) })
          : failed
            ? DASH
            : null,
      },
      piKpi,
    ];
  }

  const topologyReady = reading.basis !== 'pending';
  return [
    length,
    type,
    {
      id: 'topology',
      label: t('summary.kpi.topology'),
      value: topologyReady ? t(`topology.${reading.topology}`) : null,
      sub: topologyReady ? t(TOPOLOGY_NOTE[reading.basis as Exclude<TopologyBasis, 'pending'>]) : null,
      extra: topologyControl,
    },
    {
      id: 'gc',
      label: t('summary.kpi.gc'),
      value: fromStats((s) => formatPercent(s.gc ?? 0, language)),
      sub: value
        ? t('summary.kpi.skew', { value: formatFixed(value.gcSkew ?? 0, 3, language) })
        : failed
          ? DASH
          : null,
    },
    {
      id: 'weight',
      label: t('summary.kpi.weight'),
      value: fromStats((s) => formatMass(s.weight, language)),
      sub: value
        ? t('summary.kpi.weightStrand', {
            double: formatMass(value.weightDoubleStranded ?? value.weight, language),
          })
        : failed
          ? DASH
          : null,
    },
    piKpi,
  ];
}

/** The grid of KPI cards. A card with a pending value reserves its final height and shows a quiet placeholder. */
export function KpiGrid({ cards }: { readonly cards: readonly KpiCardData[] }) {
  return (
    <div class={`kpi-grid${cards.length === 4 ? ' quad' : ''}`}>
      {cards.map((card) => {
        const pending = card.value === null;
        return (
          <div key={card.id} class="bracket-box kpi-card" data-kpi={card.id} aria-busy={pending}>
            <div class="bracket-inner" />
            <div class="kpi-title">{card.label}</div>
            <div class="kpi-val">
              {pending ? (
                <>
                  <span class="kpi-skeleton" aria-hidden="true" />
                  <span class="visually-hidden">{t('summary.pending')}</span>
                </>
              ) : (
                card.value
              )}
            </div>
            <div class="kpi-sub">
              {card.sub === null ? <span class="kpi-skeleton small" aria-hidden="true" /> : card.sub}
            </div>
            {card.extra}
          </div>
        );
      })}
    </div>
  );
}

/** The cards as tab-separated text, one `label<TAB>value<TAB>note` line each, for the clipboard. Pending cards are left out. */
export function kpiText(cards: readonly KpiCardData[]): string {
  return cards
    .filter((card) => card.value !== null)
    .map((card) => [card.label, card.value, (card.sub ?? '').trim()].join('\t'))
    .join('\n');
}
