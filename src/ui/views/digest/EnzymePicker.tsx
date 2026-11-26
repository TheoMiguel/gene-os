import { useMemo } from 'preact/hooks';
import { type RestrictionScan, SUPPLIERS } from '../../../engine/restriction';
import { useAdvanced } from '../../../state/settings';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { type EnzymeChoices, type EnzymeRow, enzymeRows, siteWithCut } from './model';

const END_OPTIONS = ['all', 'blunt', 'five_prime', 'three_prime'] as const;
const CUT_OPTIONS = ['all', 'non_cutter', 'unique', 'double', 'multiple'] as const;

interface EnzymePickerProps {
  readonly scan: RestrictionScan;
  readonly choices: EnzymeChoices;
  readonly onChoices: (choices: EnzymeChoices) => void;
  readonly chosen: readonly string[];
  readonly onToggle: (name: string) => void;
  readonly onClear: () => void;
}

/**
 * The enzyme catalog as a searchable table with the cut count of every enzyme on this sequence, filters for end
 * type, cut count and supplier, and the chosen enzymes as removable chips. A click or Enter on a row toggles it.
 */
export function EnzymePicker({ scan, choices, onChoices, chosen, onToggle, onClear }: EnzymePickerProps) {
  const advanced = useAdvanced();
  const rows = useMemo(() => enzymeRows(scan, choices), [scan, choices]);
  const picked = useMemo(() => new Set(chosen), [chosen]);

  const columns = useMemo<TableColumn<EnzymeRow>[]>(() => {
    const base: TableColumn<EnzymeRow>[] = [
      {
        id: 'chosen',
        header: t('digest.colChosen'),
        width: 64,
        value: (row) => picked.has(row.enzyme.name),
        format: (value) => (value ? '✓' : ''),
      },
      { id: 'name', header: t('digest.colEnzyme'), width: 110, value: (row) => row.enzyme.name },
      { id: 'site', header: t('digest.colSite'), width: 150, value: (row) => siteWithCut(row.enzyme) },
      {
        id: 'cuts',
        header: t('digest.colCuts'),
        type: 'number',
        width: 70,
        value: (row) => row.cuts,
      },
      {
        id: 'ends',
        header: t('digest.colEnds'),
        width: 110,
        value: (row) => t(`digest.end.${row.end}`),
      },
      {
        id: 'suppliers',
        header: t('digest.colSuppliers'),
        width: 100,
        value: (row) => row.enzyme.suppliers.join(' '),
      },
    ];
    if (advanced)
      base.push({
        id: 'isoschizomer',
        header: t('digest.colIsoschizomer'),
        width: 120,
        value: (row) => row.enzyme.isoschizomerOf ?? '',
      });
    return base;
  }, [picked, advanced]);

  return (
    <div class="digest-picker">
      <div class="digest-filters">
        <label class="digest-filter">
          <span class="field-label">{t('digest.filterEnds')}</span>
          <select
            value={choices.endType}
            onChange={(event) =>
              onChoices({
                ...choices,
                endType: (event.currentTarget as HTMLSelectElement).value as EnzymeChoices['endType'],
              })
            }
          >
            {END_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(option === 'all' ? 'digest.filterAll' : `digest.end.${option}`)}
              </option>
            ))}
          </select>
        </label>
        <label class="digest-filter">
          <span class="field-label">{t('digest.filterCuts')}</span>
          <select
            value={choices.cuts}
            onChange={(event) =>
              onChoices({
                ...choices,
                cuts: (event.currentTarget as HTMLSelectElement).value as EnzymeChoices['cuts'],
              })
            }
          >
            {CUT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(option === 'all' ? 'digest.filterAll' : `digest.cuts.${option}`)}
              </option>
            ))}
          </select>
        </label>
        <label class="digest-filter">
          <span class="field-label">{t('digest.filterSupplier')}</span>
          <select
            value={choices.supplier}
            onChange={(event) =>
              onChoices({ ...choices, supplier: (event.currentTarget as HTMLSelectElement).value })
            }
          >
            <option value="all">{t('digest.filterAll')}</option>
            {Object.entries(SUPPLIERS).map(([code, name]) => (
              <option key={code} value={code}>
                {`${code} · ${name}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="digest-chosen" aria-live="polite">
        <span class="field-label">{t('digest.chosen')}</span>
        {chosen.length === 0 ? (
          <span class="digest-hint">{t('digest.chosenNone')}</span>
        ) : (
          <>
            {chosen.map((name) => {
              const row = scan.sites.find((sites) => sites.enzyme.name === name);
              const cuts = row ? row.topCuts.length : 0;
              return (
                <button
                  key={name}
                  type="button"
                  class="digest-chip"
                  title={t('digest.chipRemove', { enzyme: name })}
                  aria-label={t('digest.chipRemove', { enzyme: name })}
                  onClick={() => onToggle(name)}
                >
                  {t('digest.chipLabel', { enzyme: name, count: cuts })}
                </button>
              );
            })}
            <button type="button" class="secondary digest-clear" onClick={onClear}>
              {t('digest.clear')}
            </button>
          </>
        )}
      </div>
      <p class="digest-hint">{t('digest.pickHint', { count: rows.length })}</p>
      <div class="digest-table-frame">
        <Table
          label={t('digest.catalogLabel')}
          columns={columns}
          rows={rows}
          exportName="enzymes"
          initialSort={{ column: 'name', direction: 'asc' }}
          onRowClick={(row) => onToggle(row.enzyme.name)}
        />
      </div>
    </div>
  );
}
