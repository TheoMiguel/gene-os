// biome-ignore-all lint/a11y/useSemanticElements: a virtualized grid positions rows absolutely, which table elements cannot do
// biome-ignore-all lint/a11y/useFocusableInteractive: focus stays on the grid, which tracks the active row with aria-activedescendant
// biome-ignore-all lint/a11y/useKeyWithClickEvents: keyboard operation lives on the grid: arrow keys, Space and Enter
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { copyText } from '../export/clipboard';
import { downloadText } from '../export/download';
import { reportCopy, reportSave } from '../export/feedback';
import { serializeTable, TABLE_FORMATS, type TableFormat, toTsv } from '../export/tabular';
import { t } from '../i18n';
import { useVirtualScroll } from '../viz/virtual';
import {
  cellText,
  DEFAULT_COLUMN_WIDTH,
  nextSort,
  positionRange,
  type SortState,
  type TableColumn,
  visibleRowIndexes,
} from './model';
import './table.css';

/** Height of a body row in px. */
export const ROW_HEIGHT = 28;
/** Height of the sticky header in px. */
export const HEADER_HEIGHT = 32;

export interface TableProps<Row> {
  /** Accessible name of the table. */
  readonly label: string;
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  /** File name (no extension) for exports. Default `table`. */
  readonly exportName?: string;
  readonly initialSort?: SortState;
  /** Called when a row is clicked or Enter is pressed on it. `index` is the row's index in `rows`. */
  readonly onRowClick?: (row: Row, index: number) => void;
  /** Called with the selected indexes of `rows`, ascending, whenever the selection changes. */
  readonly onSelectionChange?: (indexes: readonly number[]) => void;
}

const EXPORT_LABELS = {
  csv: 'table.exportCsv',
  tsv: 'table.exportTsv',
  json: 'table.exportJson',
} as const;

let nextTableId = 1;

/**
 * The table every result view shares: typed columns, click-to-sort headers, a text filter, a sticky header,
 * virtualized rows (hundreds of thousands stay smooth), row selection (click, Ctrl-click, Shift-click, arrow keys,
 * Ctrl+A), a row-click callback, and Copy TSV plus CSV, TSV and JSON export of the selected rows, or of all the
 * rows the filter leaves. It fills its parent and scrolls inside itself, so give the parent a height.
 */
export function Table<Row>(props: TableProps<Row>) {
  const { columns, rows, label } = props;
  const id = useRef(nextTableId++).current;
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortState | null>(props.initialSort ?? null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [active, setActive] = useState(0);
  const anchor = useRef(0);

  const order = useMemo(() => visibleRowIndexes(rows, columns, filter, sort), [rows, columns, filter, sort]);
  const scroll = useVirtualScroll({ count: order.length, itemHeight: ROW_HEIGHT, inset: HEADER_HEIGHT });
  const { range } = scroll;

  const widths = columns.map((column) => column.width ?? DEFAULT_COLUMN_WIDTH);
  const template = widths.map((width) => `${width}px`).join(' ');
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  useEffect(() => {
    setSelected(new Set());
    setActive(0);
    anchor.current = 0;
  }, [rows]);

  const select = (next: ReadonlySet<number>) => {
    setSelected(next);
    props.onSelectionChange?.([...next].sort((a, b) => a - b));
  };

  const toggle = (position: number, mode: 'replace' | 'toggle' | 'range') => {
    const index = order[position];
    if (index === undefined) return;
    if (mode === 'range') {
      select(new Set(positionRange(anchor.current, position).map((p) => order[p] as number)));
    } else if (mode === 'toggle') {
      const next = new Set(selected);
      if (!next.delete(index)) next.add(index);
      select(next);
      anchor.current = position;
    } else {
      select(new Set([index]));
      anchor.current = position;
    }
    setActive(position);
  };

  const clickRow = (position: number, event: MouseEvent) => {
    toggle(position, event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace');
    const index = order[position];
    if (index !== undefined) props.onRowClick?.(rows[index] as Row, index);
    scroll.ref.current?.focus();
  };

  const moveActive = (position: number, extend: boolean) => {
    const next = Math.min(Math.max(position, 0), order.length - 1);
    if (next < 0) return;
    toggle(next, extend ? 'range' : 'replace');
    scroll.scrollToItem(next, 'nearest');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const page = Math.max(1, Math.floor(scroll.viewportHeight / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      PageDown: active + page,
      PageUp: active - page,
      Home: 0,
      End: order.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      moveActive(moves[event.key] as number, event.shiftKey);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      select(new Set(order));
    } else if (event.key === ' ') {
      event.preventDefault();
      toggle(active, 'toggle');
    } else if (event.key === 'Enter') {
      const index = order[active];
      if (index !== undefined) props.onRowClick?.(rows[index] as Row, index);
    }
  };

  const exportRows = () =>
    (selected.size > 0 ? order.filter((i) => selected.has(i)) : order).map((i) => rows[i] as Row);

  const onCopy = (event: ClipboardEvent) => {
    if (selected.size === 0 || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', toTsv(columns, exportRows()));
    event.preventDefault();
  };

  const saveAs = async (format: TableFormat) => {
    const { extension, mimeType } = TABLE_FORMATS[format];
    reportSave(
      await downloadText(
        serializeTable(format, columns, exportRows()),
        `${props.exportName ?? 'table'}.${extension}`,
        mimeType,
      ),
    );
  };

  const rowId = (position: number) => `table-${id}-row-${position}`;
  const layerHeight = Math.max(0, Math.min(scroll.viewportHeight, range.scrollHeight));
  const rowNodes = [];
  for (let position = range.first; position < range.last; position++) {
    const index = order[position] as number;
    const row = rows[index] as Row;
    const isSelected = selected.has(index);
    rowNodes.push(
      <div
        key={index}
        id={rowId(position)}
        class={`table-row${isSelected ? ' selected' : ''}${position === active ? ' active' : ''}`}
        role="row"
        aria-rowindex={position + 2}
        aria-selected={isSelected}
        style={{
          top: `${position * ROW_HEIGHT - range.offset}px`,
          height: `${ROW_HEIGHT}px`,
          gridTemplateColumns: template,
        }}
        onClick={(event) => clickRow(position, event)}
      >
        {columns.map((column) => {
          const text = cellText(column, row);
          const align = column.align ?? (column.type === 'number' ? 'end' : 'start');
          return (
            <div key={column.id} class={`table-cell ${align}`} role="gridcell" title={text}>
              {text}
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div class="table">
      <div class="table-toolbar">
        <input
          class="table-filter"
          type="search"
          aria-label={t('table.filter')}
          placeholder={t('table.filter')}
          value={filter}
          onInput={(event) => setFilter((event.currentTarget as HTMLInputElement).value)}
        />
        <span class="table-count" role="status" aria-live="polite">
          {t('table.rowCount', { shown: order.length.toLocaleString(), total: rows.length.toLocaleString() })}
          {selected.size > 0 && ` · ${t('table.selected', { count: selected.size.toLocaleString() })}`}
        </span>
        <span class="table-actions">
          <button
            type="button"
            class="export-button"
            onClick={async () => reportCopy(await copyText(toTsv(columns, exportRows())))}
          >
            {t('table.copyTsv')}
          </button>
          {(Object.keys(EXPORT_LABELS) as TableFormat[]).map((format) => (
            <button key={format} type="button" class="export-button" onClick={() => void saveAs(format)}>
              {t(EXPORT_LABELS[format])}
            </button>
          ))}
        </span>
      </div>
      <div
        class="table-scroll"
        ref={scroll.ref}
        role="grid"
        aria-label={label}
        aria-rowcount={order.length + 1}
        aria-colcount={columns.length}
        aria-multiselectable="true"
        aria-activedescendant={order.length > 0 ? rowId(active) : undefined}
        tabIndex={0}
        onScroll={scroll.onScroll}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
      >
        <div
          class="table-header"
          role="row"
          style={{ gridTemplateColumns: template, height: `${HEADER_HEIGHT}px`, minWidth: `${totalWidth}px` }}
        >
          {columns.map((column) => {
            const direction = sort?.column === column.id ? sort.direction : null;
            return (
              <div
                key={column.id}
                class={`table-head ${column.align ?? (column.type === 'number' ? 'end' : 'start')}`}
                role="columnheader"
                aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
              >
                <button type="button" class="table-sort" onClick={() => setSort(nextSort(sort, column.id))}>
                  {column.header}
                  <span aria-hidden="true" class="table-arrow">
                    {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : ''}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div class="table-body" style={{ height: `${range.scrollHeight}px`, minWidth: `${totalWidth}px` }}>
          <div class="table-layer" style={{ height: `${layerHeight}px` }}>
            {order.length === 0 ? <div class="table-empty">{t('table.empty')}</div> : rowNodes}
          </div>
        </div>
      </div>
    </div>
  );
}
