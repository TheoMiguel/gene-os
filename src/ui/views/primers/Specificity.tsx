import { useEffect, useMemo } from 'preact/hooks';
import type { Primer, PrimerBinding, SeqRecord } from '../../../engine/types';
import type { Overlay, ViewState } from '../../../state/view';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { primerOverlays, SequenceRenderer } from '../../viz';
import { bindingAlignment, splitAtOrigin } from './binding';
import type { ScanState } from './useScan';

interface BindingRow {
  readonly primer: Primer;
  readonly binding: PrimerBinding;
}

export interface SpecificityProps {
  readonly record: SeqRecord;
  readonly primers: readonly Primer[];
  readonly scan: ScanState;
  readonly view: ViewState;
  readonly selected: number | null;
  readonly onSelect: (index: number) => void;
  readonly onScanLarge: () => void;
  /** Extra overlays to draw beside the bindings, e.g. the pair the designer proposes. */
  readonly extraOverlays: readonly Overlay[];
}

const FORWARD_COLOR = 'var(--accent)';
const REVERSE_COLOR = 'var(--cyan)';

/** Colors the overlays of a primer: the forward primer in the accent color, the reverse one in cyan. */
export function colorOverlays(overlays: readonly Overlay[], forwardId: string): Overlay[] {
  return overlays.map((overlay) => ({
    ...overlay,
    color: overlay.id.startsWith(`primer:${forwardId}:`) ? FORWARD_COLOR : REVERSE_COLOR,
  }));
}

/**
 * Every place each primer binds the loaded sequence, with its mismatches, in the shared table, and the same
 * bindings drawn on the sequence. Clicking a row sets the shared selection, so the plasmid map and the Sequence view
 * show the same range.
 */
export function Specificity(props: SpecificityProps) {
  const { record, primers, scan, view, selected, onSelect } = props;
  const rows = useMemo<BindingRow[]>(() => {
    if (scan.status !== 'ready') return [];
    const byId = new Map(primers.map((primer) => [primer.id, primer]));
    return scan.bindings.flatMap((binding) => {
      const primer = byId.get(binding.primerId);
      return primer ? [{ primer, binding }] : [];
    });
  }, [scan, primers]);

  const columns = useMemo<TableColumn<BindingRow>[]>(
    () => [
      { id: 'primer', header: t('primers.colPrimer'), width: 130, value: (row) => row.primer.name },
      {
        id: 'strand',
        header: t('primers.colStrand'),
        width: 100,
        value: (row) => t(row.binding.strand === 1 ? 'primers.strandForward' : 'primers.strandReverse'),
      },
      {
        id: 'start',
        header: t('primers.colStart'),
        type: 'number',
        width: 90,
        value: (row) => row.binding.span.start + 1,
      },
      {
        id: 'end',
        header: t('primers.colEnd'),
        type: 'number',
        width: 90,
        value: (row) => ((row.binding.span.end - 1) % record.seq.length) + 1,
      },
      {
        id: 'mismatches',
        header: t('primers.colMismatches'),
        type: 'number',
        width: 110,
        value: (row) => row.binding.mismatches,
      },
      {
        id: 'quality',
        header: t('primers.colMatch'),
        width: 120,
        value: (row) => t(row.binding.mismatches === 0 ? 'primers.matchPerfect' : 'primers.matchImperfect'),
      },
    ],
    [record.seq.length],
  );

  const overlays = useMemo(() => {
    if (scan.status !== 'ready') return props.extraOverlays;
    const names = new Map(primers.map((p) => [p.id, p.name]));
    const bindings = splitAtOrigin(scan.bindings, record.seq.length);
    return [...colorOverlays(primerOverlays(bindings, names), 'fwd'), ...props.extraOverlays];
  }, [scan, primers, record.seq.length, props.extraOverlays]);

  const first = scan.status === 'ready' ? scan.bindings[0] : undefined;
  useEffect(() => {
    if (first && view.selection.peek() === null) view.reveal(first.span.start);
  }, [scan.status === 'ready' ? scan.bindings : null]);

  const row = selected === null ? undefined : rows[selected];
  const alignment = row ? bindingAlignment(row.primer.seq, row.binding, record.seq, record.topology) : null;

  let body = null;
  if (primers.length === 0) body = <p class="primers-hint">{t('primers.specificityEmpty')}</p>;
  else if (scan.status === 'skipped')
    body = (
      <div class="primers-hint">
        <p>{t('primers.scanLarge', { length: record.seq.length.toLocaleString() })}</p>
        <button type="button" class="primary-btn" onClick={props.onScanLarge}>
          {t('primers.scanLargeRun')}
        </button>
      </div>
    );
  else if (scan.status === 'pending' || scan.status === 'idle')
    body = <p class="primers-hint">{t('primers.scanning')}</p>;
  else if (rows.length === 0) body = <p class="primers-hint">{t('primers.noBinding')}</p>;

  return (
    <div class="primers-specificity">
      {body}
      {scan.status === 'ready' && rows.length > 0 && (
        <>
          <p class="primers-hint">{t('primers.bindingsSummary', { count: rows.length })}</p>
          <div class="primers-table-frame">
            <Table
              label={t('primers.bindingsLabel')}
              columns={columns}
              rows={rows}
              exportName={`${record.name}-primer-binding-sites`}
              onRowClick={(_, index) => onSelect(index)}
            />
          </div>
          {alignment && row && (
            <div class="primers-alignment">
              <span class="field-label">
                {t('primers.alignmentTitle', { primer: row.primer.name, mismatches: alignment.mismatches })}
              </span>
              <pre class="primers-drawing" role="img" aria-label={t('primers.drawingLabel')}>
                {`5' ${alignment.primer} 3'  ${t('primers.alignPrimer')}\n   ${alignment.marks}\n5' ${alignment.template} 3'  ${t('primers.alignTemplate')}${alignment.tail > 0 ? `\n${t('primers.alignTail', { count: alignment.tail })}` : ''}`}
              </pre>
            </div>
          )}
        </>
      )}
      <div class="primers-sequence">
        <SequenceRenderer
          seq={record.seq}
          alphabet={record.alphabet}
          view={view}
          overlays={overlays}
          label={t('primers.sequenceLabel')}
        />
      </div>
    </div>
  );
}
