import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import type { CutCountClass, RestrictionScan } from '../../../engine/restriction';
import { SUPPLIERS } from '../../../engine/restriction';
import type { EndType } from '../../../engine/types';
import type { AnalysisState } from '../../../state/analysis';
import type { SeqDocument } from '../../../state/documents';
import { useAdvanced } from '../../../state/settings';
import { viewOf } from '../../../state/view';
import { type MessageKey, t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { PaneFrame } from './PaneFrame';
import { pickRange } from './pick';
import {
  buildSiteRows,
  createSiteIndex,
  DEFAULT_FILTER,
  type RestrictionFilter,
  type SiteRow,
} from './restrictionRows';
import { prefsOf } from './state';

/** A selection longer than this highlights no list rows: it would mark most of the list and mean nothing. */
const MAX_HIGHLIGHT_SPAN = 20_000;

const END_TYPES: readonly EndType[] = ['five_prime', 'three_prime', 'blunt'];
const END_KEYS: Readonly<Record<EndType, MessageKey>> = {
  five_prime: 'sv.sites.endFive',
  three_prime: 'sv.sites.endThree',
  blunt: 'sv.sites.endBlunt',
};
const CUT_COUNTS: readonly CutCountClass[] = ['unique', 'double', 'multiple', 'non_cutter'];
const COUNT_KEYS: Readonly<Record<CutCountClass, MessageKey>> = {
  unique: 'sv.sites.countUnique',
  double: 'sv.sites.countDouble',
  multiple: 'sv.sites.countMultiple',
  non_cutter: 'sv.sites.countNone',
};
const SUPPLIER_CODES = Object.keys(SUPPLIERS).sort((a, b) =>
  (SUPPLIERS[a] ?? a).localeCompare(SUPPLIERS[b] ?? b),
);

const toggled = <T,>(list: readonly T[], item: T): T[] =>
  list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];

interface RestrictionPaneProps {
  readonly doc: SeqDocument;
  /** The view is tall enough to show the filters open by default. */
  readonly roomy: boolean;
  readonly analysis: AnalysisState<RestrictionScan>;
}

/**
 * The restriction scan as a list: one row per cut with its enzyme, recognition sequence, cut position, strand, end type
 * and overhang, and the enzyme's cut count. Filters by end type, cut count and supplier narrow it; non-cutters appear on
 * request. Picking rows picks their enzymes, which the map and the text then highlight. A site selected elsewhere
 * highlights its row.
 */
export function RestrictionPane({ doc, analysis, roomy }: RestrictionPaneProps) {
  const { record } = doc;
  const advanced = useAdvanced();
  const view = viewOf(doc.id);
  const prefs = prefsOf(doc.id);
  const filter = prefs.filter.value;
  const picked = prefs.picked.value;
  const selection = view.selection.value;
  const scan = analysis.status === 'ready' ? analysis.value : null;
  const filtersOpen = prefs.filtersOpen.value ?? roomy;
  const activeFilters =
    [filter.endTypes, filter.suppliers].filter((list) => list.length > 0).length +
    (filter.cutCounts.length > 0 ? 1 : 0);

  const built = useMemo(
    () => (scan ? buildSiteRows(scan, record.seq, filter) : { rows: [], total: 0 }),
    [scan, record.seq, filter],
  );
  const { rows } = built;
  const index = useMemo(() => createSiteIndex(rows, record.seq.length), [rows, record.seq.length]);

  const highlighted = useMemo(() => {
    const marked = new Set<number>();
    rows.forEach((row, i) => {
      if (picked.has(row.enzyme)) marked.add(i);
    });
    if (selection && selection.end - selection.start <= MAX_HIGHLIGHT_SPAN)
      for (const i of index.overlapping(selection.start, selection.end)) marked.add(i);
    return marked;
  }, [rows, index, picked, selection]);

  const endLabel = (end: EndType) => t(END_KEYS[end]);
  const columns = useMemo<TableColumn<SiteRow>[]>(() => {
    const base: TableColumn<SiteRow>[] = [
      { id: 'enzyme', header: t('sv.sites.enzyme'), value: (row) => row.enzyme, width: 110 },
      { id: 'recognition', header: t('sv.sites.recognition'), value: (row) => row.recognition, width: 130 },
      {
        id: 'cut',
        header: t('sv.sites.cut'),
        type: 'number',
        value: (row) => row.cut,
        format: (v) => (typeof v === 'number' ? v.toLocaleString() : ''),
        width: 90,
      },
      {
        id: 'strand',
        header: t('sv.sites.strand'),
        value: (row) => (row.strand === null ? null : row.strand === 1 ? '+' : '−'),
        width: 70,
      },
      { id: 'end', header: t('sv.sites.end'), value: (row) => endLabel(row.end), width: 120 },
      { id: 'overhang', header: t('sv.sites.overhang'), value: (row) => row.overhang, width: 100 },
      { id: 'count', header: t('sv.sites.count'), type: 'number', value: (row) => row.count, width: 80 },
    ];
    if (!advanced) return base;
    return [
      ...base,
      {
        id: 'start',
        header: t('sv.sites.siteStart'),
        type: 'number',
        value: (row) => (row.siteStart === null ? null : row.siteStart + 1),
        format: (v) => (typeof v === 'number' ? v.toLocaleString() : ''),
        width: 100,
      },
      { id: 'suppliers', header: t('sv.sites.suppliers'), value: (row) => row.suppliers, width: 110 },
    ];
  }, [advanced]);

  const update = (next: Partial<RestrictionFilter>) => {
    prefs.filter.value = { ...filter, ...next };
  };
  const onRowClick = (row: SiteRow) => {
    if (row.siteStart === null || row.siteEnd === null) return;
    const length = record.seq.length;
    const whole =
      row.siteEnd <= length
        ? { start: row.siteStart, end: row.siteEnd }
        : { start: row.siteStart, end: length };
    pickRange(view, prefs, {
      id: `s:${row.enzyme}:${row.siteStart}`,
      span: whole,
      strand: 1,
      reveal: row.siteStart % length,
    });
  };

  let body: ComponentChildren;
  if (analysis.status === 'pending')
    body = (
      <p class="pane-empty" role="status">
        {t('sv.sites.scanning')}
      </p>
    );
  else if (analysis.status === 'failed')
    body = (
      <p class="pane-empty" role="alert">
        {t('sv.sites.failed', { reason: analysis.reason })}
      </p>
    );
  else
    body = (
      <>
        {rows.length === 0 && <p class="pane-note empty-hint">{t('sv.sites.noMatch')}</p>}
        {built.total > rows.length && (
          <p class="pane-note empty-hint">
            {t('sv.sites.truncated', {
              shown: rows.length.toLocaleString(),
              total: built.total.toLocaleString(),
            })}
          </p>
        )}
        <div class="table-host">
          <Table
            label={t('sv.sites.title')}
            columns={columns}
            rows={rows}
            exportName={`${record.name}-restriction`}
            initialSort={{ column: 'cut', direction: 'asc' }}
            highlighted={highlighted}
            onRowClick={onRowClick}
            onSelectionChange={(selected) => {
              prefs.picked.value = new Set(
                selected.map((i) => rows[i]?.enzyme).filter((name): name is string => Boolean(name)),
              );
            }}
          />
        </div>
      </>
    );

  return (
    <PaneFrame index="03" title={t('sv.sites.title')} class="sites-pane">
      <div class="filter-bar">
        <details
          class="options filter-box"
          open={filtersOpen}
          onToggle={(event) => {
            prefs.filtersOpen.value = (event.currentTarget as HTMLDetailsElement).open;
          }}
        >
          <summary>{t('sv.sites.filters', { count: activeFilters })}</summary>
          <div class="options-body filters">
            <fieldset class="layers">
              <legend class="field-label">{t('sv.sites.filterEnd')}</legend>
              {END_TYPES.map((end) => (
                <label key={end} class="check">
                  <input
                    type="checkbox"
                    checked={filter.endTypes.includes(end)}
                    onChange={() => update({ endTypes: toggled(filter.endTypes, end) })}
                  />
                  {t(END_KEYS[end])}
                </label>
              ))}
            </fieldset>
            <fieldset class="layers">
              <legend class="field-label">{t('sv.sites.filterCount')}</legend>
              {CUT_COUNTS.map((count) => (
                <label key={count} class="check">
                  <input
                    type="checkbox"
                    checked={filter.cutCounts.includes(count)}
                    onChange={() => update({ cutCounts: toggled(filter.cutCounts, count) })}
                  />
                  {t(COUNT_KEYS[count])}
                </label>
              ))}
            </fieldset>
            <label class="tool inline">
              <span class="field-label">{t('sv.sites.filterSupplier')}</span>
              <select
                value={filter.suppliers[0] ?? ''}
                onChange={(event) => {
                  const code = (event.currentTarget as HTMLSelectElement).value;
                  update({ suppliers: code ? [code] : [] });
                }}
              >
                <option value="">{t('sv.sites.anySupplier')}</option>
                {SUPPLIER_CODES.map((code) => (
                  <option key={code} value={code}>
                    {SUPPLIERS[code]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        <span class="tool-group">
          <button
            type="button"
            class="export-button"
            disabled={picked.size === 0}
            onClick={() => (prefs.picked.value = new Set())}
          >
            {t('sv.sites.clearPicks')}
          </button>
          <button type="button" class="export-button" onClick={() => (prefs.filter.value = DEFAULT_FILTER)}>
            {t('sv.sites.resetFilters')}
          </button>
        </span>
      </div>
      {body}
    </PaneFrame>
  );
}
