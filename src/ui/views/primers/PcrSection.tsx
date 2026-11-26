import { useMemo } from 'preact/hooks';
import type { Amplicon, Primer, SeqRecord } from '../../../engine/types';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import type { GelLaneInput } from '../gel/Gel';
import { GelPanel, type GelSettings } from '../gel/GelPanel';
import { SequenceActions } from '../gel/SequenceActions';
import type { ScanState } from './useScan';

interface ProductRow {
  readonly index: number;
  readonly amplicon: Amplicon;
  readonly forward: string;
  readonly reverse: string;
  /** 1-based, inclusive, on the template. */
  readonly start: number;
  readonly end: number;
}

export interface PcrSectionProps {
  readonly record: SeqRecord;
  readonly primers: readonly Primer[];
  readonly scan: ScanState;
  readonly selected: number | null;
  readonly onSelect: (index: number) => void;
  readonly gel: GelSettings;
  readonly onColony: () => void;
  readonly onScanLarge: () => void;
}

const PREVIEW = 20;
const preview = (seq: string) =>
  seq.length <= PREVIEW * 2 + 1 ? seq : `${seq.slice(0, PREVIEW)}…${seq.slice(-PREVIEW)}`;

/**
 * Virtual PCR: the products of the primers on this sequence, linear or circular and across the origin, each with
 * its length, positions and sequence (copy, FASTA, GenBank), and all products on the gel. Colony PCR is the same
 * run on a plasmid that carries an insert, so the colony button loads vector primers that flank the cloning site.
 */
export function PcrSection(props: PcrSectionProps) {
  const { record, primers, scan, selected } = props;
  const n = record.seq.length;
  const names = useMemo(() => new Map(primers.map((p) => [p.id, p.name])), [primers]);

  const rows = useMemo<ProductRow[]>(() => {
    if (scan.status !== 'ready') return [];
    return scan.amplicons.map((amplicon, index) => ({
      index,
      amplicon,
      forward: names.get(amplicon.forward.primerId) ?? amplicon.forward.primerId,
      reverse: names.get(amplicon.reverse.primerId) ?? amplicon.reverse.primerId,
      start: amplicon.forward.span.start + 1,
      end: ((amplicon.reverse.span.end - 1) % n) + 1,
    }));
  }, [scan, names, n]);

  const columns = useMemo<TableColumn<ProductRow>[]>(
    () => [
      {
        id: 'number',
        header: '#',
        type: 'number',
        width: 60,
        value: (row) => row.index + 1,
        format: (value, row) => (selected === row.index ? `▶ ${value}` : String(value)),
      },
      { id: 'forward', header: t('pcr.colForward'), width: 130, value: (row) => row.forward },
      { id: 'reverse', header: t('pcr.colReverse'), width: 130, value: (row) => row.reverse },
      {
        id: 'length',
        header: t('pcr.colLength'),
        type: 'number',
        width: 100,
        value: (row) => row.amplicon.length,
        format: (value) => Number(value).toLocaleString(),
      },
      { id: 'start', header: t('pcr.colStart'), type: 'number', width: 90, value: (row) => row.start },
      { id: 'end', header: t('pcr.colEnd'), type: 'number', width: 90, value: (row) => row.end },
      {
        id: 'origin',
        header: t('pcr.colOrigin'),
        width: 110,
        value: (row) => (row.amplicon.wrapsOrigin ? t('pcr.acrossOrigin') : ''),
      },
      {
        id: 'mismatches',
        header: t('pcr.colMismatches'),
        type: 'number',
        width: 110,
        value: (row) => row.amplicon.forward.mismatches + row.amplicon.reverse.mismatches,
      },
      {
        id: 'sequence',
        header: t('pcr.colSequence'),
        width: 330,
        value: (row) => row.amplicon.seq,
        format: (value) => preview(String(value)),
      },
    ],
    [selected],
  );

  const lanes = useMemo<GelLaneInput[]>(
    () =>
      rows.length > 0
        ? [{ id: 'pcr', label: t('pcr.laneLabel'), sizes: rows.map((row) => row.amplicon.length) }]
        : [],
    [rows],
  );
  const row = selected === null ? undefined : rows[selected];
  const productRecord = useMemo<SeqRecord | null>(
    () =>
      row
        ? {
            id: `${record.name}_pcr_${row.amplicon.length}bp`,
            name: `${record.name}_pcr_${row.amplicon.length}bp`,
            description: `${row.amplicon.length} bp PCR product of ${row.forward} and ${row.reverse} on ${record.name}`,
            alphabet: 'dna',
            topology: 'linear',
            seq: row.amplicon.seq,
            features: [],
            metadata: {},
          }
        : null,
    [row, record.name],
  );

  const colony = (
    <div class="primers-colony">
      <p class="primers-hint">{t('pcr.colonyHint')}</p>
      <button type="button" class="secondary" onClick={props.onColony}>
        {t('pcr.colonyButton')}
      </button>
    </div>
  );

  if (primers.length === 0)
    return (
      <div class="primers-pcr">
        <p class="primers-hint">{t('pcr.empty')}</p>
        {colony}
      </div>
    );
  if (scan.status === 'skipped')
    return (
      <div class="primers-pcr">
        <p class="primers-hint">{t('primers.scanLarge', { length: n.toLocaleString() })}</p>
        <button type="button" class="primary-btn" onClick={props.onScanLarge}>
          {t('primers.scanLargeRun')}
        </button>
      </div>
    );
  if (scan.status !== 'ready')
    return (
      <div class="primers-pcr">
        <p class="primers-hint">{t('primers.scanning')}</p>
      </div>
    );

  return (
    <div class="primers-pcr">
      {colony}
      {rows.length === 0 ? (
        <p class="primers-hint" role="status">
          {t('pcr.noProducts', { topology: t(`topology.${record.topology}`) })}
        </p>
      ) : (
        <>
          <p class="primers-hint">{t('pcr.productsFound', { count: rows.length })}</p>
          <div class="primers-table-frame primers-pairs-frame">
            <Table
              label={t('pcr.productsLabel')}
              columns={columns}
              rows={rows}
              exportName={`${record.name}-pcr-products`}
              onRowClick={(_, index) => props.onSelect(index)}
            />
          </div>
          <div class="primers-product" aria-live="polite">
            {row && productRecord ? (
              <>
                <div class="primers-result-head">
                  <span class="field-label">
                    {t('pcr.selected', {
                      number: row.index + 1,
                      length: row.amplicon.length.toLocaleString(),
                    })}
                  </span>
                  <SequenceActions record={productRecord} />
                </div>
                <textarea
                  class="primers-product-seq"
                  readOnly
                  rows={4}
                  spellcheck={false}
                  aria-label={t('pcr.sequenceLabel')}
                  value={
                    productRecord.seq.length > 6000
                      ? `${productRecord.seq.slice(0, 6000)}…`
                      : productRecord.seq
                  }
                />
              </>
            ) : (
              <p class="primers-hint">{t('pcr.selectHint')}</p>
            )}
          </div>
          <GelPanel
            title={t('pcr.gelTitle')}
            settings={props.gel}
            lanes={lanes}
            selected={row ? { lane: 'pcr', size: row.amplicon.length } : null}
            onSelect={(_, sizes) => {
              const index = rows.findIndex((r) => sizes.includes(r.amplicon.length));
              if (index >= 0) props.onSelect(index);
            }}
            exportName={`${record.name}-pcr-gel`}
          />
        </>
      )}
    </div>
  );
}
