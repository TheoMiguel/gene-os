import { useMemo } from 'preact/hooks';
import type { SeqRecord } from '../../../engine/types';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { SequenceActions } from '../gel/SequenceActions';
import { endLabel, type FragmentRow, fragmentRecord } from './model';

interface FragmentSectionProps {
  readonly record: SeqRecord;
  readonly rows: readonly FragmentRow[];
  readonly enzymes: string;
  readonly selected: number | null;
  readonly onSelect: (index: number) => void;
}

const PREVIEW = 24;

function preview(sequence: string): string {
  return sequence.length <= PREVIEW * 2 + 1
    ? sequence
    : `${sequence.slice(0, PREVIEW)}…${sequence.slice(-PREVIEW)}`;
}

/** The fragment table (size, positions, both ends with their overhangs, sequence) and the selected fragment's sequence. */
export function FragmentSection({ record, rows, enzymes, selected, onSelect }: FragmentSectionProps) {
  const columns = useMemo<TableColumn<FragmentRow>[]>(
    () => [
      {
        id: 'number',
        header: t('digest.colNumber'),
        type: 'number',
        width: 70,
        value: (row) => row.index,
        format: (value, row) => (selected === row.index - 1 ? `▶ ${value}` : String(value)),
      },
      {
        id: 'length',
        header: t('digest.colSize'),
        type: 'number',
        width: 100,
        value: (row) => row.length,
        format: (value) => Number(value).toLocaleString(),
      },
      { id: 'start', header: t('digest.colStart'), type: 'number', width: 90, value: (row) => row.start },
      { id: 'end', header: t('digest.colEnd'), type: 'number', width: 90, value: (row) => row.end },
      {
        id: 'wraps',
        header: t('digest.colOrigin'),
        width: 90,
        value: (row) => (row.wraps ? t('digest.acrossOrigin') : ''),
      },
      { id: 'left', header: t('digest.colLeftEnd'), width: 210, value: (row) => endLabel(row.left) },
      { id: 'right', header: t('digest.colRightEnd'), width: 210, value: (row) => endLabel(row.right) },
      {
        id: 'sequence',
        header: t('digest.colSequence'),
        width: 330,
        value: (row) => row.sequence(),
        format: (value) => preview(String(value)),
      },
    ],
    [selected],
  );
  const row = selected === null ? undefined : rows[selected];
  const rowRecord = useMemo(
    () => (row ? fragmentRecord(record, row, enzymes || 'uncut') : null),
    [record, row, enzymes],
  );

  return (
    <div class="digest-fragments">
      <div class="digest-table-frame digest-fragment-table">
        <Table
          label={t('digest.fragmentsLabel')}
          columns={columns}
          rows={rows}
          exportName={`${record.name}-fragments`}
          onRowClick={(_, index) => onSelect(index)}
        />
      </div>
      <div class="digest-detail" aria-live="polite">
        {row && rowRecord ? (
          <>
            <div class="digest-detail-head">
              <span class="field-label">
                {t('digest.selected', {
                  number: row.index,
                  size: row.length.toLocaleString(),
                  start: row.start.toLocaleString(),
                  end: row.end.toLocaleString(),
                })}
              </span>
              <SequenceActions record={rowRecord} />
            </div>
            <textarea
              class="digest-sequence"
              readOnly
              rows={4}
              spellcheck={false}
              aria-label={t('digest.sequenceLabel')}
              value={rowRecord.seq.length > 6000 ? `${rowRecord.seq.slice(0, 6000)}…` : rowRecord.seq}
            />
          </>
        ) : (
          <p class="digest-hint">{t('digest.selectHint')}</p>
        )}
      </div>
    </div>
  );
}
