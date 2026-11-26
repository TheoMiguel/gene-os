import { type Signal, signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatLocation } from '../../engine/location';
import { ENZYME_CATALOG } from '../../engine/restriction';
import { useAnalysis } from '../../state/analysis';
import { type SeqDocument, workspace } from '../../state/documents';
import { useAdvanced } from '../../state/settings';
import { type ViewState, viewOf } from '../../state/view';
import { t } from '../i18n';
import { Table, type TableColumn } from '../table';
import { focusSearchBox } from './search/findShortcut';
import {
  collectRows,
  DEFAULT_FORM,
  hitSpan,
  planSearch,
  type QueryKind,
  type ResultRow,
  type ScanOutput,
  type SearchForm,
  type SearchParams,
  stepIndex,
} from './search/model';
import { useSearchJobs } from './search/useSearchJobs';
import './search/search.css';

const KINDS: readonly QueryKind[] = ['motif', 'text', 'regex', 'enzyme'];
const NO_QUERY: SearchParams = { query: '' };
const DEBOUNCE_MS = 250;

const forms = new WeakMap<ViewState, Signal<SearchForm>>();

/** The search options of a document. They outlive the view, so a tab switch keeps them. */
function formOf(view: ViewState): Signal<SearchForm> {
  let form = forms.get(view);
  if (!form) {
    form = signal(DEFAULT_FORM);
    forms.set(view, form);
  }
  return form;
}

const frameText = (frame: number | null) => (frame === null ? '' : frame > 0 ? `+${frame}` : String(frame));

/** The search view: a query, its options, the hits in a table, and next and previous through them. */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  const { record } = doc;
  const view = viewOf(doc.id);
  const formSignal = formOf(view);
  const form = formSignal.value;
  const advanced = useAdvanced();
  const nucleotide = record.alphabet !== 'protein';
  const selection = view.selection.value;
  const scopedSelection = form.scope === 'selection' ? selection : null;

  const update = (patch: Partial<SearchForm>) => {
    formSignal.value = { ...formSignal.peek(), ...patch };
  };

  const [draft, setDraft] = useState(form.query);
  const [current, setCurrent] = useState(-1);
  const input = useRef<HTMLInputElement | null>(null);
  const jumpWhenReady = useRef<1 | -1 | null>(null);

  useEffect(() => {
    if (draft === form.query) return;
    const timer = setTimeout(() => update({ query: draft }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const wantsFocus = focusSearchBox.value;
  useEffect(() => {
    if (!wantsFocus) return;
    input.current?.focus();
    input.current?.select();
    focusSearchBox.value = false;
  }, [wantsFocus]);

  const plan = useMemo(() => planSearch(record, form, scopedSelection), [record, form, scopedSelection]);
  const whole = useAnalysis(doc, 'search', plan.whole ?? NO_QUERY);
  const extra = useSearchJobs(plan.jobs);

  const pending = (plan.whole !== null && whole.status === 'pending') || extra.status === 'pending';
  const errors = [
    ...(plan.whole !== null && whole.status === 'failed' ? [whole.reason] : []),
    ...(extra.status === 'done' ? extra.errors : []),
  ];

  const found = useMemo(() => {
    if (pending) return null;
    const outputs: ScanOutput[] = [];
    if (plan.whole !== null && whole.status === 'ready') outputs.push({ job: null, result: whole.value });
    if (extra.status === 'done') outputs.push(...extra.results);
    return collectRows(record, form, outputs, scopedSelection);
  }, [pending, plan, whole, extra, record, form, scopedSelection]);

  const shown = useRef<NonNullable<typeof found>>({ rows: [], count: { shown: 0, total: 0, capped: false } });
  if (found) shown.current = found;
  const { rows, count } = shown.current;

  const selectHit = (row: ResultRow) => {
    const span = hitSpan(row.hit);
    view.select(span.start, span.end, row.hit.strand);
    view.reveal(span.start);
  };

  const step = (direction: 1 | -1, from: number, list: readonly ResultRow[]) => {
    const index = stepIndex(list, from, direction, view.caret.peek());
    if (index === null) return;
    setCurrent(index);
    selectHit(list[index] as ResultRow);
  };

  useEffect(() => {
    if (!found) return;
    view.hits.value = found.rows.map((row) => row.hit);
    setCurrent(-1);
    const direction = jumpWhenReady.current;
    jumpWhenReady.current = null;
    if (direction) step(direction, -1, found.rows);
  }, [found]);

  useEffect(() => {
    view.search.value = {
      query: plan.enzyme?.site ?? form.query,
      mode: form.kind === 'regex' ? 'regex' : form.kind === 'text' ? 'text' : 'motif',
    };
  }, [view, plan.enzyme, form.query, form.kind]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    if (draft !== form.query) {
      jumpWhenReady.current = direction;
      update({ query: draft });
    } else step(direction, current, rows);
  };

  const stop = () => {
    setDraft('');
    update({ query: '' });
  };

  const openInSequence = (row: ResultRow, index: number) => {
    setCurrent(index);
    selectHit(row);
    workspace.setActiveTab(doc.id, 'sequence');
  };

  const columns: TableColumn<ResultRow>[] = [
    {
      id: 'position',
      header: t('search.col.position'),
      type: 'number',
      width: 100,
      value: (r) => r.hit.start + 1,
      format: (v) => (typeof v === 'number' ? v.toLocaleString() : ''),
    },
    {
      id: 'strand',
      header: t('search.col.strand'),
      width: 70,
      value: (r) => (r.hit.strand === 1 ? '+' : '-'),
    },
    { id: 'frame', header: t('search.col.frame'), width: 70, value: (r) => frameText(r.frame) },
    { id: 'match', header: t('search.col.match'), width: 180, value: (r) => r.context.match },
    {
      id: 'context',
      header: t('search.col.context'),
      width: 340,
      value: (r) => `${r.context.left}[${r.context.match}]${r.context.right}`,
    },
    { id: 'length', header: t('search.col.length'), type: 'number', width: 80, value: (r) => r.hit.length },
    {
      id: 'location',
      header: t('search.col.location'),
      width: 160,
      value: (r) => formatLocation(r.hit.location),
    },
  ];

  const protein = form.kind === 'motif' && !nucleotide;
  const placeholder = protein
    ? 'search.placeholder.motifProtein'
    : (`search.placeholder.${form.kind}` as const);
  const hint = protein ? 'search.hint.motifProtein' : (`search.hint.${form.kind}` as const);
  const kinds = nucleotide ? KINDS : KINDS.filter((kind) => kind !== 'enzyme');
  const active = plan.whole !== null || plan.jobs.length > 0;
  const position = current >= 0 && current < rows.length ? current : null;

  return (
    <div class="search-view">
      <section class="bracket-box search-controls">
        <div class="bracket-inner" />
        <fieldset class="settings-field">
          <legend class="field-label">{t('search.kind')}</legend>
          <div class="seg-group">
            {kinds.map((kind) => (
              <label key={kind} class="seg-btn">
                <input
                  type="radio"
                  class="visually-hidden"
                  name={`search-kind-${doc.id}`}
                  checked={form.kind === kind}
                  onChange={() => update({ kind })}
                />
                <span>{t(`search.kind.${kind}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div class="search-line">
          <label class="field search-box">
            <span class="field-label">{t('search.label')}</span>
            <input
              ref={input}
              type="text"
              value={draft}
              list={form.kind === 'enzyme' ? 'search-enzymes' : undefined}
              placeholder={t(placeholder)}
              spellcheck={false}
              autocomplete="off"
              aria-invalid={errors.length > 0 || plan.unknownEnzyme}
              aria-describedby="search-feedback"
              onInput={(event) => setDraft((event.currentTarget as HTMLInputElement).value)}
              onKeyDown={onKeyDown}
            />
          </label>
          {form.kind === 'enzyme' && (
            <datalist id="search-enzymes">
              {ENZYME_CATALOG.map((enzyme) => (
                <option key={enzyme.name} value={enzyme.name} />
              ))}
            </datalist>
          )}
          <button
            type="button"
            class="secondary"
            disabled={rows.length === 0}
            onClick={() => step(-1, current, rows)}
          >
            {t('search.previous')}
          </button>
          <button
            type="button"
            class="secondary"
            disabled={rows.length === 0}
            onClick={() => step(1, current, rows)}
          >
            {t('search.next')}
          </button>
          {pending && (
            <button type="button" class="secondary danger" onClick={stop}>
              {t('search.stop')}
            </button>
          )}
        </div>
        <div id="search-feedback" class="search-feedback">
          <p class="note">{t(hint)}</p>
          {plan.enzyme && (
            <p class="note">{t('search.enzymeInfo', { name: plan.enzyme.name, site: plan.enzyme.site })}</p>
          )}
          {plan.unknownEnzyme && (
            <p class="form-error" role="alert">
              {t('search.unknownEnzyme')}
            </p>
          )}
          {errors.map((reason) => (
            <p key={reason} class="form-error" role="alert">
              {t('search.failed', { reason })}
            </p>
          ))}
        </div>

        <div class="search-options">
          {nucleotide && (
            <label class="field inline">
              <span class="field-label">{t('search.strands')}</span>
              <select
                value={form.bothStrands ? 'both' : 'forward'}
                onChange={(e) =>
                  update({ bothStrands: (e.currentTarget as HTMLSelectElement).value === 'both' })
                }
              >
                <option value="both">{t('search.strands.both')}</option>
                <option value="forward">{t('search.strands.forward')}</option>
              </select>
            </label>
          )}
          <label class="field inline">
            <span class="field-label">{t('search.scope')}</span>
            <select
              value={form.scope}
              onChange={(e) =>
                update({ scope: (e.currentTarget as HTMLSelectElement).value as SearchForm['scope'] })
              }
            >
              <option value="whole">{t('search.scope.whole')}</option>
              <option value="selection">{t('search.scope.selection')}</option>
            </select>
          </label>
          {nucleotide && form.kind !== 'enzyme' && (
            <label class="field inline">
              <span class="field-label">{t('search.target')}</span>
              <select
                value={form.target}
                onChange={(e) =>
                  update({ target: (e.currentTarget as HTMLSelectElement).value as SearchForm['target'] })
                }
              >
                <option value="sequence">{t('search.target.sequence')}</option>
                <option value="translation">{t('search.target.translation')}</option>
                <option value="both">{t('search.target.both')}</option>
              </select>
            </label>
          )}
          {(form.kind === 'text' || form.kind === 'regex') && (
            <label class="check">
              <input
                type="checkbox"
                checked={form.matchCase}
                onChange={(e) => update({ matchCase: (e.currentTarget as HTMLInputElement).checked })}
              />
              {t('search.matchCase')}
            </label>
          )}
          {record.topology === 'circular' && nucleotide && (
            <label class="check">
              <input
                type="checkbox"
                checked={form.crossOrigin}
                onChange={(e) => update({ crossOrigin: (e.currentTarget as HTMLInputElement).checked })}
              />
              {t('search.crossOrigin')}
            </label>
          )}
          {advanced && (
            <label class="field inline">
              <span class="field-label">{t('search.maxHits')}</span>
              <input
                type="number"
                min={1}
                max={1_000_000}
                value={form.maxHits}
                onChange={(e) => {
                  const value = Math.trunc(Number((e.currentTarget as HTMLInputElement).value));
                  if (value >= 1) update({ maxHits: Math.min(value, 1_000_000) });
                }}
              />
            </label>
          )}
        </div>
        {form.scope === 'selection' && !selection && <p class="note">{t('search.scope.noSelection')}</p>}
      </section>

      <section class="bracket-box search-results">
        <div class="bracket-inner" />
        <div class="search-status" role="status" aria-live="polite">
          {pending && <span>{t('search.searching')}</span>}
          {!pending && active && (
            <span>
              {count.capped
                ? t('search.countCapped', {
                    shown: count.shown.toLocaleString(),
                    total: count.total.toLocaleString(),
                  })
                : t('search.count', { count: count.total.toLocaleString() })}
            </span>
          )}
          {position !== null && (
            <span>
              {t('search.position', { current: position + 1, total: rows.length.toLocaleString() })}
            </span>
          )}
          {position !== null && (
            <button
              type="button"
              class="export-button"
              onClick={() => openInSequence(rows[position] as ResultRow, position)}
            >
              {t('search.open')}
            </button>
          )}
        </div>
        <div class="search-table">
          {!active ? (
            <p class="empty-state">{t('search.empty')}</p>
          ) : rows.length === 0 && !pending ? (
            <p class="empty-state">{t('search.noHits')}</p>
          ) : (
            <Table
              label={t('search.tableLabel')}
              columns={columns}
              rows={rows}
              exportName={`${record.name}-search`}
              onRowClick={openInSequence}
            />
          )}
        </div>
      </section>
    </div>
  );
}
