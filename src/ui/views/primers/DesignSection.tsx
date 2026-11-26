import type { Signal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import type { PrimerPair } from '../../../engine/primers';
import type { PrimerConditions, Span } from '../../../engine/types';
import { useAdvanced } from '../../../state/settings';
import type { SelectionRange, ViewState } from '../../../state/view';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { designForRegion, explainPair } from './design';
import { NumberField } from './fields';
import { type ConstraintInputs, DEFAULT_INPUTS, type DesignState, toConstraints } from './state';

export interface DesignSectionProps {
  readonly seq: string;
  readonly topology: 'linear' | 'circular';
  readonly view: ViewState;
  readonly conditions: PrimerConditions;
  readonly regionStart: Signal<string>;
  readonly regionEnd: Signal<string>;
  readonly inputs: Signal<ConstraintInputs>;
  readonly design: Signal<DesignState>;
  readonly pair: Signal<number | null>;
  readonly onTake: (pair: PrimerPair) => void;
  readonly onAdd: (pair: PrimerPair) => void;
}

/** The region the user typed as a 0-based half-open span, or null when the box content is not a valid region. */
export function parseRegion(start: string, end: string, length: number, circular: boolean): Span | null {
  const from = Number(start);
  const to = Number(end);
  if (!Number.isInteger(from) || !Number.isInteger(to) || start.trim() === '' || end.trim() === '')
    return null;
  if (from < 1 || from > length || to < 1 || to > length) return null;
  if (to < from && !circular) return null;
  return { start: from - 1, end: to };
}

const dg = (value: number) => value.toFixed(1);

/**
 * Automatic design: the user picks a region (the selection in the Sequence view, or typed coordinates), sets the
 * constraints and gets ranked pairs with the reason for each score. A pair can go into the manual fields or into
 * the sequence's annotations.
 */
export function DesignSection(props: DesignSectionProps) {
  const advanced = useAdvanced();
  const { seq, topology, view, conditions, inputs, design } = props;
  const selection: SelectionRange | null = view.selection.value;
  const region = parseRegion(
    props.regionStart.value,
    props.regionEnd.value,
    seq.length,
    topology === 'circular',
  );
  const filled = props.regionStart.value.trim() !== '' || props.regionEnd.value.trim() !== '';
  const values = inputs.value;
  const set = (patch: Partial<ConstraintInputs>) => {
    inputs.value = { ...inputs.value, ...patch };
  };

  const run = () => {
    if (!region) return;
    const constraints = toConstraints(inputs.value, conditions);
    design.value = { status: 'running' };
    props.pair.value = null;
    setTimeout(() => {
      try {
        const pairs = designForRegion(seq, topology, region, constraints);
        design.value = { status: 'done', pairs, constraints, target: region };
        props.pair.value = pairs.length > 0 ? 0 : null;
      } catch (error) {
        design.value = { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
      }
    }, 30);
  };

  const result = design.value;
  const pairs = result.status === 'done' ? result.pairs : [];
  const selectedPair = props.pair.value === null ? undefined : pairs[props.pair.value];
  const why = selectedPair && result.status === 'done' ? explainPair(selectedPair, result.constraints) : null;

  const columns = useMemo<TableColumn<PrimerPair & { rank: number }>[]>(
    () => [
      { id: 'rank', header: '#', type: 'number', width: 50, value: (row) => row.rank },
      { id: 'forward', header: t('primers.designForward'), width: 190, value: (row) => row.forward.seq },
      { id: 'reverse', header: t('primers.designReverse'), width: 190, value: (row) => row.reverse.seq },
      {
        id: 'product',
        header: t('primers.designProduct'),
        type: 'number',
        width: 100,
        value: (row) => row.productSize,
      },
      {
        id: 'tmF',
        header: t('primers.designTmForward'),
        type: 'number',
        width: 90,
        value: (row) => Number(row.forward.tm.toFixed(1)),
      },
      {
        id: 'tmR',
        header: t('primers.designTmReverse'),
        type: 'number',
        width: 90,
        value: (row) => Number(row.reverse.tm.toFixed(1)),
      },
      {
        id: 'deltaTm',
        header: t('primers.designDeltaTm'),
        type: 'number',
        width: 90,
        value: (row) => Number(row.deltaTm.toFixed(2)),
      },
      {
        id: 'penalty',
        header: t('primers.designPenalty'),
        type: 'number',
        width: 90,
        value: (row) => Number(row.penalty.toFixed(2)),
      },
    ],
    [],
  );
  const rows = useMemo(() => pairs.map((pair, i) => ({ ...pair, rank: i + 1 })), [pairs]);

  return (
    <div class="primers-design">
      <div class="primers-grid primers-region">
        <NumberField
          label={t('primers.regionStart')}
          value={props.regionStart.value === '' ? null : Number(props.regionStart.value)}
          min={1}
          max={seq.length}
          onChange={(v) => (props.regionStart.value = String(v))}
        />
        <NumberField
          label={t('primers.regionEnd')}
          value={props.regionEnd.value === '' ? null : Number(props.regionEnd.value)}
          min={1}
          max={seq.length}
          onChange={(v) => (props.regionEnd.value = String(v))}
        />
        <div class="primers-field primers-region-actions">
          <button
            type="button"
            class="secondary"
            disabled={selection === null}
            onClick={() => {
              if (!selection) return;
              props.regionStart.value = String(selection.start + 1);
              props.regionEnd.value = String(selection.end);
            }}
          >
            {selection
              ? t('primers.useSelection', {
                  start: (selection.start + 1).toLocaleString(),
                  end: selection.end.toLocaleString(),
                })
              : t('primers.useSelectionNone')}
          </button>
        </div>
      </div>
      {filled && !region && (
        <p class="primers-error" role="alert">
          {t('primers.regionInvalid', { length: seq.length.toLocaleString() })}
        </p>
      )}
      {!filled && <p class="primers-hint">{t('primers.regionHint')}</p>}

      <fieldset class="primers-constraints">
        <legend class="field-label">{t('primers.constraints')}</legend>
        <NumberField
          label={t('primers.tmMin')}
          unit="°C"
          value={values.tmMin}
          min={30}
          max={90}
          step={0.5}
          onChange={(tmMin) => set({ tmMin })}
        />
        <NumberField
          label={t('primers.tmMax')}
          unit="°C"
          value={values.tmMax}
          min={30}
          max={90}
          step={0.5}
          onChange={(tmMax) => set({ tmMax })}
        />
        <NumberField
          label={t('primers.lengthMin')}
          unit="nt"
          value={values.lengthMin}
          min={10}
          max={60}
          step={1}
          onChange={(lengthMin) => set({ lengthMin })}
        />
        <NumberField
          label={t('primers.lengthMax')}
          unit="nt"
          value={values.lengthMax}
          min={10}
          max={60}
          step={1}
          onChange={(lengthMax) => set({ lengthMax })}
        />
        <NumberField
          label={t('primers.gcMin')}
          unit="%"
          value={values.gcMin}
          min={0}
          max={100}
          step={1}
          onChange={(gcMin) => set({ gcMin })}
        />
        <NumberField
          label={t('primers.gcMax')}
          unit="%"
          value={values.gcMax}
          min={0}
          max={100}
          step={1}
          onChange={(gcMax) => set({ gcMax })}
        />
        <NumberField
          label={t('primers.productMin')}
          unit="bp"
          value={values.productMin}
          min={20}
          max={50000}
          step={10}
          onChange={(productMin) => set({ productMin })}
        />
        <NumberField
          label={t('primers.productMax')}
          unit="bp"
          value={values.productMax}
          min={20}
          max={50000}
          step={10}
          onChange={(productMax) => set({ productMax })}
        />
        <NumberField
          label={t('primers.maxDeltaTm')}
          unit="°C"
          value={values.maxDeltaTm}
          min={0}
          max={20}
          step={0.5}
          onChange={(maxDeltaTm) => set({ maxDeltaTm })}
        />
        {advanced && (
          <>
            <NumberField
              label={t('primers.tmOpt')}
              unit="°C"
              value={values.tmOpt}
              min={30}
              max={90}
              step={0.5}
              onChange={(tmOpt) => set({ tmOpt })}
            />
            <NumberField
              label={t('primers.lengthOpt')}
              unit="nt"
              value={values.lengthOpt}
              min={10}
              max={60}
              step={1}
              onChange={(lengthOpt) => set({ lengthOpt })}
            />
            <NumberField
              label={t('primers.minStructureDg')}
              unit="kcal/mol"
              value={values.minStructureDg}
              min={-30}
              max={0}
              step={0.5}
              onChange={(minStructureDg) => set({ minStructureDg })}
            />
          </>
        )}
        <button type="button" class="secondary" onClick={() => (inputs.value = DEFAULT_INPUTS)}>
          {t('primers.constraintsReset')}
        </button>
      </fieldset>

      <div class="primers-actions">
        <button
          type="button"
          class="primary-btn"
          disabled={!region || result.status === 'running'}
          onClick={run}
        >
          {result.status === 'running' ? t('primers.designing') : t('primers.design')}
        </button>
      </div>

      {result.status === 'failed' && (
        <p class="primers-error" role="alert">
          {t('primers.designFailed', { reason: result.reason })}
        </p>
      )}
      {result.status === 'done' && pairs.length === 0 && (
        <p class="primers-hint" role="status">
          {t('primers.noPairs')}
        </p>
      )}
      {pairs.length > 0 && (
        <>
          <p class="primers-hint">{t('primers.pairsFound', { count: pairs.length })}</p>
          <div class="primers-table-frame primers-pairs-frame">
            <Table
              label={t('primers.pairsLabel')}
              columns={columns}
              rows={rows}
              exportName="designed-primer-pairs"
              onRowClick={(_, index) => (props.pair.value = index)}
            />
          </div>
        </>
      )}
      {selectedPair && why && (
        <div class="primers-why" aria-live="polite">
          <div class="primers-result-head">
            <h3 class="primers-entry-title">
              {t('primers.whyTitle', { rank: (props.pair.value ?? 0) + 1, penalty: why.total.toFixed(2) })}
            </h3>
            <span class="primers-actions-inline">
              <button type="button" class="primary-btn" onClick={() => props.onTake(selectedPair)}>
                {t('primers.take')}
              </button>
              <button type="button" class="secondary" onClick={() => props.onAdd(selectedPair)}>
                {t('primers.addPairToSequence')}
              </button>
            </span>
          </div>
          <p class="primers-hint">{t('primers.whyIntro')}</p>
          <table class="primers-why-table">
            <thead>
              <tr>
                <th scope="col">{t('primers.whyRow')}</th>
                <th scope="col">{t('primers.whyTm')}</th>
                <th scope="col">{t('primers.whyLength')}</th>
                <th scope="col">{t('primers.whyStructure')}</th>
                <th scope="col">{t('primers.whyDeltaTm')}</th>
                <th scope="col">{t('primers.whyCross')}</th>
                <th scope="col">{t('primers.whyTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  [t('primers.designForward'), selectedPair.forward, why.forward],
                  [t('primers.designReverse'), selectedPair.reverse, why.reverse],
                ] as const
              ).map(([label, primer, terms]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{t('primers.whyTmCell', { tm: primer.tm.toFixed(1), points: terms.tm.toFixed(2) })}</td>
                  <td>
                    {t('primers.whyLengthCell', {
                      length: primer.span.end - primer.span.start,
                      points: terms.length.toFixed(2),
                    })}
                  </td>
                  <td>
                    {t('primers.whyStructureCell', {
                      hairpin: dg(primer.hairpinDg),
                      dimer: dg(primer.selfDimerDg),
                      points: terms.structure.toFixed(2),
                    })}
                  </td>
                  <td>–</td>
                  <td>–</td>
                  <td>{terms.total.toFixed(2)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">{t('primers.pair')}</th>
                <td>–</td>
                <td>–</td>
                <td>–</td>
                <td>
                  {t('primers.whyDeltaTmCell', {
                    delta: selectedPair.deltaTm.toFixed(2),
                    points: why.deltaTm.toFixed(2),
                  })}
                </td>
                <td>
                  {t('primers.whyCrossCell', {
                    dg: dg(selectedPair.crossDimerDg),
                    points: why.crossDimer.toFixed(2),
                  })}
                </td>
                <td>{(why.deltaTm + why.crossDimer).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <p class="primers-hint">
            {t('primers.whyPositions', {
              fStart: ((selectedPair.forward.span.start % seq.length) + 1).toLocaleString(),
              fEnd: (((selectedPair.forward.span.end - 1) % seq.length) + 1).toLocaleString(),
              rStart: ((selectedPair.reverse.span.start % seq.length) + 1).toLocaleString(),
              rEnd: (((selectedPair.reverse.span.end - 1) % seq.length) + 1).toLocaleString(),
              product: selectedPair.productSize,
            })}
          </p>
        </div>
      )}
    </div>
  );
}
