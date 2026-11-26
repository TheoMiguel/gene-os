import { useMemo } from 'preact/hooks';
import { reverseComplement } from '../../engine/alphabet';
import { codonUsage } from '../../engine/composition';
import { extractLocation, regionStart } from '../../engine/location';
import { ALL_FRAMES, type Frame, GENETIC_CODES } from '../../engine/translate';
import { useAnalysis } from '../../state/analysis';
import type { SeqDocument } from '../../state/documents';
import { useAdvanced } from '../../state/settings';
import { viewOf } from '../../state/view';
import { t } from '../i18n';
import { type CodonMetric, type CodonScope, codonSessionOf } from './codons/codonSession';
import { REFERENCE_TABLES } from './codons/references';
import { UsageReport, type UsageState } from './codons/UsageReport';
import './codons/codons.css';
import { SegmentedField, SelectField } from './proteins/controls';
import { frameLabel } from './proteins/orfRows';
import { orfSessionOf, resolveSelectedOrf, scanParams } from './proteins/orfSession';
import './proteins/proteins.css';

interface SourceProps {
  readonly doc: SeqDocument;
  readonly table: number;
}

const PENDING: UsageState = { status: 'pending' };

/** Codons of the ORF the user picked in the Proteins view or selected in the sequence. */
function SelectedOrfSource({ doc, table }: SourceProps) {
  const session = orfSessionOf(doc.id);
  const view = viewOf(doc.id);
  const orfs = useAnalysis(doc, 'orfs', scanParams(session.settings.value));
  const selected =
    orfs.status === 'ready'
      ? resolveSelectedOrf(orfs.value, session.picked.value, view.selection.value)
      : null;
  const state = useMemo((): UsageState => {
    if (orfs.status === 'pending') return PENDING;
    if (orfs.status === 'failed') return orfs;
    if (!selected) return { status: 'empty', message: t('codons.empty.noOrf'), goToProteins: true };
    const { record } = doc;
    const usage = codonUsage(extractLocation(record.seq, selected.location, record.alphabet), { table });
    return {
      status: 'ready',
      ...usage,
      label: t('codons.label.orf', {
        start: (regionStart(selected.location) + 1).toLocaleString(),
        frame: frameLabel(selected.frame),
        aa: selected.lengthAa.toLocaleString(),
      }),
    };
  }, [orfs, selected, table, doc.record]);
  return <UsageReport doc={doc} state={state} />;
}

/** Codons of every ORF the current search finds, counted together. */
function AllOrfsSource({ doc, table }: SourceProps) {
  const orfs = useAnalysis(doc, 'orfs', scanParams(orfSessionOf(doc.id).settings.value));
  const state = useMemo((): UsageState => {
    if (orfs.status === 'pending') return PENDING;
    if (orfs.status === 'failed') return orfs;
    if (orfs.value.length === 0)
      return { status: 'empty', message: t('codons.empty.noOrfs'), goToProteins: true };
    const { record } = doc;
    const coding = orfs.value
      .map((orf) => extractLocation(record.seq, orf.location, record.alphabet))
      .join('');
    return {
      status: 'ready',
      ...codonUsage(coding, { table }),
      label: t('codons.label.all', { count: orfs.value.length.toLocaleString() }),
    };
  }, [orfs, table, doc.record]);
  return <UsageReport doc={doc} state={state} />;
}

/** Codons of the whole sequence read in one forward frame, counted in the worker. */
function ForwardFrameSource({ doc, table, frame }: SourceProps & { readonly frame: 1 | 2 | 3 }) {
  const usage = useAnalysis(doc, 'codonUsage', { table, frame: (frame - 1) as 0 | 1 | 2 });
  const state = useMemo(
    (): UsageState =>
      usage.status === 'ready'
        ? { status: 'ready', ...usage.value, label: t('codons.label.frame', { frame: frameLabel(frame) }) }
        : usage.status === 'failed'
          ? usage
          : PENDING,
    [usage, frame],
  );
  return <UsageReport doc={doc} state={state} />;
}

/** Codons of the whole sequence read in one reverse frame, counted on the reverse complement. */
function ReverseFrameSource({ doc, table, frame }: SourceProps & { readonly frame: -1 | -2 | -3 }) {
  const { seq, alphabet } = doc.record;
  const state = useMemo(
    (): UsageState => ({
      status: 'ready',
      ...codonUsage(reverseComplement(seq, alphabet), { table, frame: (-frame - 1) as 0 | 1 | 2 }),
      label: t('codons.label.frame', { frame: frameLabel(frame) }),
    }),
    [seq, alphabet, table, frame],
  );
  return <UsageReport doc={doc} state={state} />;
}

function Source({
  doc,
  scope,
  frame,
  table,
}: SourceProps & { readonly scope: CodonScope; readonly frame: Frame }) {
  if (scope === 'orf') return <SelectedOrfSource doc={doc} table={table} />;
  if (scope === 'all') return <AllOrfsSource doc={doc} table={table} />;
  return frame > 0 ? (
    <ForwardFrameSource doc={doc} table={table} frame={frame as 1 | 2 | 3} />
  ) : (
    <ReverseFrameSource doc={doc} table={table} frame={frame as -1 | -2 | -3} />
  );
}

/** The codons view: usage tally, chart, comparison with a reference organism and amino-acid composition. */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  const advanced = useAdvanced();
  const session = codonSessionOf(doc.id);
  const orfSession = orfSessionOf(doc.id);
  const scope = session.scope.value;
  const frame = session.frame.value;
  const table = orfSession.settings.value.table;

  if (doc.record.alphabet === 'protein') {
    return (
      <div class="pv">
        <p class="pv-status">{t('codons.protein')}</p>
      </div>
    );
  }

  const standardCode = table === 1;
  return (
    <div class="pv">
      <div class="bracket-box pv-card pv-controls">
        <div class="bracket-inner" />
        <SegmentedField<CodonScope>
          legend={t('codons.scope')}
          name={`${doc.id}-cv-scope`}
          value={scope}
          options={[
            { value: 'orf', label: t('codons.scope.orf') },
            { value: 'all', label: t('codons.scope.all') },
            { value: 'frame', label: t('codons.scope.frame') },
          ]}
          onChange={(next) => {
            session.scope.value = next;
          }}
        />
        {scope === 'frame' && (
          <SelectField<Frame>
            id={`${doc.id}-cv-frame`}
            label={t('codons.frame')}
            value={frame}
            options={ALL_FRAMES.map((value) => ({ value, label: frameLabel(value) }))}
            onChange={(next) => {
              session.frame.value = next;
            }}
          />
        )}
        <SegmentedField<CodonMetric>
          legend={t('codons.metric')}
          name={`${doc.id}-cv-metric`}
          value={session.metric.value}
          options={[
            { value: 'count', label: t('codons.metric.count') },
            { value: 'perThousand', label: t('codons.metric.perThousand') },
            { value: 'rscu', label: t('codons.metric.rscu') },
          ]}
          onChange={(next) => {
            session.metric.value = next;
          }}
        />
        <div class="view-field">
          <SelectField<string>
            id={`${doc.id}-cv-reference`}
            label={t('codons.reference')}
            value={session.reference.value ?? 'none'}
            options={[
              { value: 'none', label: t('codons.reference.none') },
              ...REFERENCE_TABLES.map((reference) => ({
                value: reference.id,
                label: `${reference.host} (${reference.name})`,
              })),
            ]}
            onChange={(next) => {
              session.reference.value = next === 'none' ? null : next;
            }}
          />
          {!standardCode && session.reference.value !== null && (
            <p class="pv-note">{t('codons.reference.standardOnly')}</p>
          )}
        </div>
        {advanced && (
          <SelectField<number>
            id={`${doc.id}-cv-code`}
            label={t('proteins.param.table')}
            value={table}
            options={GENETIC_CODES.map((code) => ({ value: code.id, label: `${code.id}. ${code.name}` }))}
            onChange={(next) => {
              orfSession.settings.value = { ...orfSession.settings.value, table: next };
            }}
          />
        )}
      </div>
      <Source doc={doc} scope={scope} frame={frame} table={table} />
    </div>
  );
}
