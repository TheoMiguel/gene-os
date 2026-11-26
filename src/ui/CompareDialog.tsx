import { useEffect, useRef, useState } from 'preact/hooks';
import type { AlignMode } from '../engine/align';
import { projectName } from '../project/snapshot';
import { type ReportJob, type ReportStage, startReport } from '../report/generate';
import { pickReportLabels } from '../report/labels';
import { workspace } from '../state/documents';
import { settings } from '../state/settings';
import { notice, sfx } from './actions';
import { downloadBlob } from './export/download';
import { reportSave } from './export/feedback';
import { DICTIONARIES, type MessageKey, t } from './i18n';
import './ExportMenu.css';

const FOCUSABLE = 'button:not(:disabled), select, input';
const MODES: readonly AlignMode[] = ['global', 'local', 'overlap'];

/**
 * The comparison report dialog (spec 7.3): pick two open sequences and an alignment mode, and GENE_OS writes a PDF
 * on this computer. The work runs in a worker, shows its stage and can be cancelled.
 */
export function CompareDialog({ onClose }: { onClose: () => void }) {
  const docs = workspace.documents.value;
  const [aId, setAId] = useState(docs[0]?.id ?? '');
  const [bId, setBId] = useState(docs[1]?.id ?? '');
  const [mode, setMode] = useState<AlignMode>('global');
  const [stage, setStage] = useState<ReportStage | null>(null);
  const [failed, setFailed] = useState(false);
  const job = useRef<ReportJob | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      job.current?.cancel();
      opener?.focus();
    };
  }, []);

  const a = docs.find((doc) => doc.id === aId);
  const b = docs.find((doc) => doc.id === bId);
  const problem: MessageKey | null =
    docs.length < 2
      ? 'compare.needTwo'
      : !a || !b || a.id === b.id
        ? 'compare.same'
        : (a.record.alphabet === 'protein') !== (b.record.alphabet === 'protein')
          ? 'compare.mixed'
          : null;
  const working = stage !== null;

  const generate = async () => {
    if (!a || !b || problem) return;
    setFailed(false);
    setStage('summary');
    const { language } = settings.peek();
    const name = projectName.peek().trim();
    const started = startReport(
      {
        a: a.record,
        b: b.record,
        mode,
        projectName: name,
        generated: new Date().toISOString(),
        locale: language,
        labels: pickReportLabels(DICTIONARIES[language]),
      },
      setStage,
    );
    job.current = started;
    try {
      const bytes = await started.result;
      const file = `${name || `${a.record.name}-vs-${b.record.name}`}.pdf`;
      const saved = await downloadBlob(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
        file,
      );
      reportSave(saved);
      if (saved.ok) {
        notice.value = { key: 'compare.done', tone: 'info' };
        sfx('loaded');
        onClose();
        return;
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
    } finally {
      job.current = null;
      setStage(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const picker = (label: MessageKey, id: string, value: string, set: (id: string) => void) => (
    <div class="compare-field">
      <label class="field-label" for={id}>
        {t(label)}
      </label>
      <select id={id} value={value} disabled={working} onChange={(event) => set(event.currentTarget.value)}>
        {docs.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {doc.record.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div class="compare-layer">
      <div class="compare-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        class="bracket-box compare-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-title"
        onKeyDown={onKeyDown}
      >
        <div class="bracket-inner" />
        <h2 class="lib-title" id="compare-title">
          {t('compare.title')}
        </h2>
        <p class="export-hint">{t('compare.intro')}</p>
        {docs.length >= 2 && (
          <>
            {picker('compare.a', 'compare-a', aId, setAId)}
            {picker('compare.b', 'compare-b', bId, setBId)}
            <div class="compare-field">
              <label class="field-label" for="compare-mode">
                {t('compare.mode')}
              </label>
              <select
                id="compare-mode"
                value={mode}
                disabled={working}
                onChange={(event) => setMode(MODES.find((m) => m === event.currentTarget.value) ?? 'global')}
              >
                {MODES.map((option) => (
                  <option key={option} value={option}>
                    {t(`compare.mode.${option}`)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div role="status" aria-live="polite">
          {problem && <p class="lib-status">{t(problem)}</p>}
          {stage && (
            <p class="lib-status">{t(stage === 'pdf' ? 'compare.stage.pdf' : `compare.stage.${stage}`)}</p>
          )}
        </div>
        {failed && (
          <p class="lib-status lib-error" role="alert">
            {t('compare.failed')}
          </p>
        )}
        <div class="compare-actions">
          {working ? (
            <button type="button" class="secondary" onClick={() => job.current?.cancel()}>
              {t('compare.cancel')}
            </button>
          ) : (
            <>
              <button type="button" class="secondary" onClick={onClose}>
                {t('compare.close')}
              </button>
              <button
                type="button"
                class="primary-btn"
                disabled={problem !== null}
                onClick={() => void generate()}
              >
                {t('compare.generate')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
