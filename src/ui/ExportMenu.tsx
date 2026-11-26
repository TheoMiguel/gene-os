import { useEffect, useRef, useState } from 'preact/hooks';
import { canWrite } from '../formats';
import type { WritableFormat } from '../formats/types';
import {
  type AnalysisTable,
  analysisJson,
  analysisTables,
  type CopyKind,
  copyTextOf,
  sliceRecord,
} from '../project/export';
import { openProjectFile, pickProjectFile, saveProject } from '../project/file';
import { projectName } from '../project/snapshot';
import { type SeqDocument, workspace } from '../state/documents';
import { viewOf } from '../state/view';
import { notice, sfx } from './actions';
import { CompareDialog } from './CompareDialog';
import { copyText } from './export/clipboard';
import { downloadText, safeFileName } from './export/download';
import { reportCopy, reportSave } from './export/feedback';
import { downloadSequence } from './export/sequence';
import { downloadPng, downloadSvg } from './export/svg';
import { TABLE_FORMATS, type TableFormat } from './export/tabular';
import { type MessageKey, t } from './i18n';
import './ExportMenu.css';
import './viz/viz.css';

const SEQUENCE_FORMATS: readonly WritableFormat[] = ['genbank', 'fasta', 'embl', 'snapgene', 'raw'];
const TABLE_IDS = ['features', 'composition', 'restriction', 'orfs'] as const;
const FORMATS = Object.keys(TABLE_FORMATS) as TableFormat[];

interface Picture {
  readonly name: string;
  readonly svg: SVGSVGElement;
}

/** The charts and maps the active view shows right now: every `<svg>` that carries a chart or an export name. */
function picturesOnScreen(): Picture[] {
  const found = document.querySelectorAll<SVGSVGElement>(
    '.tab-panel svg.chart-svg, .tab-panel svg[data-export-name]',
  );
  return [...found].map((svg, index) => ({
    svg,
    name:
      svg.dataset.exportName ??
      svg.closest('.chart')?.getAttribute('aria-label') ??
      `${t('export.group.images')} ${index + 1}`,
  }));
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'image';

function openResultKey(reason: string): MessageKey {
  const key = `project.${reason === 'notJson' ? 'notProject' : reason}` as MessageKey;
  return key;
}

function ExportPanel({ doc, onCompare }: { doc: SeqDocument | null; onCompare: () => void }) {
  const [tableId, setTableId] = useState<(typeof TABLE_IDS)[number]>('features');
  const [working, setWorking] = useState(false);
  const [pictures] = useState(picturesOnScreen);
  const selection = doc ? viewOf(doc.id).selection.value : null;
  const [scope, setScope] = useState<'document' | 'selection'>('document');
  const useSelection = scope === 'selection' && selection !== null;

  const saveSequence = async (format: WritableFormat) => {
    if (!doc) return;
    const record = useSelection && selection ? sliceRecord(doc.record, selection) : doc.record;
    reportSave(await downloadSequence(record, format));
  };

  const copy = async (kind: CopyKind, fromSelection: boolean) => {
    if (!doc) return;
    const seq =
      fromSelection && selection ? doc.record.seq.slice(selection.start, selection.end) : doc.record.seq;
    reportCopy(await copyText(copyTextOf(doc.record, seq, kind)));
  };

  const withTables = async (use: (tables: AnalysisTable[]) => Promise<void>) => {
    if (!doc) return;
    setWorking(true);
    try {
      await use(await analysisTables(doc));
    } catch {
      notice.value = { key: 'export.analysis.failed', tone: 'error' };
    } finally {
      setWorking(false);
    }
  };

  const saveTable = (format: TableFormat) =>
    withTables(async (tables) => {
      const table = tables.find((candidate) => candidate.id === tableId);
      if (!doc || !table) return;
      reportSave(
        await downloadText(
          table.serialize(format),
          `${safeFileName(doc.record.name)}-${table.id}.${TABLE_FORMATS[format].extension}`,
          TABLE_FORMATS[format].mimeType,
        ),
      );
    });

  const saveAll = () =>
    withTables(async (tables) => {
      if (!doc) return;
      reportSave(
        await downloadText(
          analysisJson(doc.record, tables),
          `${safeFileName(doc.record.name)}-analysis.json`,
          'application/json',
        ),
      );
    });

  const openProject = async () => {
    const file = await pickProjectFile(t('export.project.typeLabel'));
    if (!file) return;
    const result = await openProjectFile(file);
    notice.value = result.ok
      ? { key: result.skipped > 0 ? 'project.openedSkipped' : 'project.opened', tone: 'info' }
      : { key: openResultKey(result.reason), tone: 'error' };
    sfx(result.ok ? 'loaded' : 'error');
  };

  const nucleotide = doc?.record.alphabet !== 'protein';
  const button = (label: string, onClick: () => void, disabled = false, title?: string) => (
    <button type="button" class="export-button" disabled={disabled} title={title} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div class="export-panel bracket-box" role="dialog" aria-label={t('export.menuLabel')}>
      <div class="bracket-inner" />
      <div class="export-doc-name">{doc ? doc.record.name : t('export.noDocument')}</div>

      {doc && (
        <>
          <fieldset class="export-group">
            <legend class="field-label">{t('export.group.sequence')}</legend>
            {selection && (
              <div class="seg-group" role="radiogroup">
                {(['document', 'selection'] as const).map((option) => (
                  <label key={option} class="seg-btn">
                    <input
                      type="radio"
                      class="visually-hidden"
                      name="export-scope"
                      checked={scope === option}
                      onChange={() => setScope(option)}
                    />
                    <span>
                      {option === 'document'
                        ? t('export.scope.document')
                        : t('export.scope.selection', { start: selection.start + 1, end: selection.end })}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div class="export-row">
              {SEQUENCE_FORMATS.map((format) =>
                button(
                  t(`export.fmt.${format}`),
                  () => void saveSequence(format),
                  !canWrite(doc.record, format),
                  canWrite(doc.record, format) ? undefined : t('export.fmt.disabled'),
                ),
              )}
            </div>
          </fieldset>

          <fieldset class="export-group">
            <legend class="field-label">{t('export.group.copy')}</legend>
            <div class="export-row">
              {button(t('export.copy.sequence'), () => void copy('sequence', false))}
              {button(
                t('export.copy.reverseComplement'),
                () => void copy('reverseComplement', false),
                !nucleotide,
              )}
              {button(t('export.copy.translation'), () => void copy('translation', false), !nucleotide)}
            </div>
            {selection && (
              <div class="export-row">
                {button(t('export.copy.selection'), () => void copy('sequence', true))}
                {button(
                  t('export.copy.selectionReverseComplement'),
                  () => void copy('reverseComplement', true),
                  !nucleotide,
                )}
              </div>
            )}
          </fieldset>

          <fieldset class="export-group">
            <legend class="field-label">{t('export.group.analysis')}</legend>
            <div class="export-row">
              <label class="visually-hidden" for="export-table">
                {t('export.analysis.table')}
              </label>
              <select
                id="export-table"
                value={tableId}
                onChange={(event) =>
                  setTableId(TABLE_IDS.find((id) => id === event.currentTarget.value) ?? 'features')
                }
              >
                {TABLE_IDS.filter((id) => nucleotide || id === 'features' || id === 'composition').map(
                  (id) => (
                    <option key={id} value={id}>
                      {t(`export.table.${id}`)}
                    </option>
                  ),
                )}
              </select>
              {FORMATS.map((format) => button(format.toUpperCase(), () => void saveTable(format), working))}
            </div>
            <div class="export-row">{button(t('export.analysis.all'), () => void saveAll(), working)}</div>
            {working && <p class="export-hint">{t('export.analysis.working')}</p>}
          </fieldset>

          <fieldset class="export-group">
            <legend class="field-label">{t('export.group.images')}</legend>
            {pictures.length === 0 && <p class="export-hint">{t('export.images.none')}</p>}
            {pictures.map((picture) => (
              <div key={picture.name} class="export-image">
                <span>{picture.name}</span>
                <span class="export-buttons">
                  {button(
                    t('export.svg'),
                    () => void downloadSvg(picture.svg, slug(picture.name)).then(reportSave),
                  )}
                  {button(
                    t('export.png'),
                    () => void downloadPng(picture.svg, slug(picture.name)).then(reportSave),
                  )}
                </span>
              </div>
            ))}
          </fieldset>
        </>
      )}

      <fieldset class="export-group">
        <legend class="field-label">{t('export.group.project')}</legend>
        <label class="field-label" for="export-project-name">
          {t('export.project.name')}
        </label>
        <div class="export-row">
          <input
            id="export-project-name"
            type="text"
            value={projectName.value}
            autocomplete="off"
            onInput={(event) => {
              projectName.value = event.currentTarget.value;
            }}
          />
        </div>
        <div class="export-row">
          {button(
            t('export.project.save'),
            () => void saveProject().then(reportSave),
            workspace.documents.value.length === 0,
          )}
          {button(t('export.project.open'), () => void openProject())}
        </div>
      </fieldset>

      <fieldset class="export-group">
        <legend class="field-label">{t('export.group.report')}</legend>
        <div class="export-row">
          {button(t('export.report.open'), onCompare, workspace.documents.value.length < 2)}
        </div>
      </fieldset>
    </div>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

/**
 * One place to export (spec 7.1, 7.4, 7.5): the active sequence or its selection in every sequence format, its
 * analysis tables as CSV, TSV and JSON, the charts on screen as SVG and PNG, clipboard copies, the project file and
 * the comparison report. It works on the active document, and shows the project actions with none open.
 */
export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const doc = workspace.activeDocument.value;

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLElement>('.export-panel button:not(:disabled), .export-panel input')
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open]);

  return (
    <div class="export-menu" ref={root}>
      <button
        ref={button}
        type="button"
        class={open ? 'export-menu-btn active' : 'export-menu-btn'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('export.menuLabel')}
        title={t('export.menuLabel')}
        onClick={() => {
          setOpen(!open);
          sfx(open ? 'panelClose' : 'panelOpen');
        }}
      >
        <ExportIcon />
        {t('export.menu')}
      </button>
      {open && (
        <ExportPanel
          doc={doc}
          onCompare={() => {
            setOpen(false);
            setComparing(true);
          }}
        />
      )}
      {comparing && <CompareDialog onClose={() => setComparing(false)} />}
    </div>
  );
}
