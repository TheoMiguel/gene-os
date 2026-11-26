import { useEffect, useMemo, useState } from 'preact/hooks';
import { type SeqDocument, workspace } from '../../state/documents';
import { viewOf } from '../../state/view';
import { t } from '../i18n';
import type { AlignJob } from './alignment/execute';
import {
  type AlignSetup,
  type AlignSource,
  alphabetOf,
  buildItems,
  formatCells,
  parseScores,
} from './alignment/model';
import { AlignmentResult } from './alignment/Results';
import { AlignSetupForm } from './alignment/Setup';
import { alignPanelOf, cancelAlignment, type RunState, runAlignment } from './alignment/store';
import './alignment/alignment.css';

function TooLarge({ state }: { readonly state: Extract<RunState, { status: 'too-large' }> }) {
  const cells = formatCells(state.cells);
  const limit = formatCells(state.limit);
  return (
    <div class="aln-notice bracket-box" role="status">
      <div class="bracket-inner" />
      <h3 class="stage-title">{t('align.tooLarge.title')}</h3>
      {state.kind === 'pair' ? (
        <p>{t('align.tooLarge.pair', { cells, limit, mode: t(`align.method.${state.mode}`) })}</p>
      ) : (
        <p>{t('align.tooLarge.msa', { cells, limit })}</p>
      )}
      <ul>
        <li>{t('align.tooLarge.region')}</li>
        {state.kind === 'pair' && state.mode !== 'global' && <li>{t('align.tooLarge.global')}</li>}
        {state.kind === 'msa' && <li>{t('align.tooLarge.msaAdvice')}</li>}
      </ul>
    </div>
  );
}

function Running({
  state,
  docId,
}: {
  readonly state: Extract<RunState, { status: 'running' }>;
  readonly docId: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  const seconds = ((performance.now() - state.startedAt) / 1000).toFixed(1);
  return (
    <div class="aln-notice bracket-box" role="status" aria-live="polite">
      <div class="bracket-inner" />
      <p>{t('align.running', { count: state.count, seconds })}</p>
      <p class="aln-hint">{t('align.runningHint')}</p>
      <button type="button" class="secondary" onClick={() => cancelAlignment(docId)}>
        {t('align.cancel')}
      </button>
    </div>
  );
}

/** The alignment view: choose sequences and a method, run off the main thread, read the aligned rows. */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  const { setup, run } = alignPanelOf(doc.id);
  const documents = workspace.documents.value;
  const sources: AlignSource[] = documents.map((d) => ({
    id: d.id,
    name: d.record.name,
    seq: d.record.seq,
    protein: d.record.alphabet === 'protein',
    selection: viewOf(d.id).selection.value,
  }));
  const current = setup.value;
  const selections = sources.map((s) => `${s.selection?.start}-${s.selection?.end}`).join();
  const items = useMemo(
    () => buildItems(current, sources, t('align.pastedName')),
    [current, documents, selections],
  );
  const alphabet = useMemo(() => (items.length > 0 ? alphabetOf(items) : 'dna'), [items]);
  const scores = parseScores(current, alphabet === 'protein' ? 'protein' : 'dna');
  const invalid = scores.ok ? [] : scores.invalid;
  const state = run.value;
  const canRun = items.length >= 2 && alphabet !== 'mixed' && scores.ok && state.status !== 'running';

  const onChange = (patch: Partial<AlignSetup>) => {
    setup.value = { ...setup.value, ...patch };
  };

  const start = () => {
    if (!scores.ok || items.length < 2) return;
    const job: AlignJob =
      items.length === 2
        ? {
            kind: 'pair',
            a: (items[0] as { seq: string }).seq,
            b: (items[1] as { seq: string }).seq,
            options: { ...scores.options, mode: current.mode },
          }
        : {
            kind: 'msa',
            seqs: items.map((item) => item.seq),
            options: { ...scores.options, distance: current.distance },
          };
    runAlignment(doc.id, job, items);
  };

  return (
    <div class="aln-view">
      <AlignSetupForm
        sources={sources}
        setup={current}
        onChange={onChange}
        count={items.length}
        alphabet={alphabet}
        invalid={invalid}
      />
      <div class="aln-actions aln-run">
        <button type="button" class="primary-btn" disabled={!canRun} onClick={start}>
          {t('align.run')}
        </button>
        {invalid.length > 0 && (
          <span class="aln-warning" role="alert">
            {t('align.scores.invalid')}
          </span>
        )}
      </div>
      {state.status === 'idle' && <p class="aln-empty">{t('align.empty')}</p>}
      {state.status === 'running' && <Running state={state} docId={doc.id} />}
      {state.status === 'failed' && (
        <p class="aln-warning" role="alert">
          {t('align.failed', { message: state.message })}
        </p>
      )}
      {state.status === 'too-large' && <TooLarge state={state} />}
      {state.status === 'done' && state.setup !== current && (
        <p class="aln-hint" role="status">
          {t('align.stale')}
        </p>
      )}
      {state.status === 'done' && <AlignmentResult key={state.id} done={state} />}
    </div>
  );
}
