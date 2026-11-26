import { useMemo } from 'preact/hooks';
import type { Orf } from '../../../engine/orf';
import type { ProteinProperties } from '../../../engine/summary';
import type { Language } from '../../../state/settings';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { formatFixed, formatInt, formatMass } from './model';
import { Pending } from './Pending';
import { Section } from './Section';

const ROW_PX = 28;
const TABLE_PX = 7 * ROW_PX + 32 + 44;
const UNSTABLE_ABOVE = 40;

interface PropertyRow {
  readonly id: string;
  readonly name: string;
  readonly raw: number;
  readonly shown: string;
  readonly unit: string;
  readonly note: string;
}

function propertyRows(p: ProteinProperties, language: Language): PropertyRow[] {
  const fixed = (value: number, digits: number) => formatFixed(value, digits, language);
  return [
    {
      id: 'weight',
      name: t('summary.protein.weight'),
      raw: p.weight,
      shown: formatMass(p.weight, language),
      unit: 'g/mol',
      note: formatInt(Math.round(p.weight), language),
    },
    {
      id: 'pi',
      name: t('summary.protein.pi'),
      raw: p.isoelectricPoint,
      shown: fixed(p.isoelectricPoint, 2),
      unit: 'pH',
      note: '',
    },
    {
      id: 'charge',
      name: t('summary.protein.charge'),
      raw: p.charge,
      shown: fixed(p.charge, 2),
      unit: 'e',
      note: '',
    },
    {
      id: 'extinction',
      name: t('summary.protein.extinction'),
      raw: p.extinction.reduced,
      shown: formatInt(p.extinction.reduced, language),
      unit: 'M⁻¹ cm⁻¹',
      note: t('summary.protein.extinctionNote', { cystine: formatInt(p.extinction.cystine, language) }),
    },
    {
      id: 'instability',
      name: t('summary.protein.instability'),
      raw: p.instabilityIndex,
      shown: fixed(p.instabilityIndex, 2),
      unit: '',
      note: t(p.instabilityIndex > UNSTABLE_ABOVE ? 'summary.protein.unstable' : 'summary.protein.stable'),
    },
    {
      id: 'gravy',
      name: t('summary.protein.gravy'),
      raw: p.gravy,
      shown: fixed(p.gravy, 3),
      unit: '',
      note: t('summary.protein.gravyNote'),
    },
    {
      id: 'aromaticity',
      name: t('summary.protein.aromaticity'),
      raw: p.aromaticity * 100,
      shown: fixed(p.aromaticity * 100, 1),
      unit: '%',
      note: t('summary.protein.aromaticityNote'),
    },
  ];
}

/** Label of an ORF in the translation picker: frame, length and the 1-based position of its first base (its 5' end). */
export function orfLabel(orf: Orf, language: Language): string {
  const first = orf.location.segments[0];
  const start = first ? (orf.location.strand === 1 ? first.start + 1 : first.end) : 1;
  return t('summary.protein.orfOption', {
    frame: `${orf.frame > 0 ? '+' : '−'}${Math.abs(orf.frame)}`,
    length: formatInt(orf.lengthAa, language),
    start: formatInt(start, language),
  });
}

/** What the section describes: the record itself, or one ORF the user picks from the longest few. */
export type ProteinSource =
  | { readonly kind: 'pending' | 'failed' | 'none'; readonly reason?: string }
  | {
      readonly kind: 'ready';
      readonly properties: ProteinProperties;
      readonly picker?: {
        readonly orfs: readonly Orf[];
        readonly index: number;
        readonly onPick: (index: number) => void;
      };
    };

/**
 * Molecular weight, pI, net charge, extinction coefficient, instability index, GRAVY and aromaticity of a protein
 * as a table that copies and exports. For a nucleotide record the protein is the ORF the user picks.
 */
export function ProteinSection({
  source,
  title,
  language,
  minCodons,
}: {
  readonly source: ProteinSource;
  readonly title: string;
  readonly language: Language;
  readonly minCodons: number;
}) {
  const rows = useMemo(
    () => (source.kind === 'ready' ? propertyRows(source.properties, language) : []),
    [source, language],
  );
  const columns = useMemo(
    (): TableColumn<PropertyRow>[] => [
      { id: 'property', header: t('summary.protein.property'), value: (row) => row.name, width: 260 },
      {
        id: 'value',
        header: t('summary.protein.value'),
        type: 'number',
        value: (row) => row.raw,
        format: (_value, row) => row.shown,
        width: 120,
      },
      { id: 'unit', header: t('summary.protein.unit'), value: (row) => row.unit, width: 90 },
      { id: 'note', header: t('summary.protein.note'), value: (row) => row.note, width: 280 },
    ],
    [language],
  );

  const picker = source.kind === 'ready' ? source.picker : undefined;
  return (
    <Section number="04" title={title}>
      {picker && (
        <div class="orf-picker">
          <label class="field-label" for="summary-orf">
            {t('summary.protein.translation')}
          </label>
          <select
            id="summary-orf"
            class="orf-select"
            value={picker.index}
            onChange={(event) => picker.onPick(Number(event.currentTarget.value))}
          >
            {picker.orfs.map((orf, index) => (
              <option key={`${orf.frame}:${orf.location.segments[0]?.start}`} value={index}>
                {orfLabel(orf, language)}
              </option>
            ))}
          </select>
        </div>
      )}
      {source.kind === 'ready' ? (
        <div class="protein-table" style={{ height: `${TABLE_PX}px` }}>
          <Table
            label={t('summary.protein.table')}
            columns={columns}
            rows={rows}
            exportName="protein-properties"
          />
        </div>
      ) : source.kind === 'none' ? (
        <p class="summary-empty">{t('summary.protein.noOrf', { min: minCodons })}</p>
      ) : (
        <Pending
          state={
            source.kind === 'failed'
              ? { status: 'failed', reason: source.reason ?? '' }
              : { status: 'pending' }
          }
          height={TABLE_PX}
          message={t('summary.protein.pending')}
        />
      )}
    </Section>
  );
}
