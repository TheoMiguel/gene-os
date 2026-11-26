import { useMemo, useState } from 'preact/hooks';
import type { Difference, MultipleAlignment, PairwiseAlignment } from '../../../engine/align';
import { copyText, downloadText, reportCopy, reportSave } from '../../export';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { AlignmentGrid, type GridReveal } from './AlignmentGrid';
import { GuideTreeView } from './GuideTreeView';
import {
  type AlignmentDisplay,
  differenceColumns,
  gapColumnCount,
  percent,
  residueColumns,
  toClustal,
  toFasta,
} from './model';
import type { RunState } from './store';

type Done = Extract<RunState, { status: 'done' }>;

function Kpi(props: { readonly label: string; readonly value: string; readonly hint?: string }) {
  return (
    <div class="aln-kpi bracket-box" title={props.hint}>
      <div class="bracket-inner" />
      <div class="aln-kpi-value">{props.value}</div>
      <div class="field-label">{props.label}</div>
    </div>
  );
}

/** Copy and save buttons for the aligned rows, as FASTA and as Clustal-style text. */
function TextExports({ display }: { readonly display: AlignmentDisplay }) {
  const fasta = () => toFasta(display.labels, display.rows);
  return (
    <fieldset class="aln-actions aln-fieldset">
      <legend class="visually-hidden">{t('align.export.title')}</legend>
      <button type="button" class="export-button" onClick={async () => reportCopy(await copyText(fasta()))}>
        {t('align.export.copyFasta')}
      </button>
      <button
        type="button"
        class="export-button"
        onClick={async () => reportSave(await downloadText(fasta(), 'alignment.fasta'))}
      >
        {t('align.export.saveFasta')}
      </button>
      <button
        type="button"
        class="export-button"
        onClick={async () =>
          reportSave(
            await downloadText(toClustal(display.labels, display.rows, display.classes), 'alignment.aln'),
          )
        }
      >
        {t('align.export.saveClustal')}
      </button>
    </fieldset>
  );
}

interface DifferenceRow {
  readonly n: number;
  readonly difference: Difference;
}

const clip = (text: string) => (text.length > 24 ? `${text.slice(0, 24)}… (${text.length})` : text);

const gapAt = (index: number) =>
  index === 0 ? t('align.diff.before', { pos: 1 }) : t('align.diff.between', { a: index, b: index + 1 });

function differenceColumnsOf(): TableColumn<DifferenceRow>[] {
  return [
    { id: 'n', header: '#', type: 'number', width: 60, value: (r) => r.n },
    {
      id: 'kind',
      header: t('align.diff.kind'),
      width: 110,
      value: (r) => r.difference.kind,
      format: (_, r) => t(`align.diff.${r.difference.kind}`),
    },
    {
      id: 'posA',
      header: t('align.diff.posA'),
      type: 'number',
      width: 150,
      value: (r) => (r.difference.kind === 'insertion' ? r.difference.refStart : r.difference.refStart + 1),
      format: (_, r) => {
        const d = r.difference;
        if (d.kind === 'insertion') return gapAt(d.refStart);
        return d.refEnd - d.refStart > 1 ? `${d.refStart + 1}–${d.refEnd}` : String(d.refStart + 1);
      },
    },
    {
      id: 'posB',
      header: t('align.diff.posB'),
      type: 'number',
      width: 150,
      value: (r) => (r.difference.kind === 'deletion' ? r.difference.altStart : r.difference.altStart + 1),
      format: (_, r) => {
        const d = r.difference;
        if (d.kind === 'deletion') return gapAt(d.altStart);
        return d.altEnd - d.altStart > 1 ? `${d.altStart + 1}–${d.altEnd}` : String(d.altStart + 1);
      },
    },
    {
      id: 'length',
      header: t('align.diff.length'),
      type: 'number',
      width: 80,
      value: (r) =>
        Math.max(r.difference.refEnd - r.difference.refStart, r.difference.altEnd - r.difference.altStart),
    },
    {
      id: 'from',
      header: t('align.diff.from'),
      width: 150,
      value: (r) => r.difference.ref,
      format: (v) => clip(String(v ?? '')),
    },
    {
      id: 'to',
      header: t('align.diff.to'),
      width: 150,
      value: (r) => r.difference.alt,
      format: (v) => clip(String(v ?? '')),
    },
    {
      id: 'edge',
      header: t('align.diff.edge'),
      width: 90,
      value: (r) => r.difference.terminal,
      format: (v) => (v ? t('align.diff.edgeYes') : ''),
    },
  ];
}

function PairResult(props: { readonly done: Extract<Done, { kind: 'pair' }> }) {
  const { alignment, display } = props.done;
  const [reveal, setReveal] = useState<GridReveal | null>(null);
  const rows = useMemo<DifferenceRow[]>(
    () => alignment.differences.map((difference, i) => ({ n: i + 1, difference })),
    [alignment],
  );
  const columns = useMemo(() => differenceColumnsOf(), []);
  const maps = useMemo(
    () => ({ a: residueColumns(alignment.alignedA), b: residueColumns(alignment.alignedB) }),
    [alignment],
  );
  const reveal1 = (row: DifferenceRow) => {
    const { from, to } = differenceColumns(
      row.difference,
      maps.a,
      maps.b,
      alignment.startA,
      alignment.startB,
    );
    setReveal((current) => ({ column: from, span: to - from, nonce: (current?.nonce ?? 0) + 1 }));
  };
  return (
    <>
      <PairKpis alignment={alignment} />
      {alignment.mode === 'local' && (
        <p class="aln-hint">
          {t('align.localCover', {
            a: `${alignment.startA + 1}–${alignment.endA}`,
            b: `${alignment.startB + 1}–${alignment.endB}`,
          })}
        </p>
      )}
      {alignment.mode === 'overlap' && <p class="aln-hint">{t('align.overlapNote')}</p>}
      <AlignmentGrid display={display} reveal={reveal} imageName="alignment" />
      <TextExports display={display} />
      <section class="aln-section" aria-labelledby="aln-diff-title">
        <h3 id="aln-diff-title" class="field-label">
          {t('align.diff.title', { count: alignment.differences.length.toLocaleString() })}
        </h3>
        <p class="aln-hint">
          {alignment.differences.length === 0 ? t('align.diff.none') : t('align.diff.hint')}
        </p>
        <div class="aln-diff-table">
          <Table
            label={t('align.diff.title', { count: alignment.differences.length.toLocaleString() })}
            columns={columns}
            rows={rows}
            exportName="alignment-differences"
            onRowClick={reveal1}
          />
        </div>
      </section>
    </>
  );
}

function PairKpis({ alignment }: { readonly alignment: PairwiseAlignment }) {
  const { stats } = alignment;
  return (
    <div class="aln-kpis">
      <Kpi label={t('align.kpi.score')} value={String(+alignment.score.toFixed(2))} />
      <Kpi label={t('align.kpi.identity')} value={`${percent(stats.percentIdentity)}%`} />
      <Kpi label={t('align.kpi.similarity')} value={`${percent(stats.percentSimilarity)}%`} />
      <Kpi
        label={t('align.kpi.gaps')}
        value={stats.gapRuns.toLocaleString()}
        hint={t('align.kpi.gapsHint', { columns: stats.gapColumns.toLocaleString() })}
      />
      <Kpi label={t('align.kpi.length')} value={stats.length.toLocaleString()} />
      <Kpi label={t('align.kpi.mismatches')} value={stats.mismatches.toLocaleString()} />
    </div>
  );
}

function MsaResult(props: { readonly done: Extract<Done, { kind: 'msa' }> }) {
  const { alignment, display } = props.done;
  return (
    <>
      <MsaKpis alignment={alignment} display={display} />
      <AlignmentGrid display={display} reveal={null} imageName="alignment" />
      <TextExports display={display} />
      <GuideTreeView tree={alignment.guideTree} labels={display.labels} />
    </>
  );
}

function MsaKpis(props: { readonly alignment: MultipleAlignment; readonly display: AlignmentDisplay }) {
  const { alignment, display } = props;
  return (
    <div class="aln-kpis">
      <Kpi label={t('align.kpi.sequences')} value={String(alignment.rows.length)} />
      <Kpi label={t('align.kpi.length')} value={alignment.length.toLocaleString()} />
      <Kpi
        label={t('align.kpi.meanScore')}
        value={String(+alignment.score.toFixed(2))}
        hint={t('align.kpi.meanHint')}
      />
      <Kpi
        label={t('align.kpi.meanIdentity')}
        value={`${percent(alignment.percentIdentity)}%`}
        hint={t('align.kpi.meanHint')}
      />
      <Kpi
        label={t('align.kpi.meanSimilarity')}
        value={`${percent(alignment.percentSimilarity)}%`}
        hint={t('align.kpi.meanHint')}
      />
      <Kpi label={t('align.kpi.gapColumns')} value={gapColumnCount(display.classes).toLocaleString()} />
    </div>
  );
}

/** The result of a finished alignment: statistics, the display, exports, and the pair's or the group's extras. */
export function AlignmentResult({ done }: { readonly done: Done }) {
  const seconds = (done.elapsedMs / 1000).toFixed(done.elapsedMs < 1000 ? 2 : 1);
  return (
    <div class="aln-result">
      <p class="aln-hint">{t('align.elapsed', { seconds })}</p>
      {done.kind === 'pair' ? <PairResult done={done} /> : <MsaResult done={done} />}
    </div>
  );
}
