import { useId, useMemo } from 'preact/hooks';
import {
  type PrimerAnalysis as Analysis,
  analyzePair,
  analyzePrimer,
  PRIMER3_CONDITIONS,
} from '../../../engine/primers';
import type { PrimerConditions } from '../../../engine/types';
import { useAdvanced } from '../../../state/settings';
import { t } from '../../i18n';
import {
  checkPair,
  checkPrimer,
  cleanPrimer,
  type Finding,
  invalidCharacters,
  type Verdict,
  verdictOf,
} from './analysis';
import { NumberField } from './fields';
import { STANDARD_PRIMERS, standardPrimer } from './standardPrimers';

export interface PrimerSide {
  readonly name: string;
  readonly seq: string;
  readonly onName: (name: string) => void;
  readonly onSeq: (seq: string) => void;
  readonly label: string;
}

/** One primer's entry: name, sequence box, a standard-primer picker and a note for characters that are not bases. */
function PrimerEntry({ side }: { readonly side: PrimerSide }) {
  const nameId = useId();
  const seqId = useId();
  const pickId = useId();
  const clean = cleanPrimer(side.seq);
  const bad = invalidCharacters(clean);
  return (
    <div class="primers-entry">
      <h3 class="primers-entry-title">{side.label}</h3>
      <div class="primers-field">
        <label class="field-label" for={nameId}>
          {t('primers.name')}
        </label>
        <input
          id={nameId}
          type="text"
          value={side.name}
          onInput={(e) => side.onName((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="primers-field">
        <label class="field-label" for={seqId}>
          {t('primers.sequence')}
        </label>
        <input
          id={seqId}
          class="primers-seq-input"
          type="text"
          spellcheck={false}
          autocomplete="off"
          placeholder={t('primers.sequencePlaceholder')}
          value={side.seq}
          aria-invalid={bad.length > 0}
          onInput={(e) => side.onSeq((e.currentTarget as HTMLInputElement).value)}
        />
        <span class="primers-count" aria-live="polite">
          {bad.length > 0
            ? t('primers.invalid', { characters: bad.join(' ') })
            : t('primers.bases', { count: clean.length })}
        </span>
      </div>
      <div class="primers-field">
        <label class="field-label" for={pickId}>
          {t('primers.standard')}
        </label>
        <select
          id={pickId}
          value=""
          onChange={(e) => {
            const picked = standardPrimer((e.currentTarget as HTMLSelectElement).value);
            if (picked) {
              side.onName(picked.name);
              side.onSeq(picked.seq);
            }
            (e.currentTarget as HTMLSelectElement).value = '';
          }}
        >
          <option value="">{t('primers.standardChoose')}</option>
          {STANDARD_PRIMERS.map((primer) => (
            <option key={primer.id} value={primer.id}>
              {`${primer.name} · ${primer.seq}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** The reaction conditions of the Tm and structure calculations. They show in advanced mode, with the primer3 defaults. */
export function ConditionsEditor(props: {
  readonly conditions: PrimerConditions;
  readonly onChange: (conditions: PrimerConditions) => void;
}) {
  const { conditions, onChange } = props;
  const isDefault = (Object.keys(PRIMER3_CONDITIONS) as (keyof PrimerConditions)[]).every(
    (key) => conditions[key] === PRIMER3_CONDITIONS[key],
  );
  return (
    <fieldset class="primers-conditions">
      <legend class="field-label">{t('primers.conditions')}</legend>
      <NumberField
        label={t('primers.na')}
        unit="mM"
        value={conditions.naMm}
        min={0}
        step={1}
        onChange={(naMm) => onChange({ ...conditions, naMm })}
      />
      <NumberField
        label={t('primers.mg')}
        unit="mM"
        value={conditions.mgMm}
        min={0}
        step={0.1}
        onChange={(mgMm) => onChange({ ...conditions, mgMm })}
      />
      <NumberField
        label={t('primers.dntp')}
        unit="mM"
        value={conditions.dntpMm}
        min={0}
        step={0.1}
        onChange={(dntpMm) => onChange({ ...conditions, dntpMm })}
      />
      <NumberField
        label={t('primers.oligo')}
        unit="nM"
        value={conditions.oligoNm}
        min={1}
        step={1}
        onChange={(oligoNm) => onChange({ ...conditions, oligoNm })}
      />
      <button
        type="button"
        class="secondary"
        disabled={isDefault}
        onClick={() => onChange(PRIMER3_CONDITIONS)}
      >
        {t('primers.conditionsReset')}
      </button>
    </fieldset>
  );
}

export function VerdictBadge({ verdict }: { readonly verdict: Verdict }) {
  return <span class={`primers-verdict primers-verdict-${verdict}`}>{t(`primers.verdict.${verdict}`)}</span>;
}

/** The findings of a primer or pair, each with its plain message, the way to fix it and the structure drawn as text. */
export function FindingList({ findings }: { readonly findings: readonly Finding[] }) {
  if (findings.length === 0) return <p class="primers-ok">{t('primers.noProblems')}</p>;
  return (
    <ul class="primers-findings">
      {findings.map((finding) => (
        <li key={finding.id} class={`primers-finding primers-finding-${finding.severity}`}>
          <span class="primers-finding-tag">
            {t(finding.severity === 'bad' ? 'primers.severity.bad' : 'primers.severity.warn')}
          </span>
          <div>
            <p>{t(`primers.finding.${finding.id}`, finding.params)}</p>
            {finding.drawing && (
              <pre class="primers-drawing" role="img" aria-label={t('primers.drawingLabel')}>
                {finding.drawing.join('\n')}
              </pre>
            )}
            <p class="primers-fix">{t(`primers.fix.${finding.id}`)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Kpi(props: { readonly label: string; readonly value: string; readonly note?: string }) {
  return (
    <div class="primers-kpi">
      <span class="field-label">{props.label}</span>
      <strong>{props.value}</strong>
      {props.note && <span class="primers-kpi-note">{props.note}</span>}
    </div>
  );
}

function PrimerCard(props: {
  readonly title: string;
  readonly analysis: Analysis;
  readonly findings: readonly Finding[];
}) {
  const { analysis, findings } = props;
  return (
    <div class="primers-result">
      <div class="primers-result-head">
        <h3 class="primers-entry-title">{props.title}</h3>
        <VerdictBadge verdict={verdictOf(findings)} />
      </div>
      <div class="primers-kpis">
        <Kpi label={t('primers.length')} value={`${analysis.length} nt`} />
        <Kpi label={t('primers.gc')} value={`${analysis.gcPercent.toFixed(1)} %`} />
        <Kpi label={t('primers.tm')} value={`${analysis.tm.toFixed(1)} °C`} note={t('primers.tmNote')} />
        <Kpi
          label={t('primers.endStability')}
          value={`${analysis.endStability.toFixed(1)} kcal/mol`}
          note={t('primers.endStabilityNote')}
        />
      </div>
      <p class="primers-tm-other">
        {t('primers.tmOthers', {
          wallace: analysis.tmBasic.wallace.toFixed(1),
          gc: analysis.tmBasic.gc.toFixed(1),
          biopython: analysis.tmBasic.biopythonNN.toFixed(1),
        })}
      </p>
      <FindingList findings={findings} />
    </div>
  );
}

export interface PrimerAnalysisSectionProps {
  readonly forward: PrimerSide;
  readonly reverse: PrimerSide;
  readonly conditions: PrimerConditions;
  readonly onConditions: (conditions: PrimerConditions) => void;
  readonly mismatches: number;
  readonly onMismatches: (value: number) => void;
}

/**
 * Manual entry of a forward and a reverse primer with the live analysis: length, GC, Tm by nearest-neighbor and
 * the simpler formulas, 3' stability, hairpin, self-dimers and the pair's cross-dimer, and one verdict to act on.
 */
export function PrimerAnalysisSection(props: PrimerAnalysisSectionProps) {
  const advanced = useAdvanced();
  const { forward, reverse, conditions } = props;
  const fwd = cleanPrimer(forward.seq);
  const rev = cleanPrimer(reverse.seq);
  const fwdOk = fwd.length > 0 && invalidCharacters(fwd).length === 0;
  const revOk = rev.length > 0 && invalidCharacters(rev).length === 0;

  const fwdAnalysis = useMemo(
    () => (fwdOk ? analyzePrimer(fwd, { conditions }) : null),
    [fwd, fwdOk, conditions],
  );
  const revAnalysis = useMemo(
    () => (revOk ? analyzePrimer(rev, { conditions }) : null),
    [rev, revOk, conditions],
  );
  const pair = useMemo(
    () => (fwdOk && revOk ? analyzePair(fwd, rev, conditions) : null),
    [fwd, rev, fwdOk, revOk, conditions],
  );

  const fwdFindings = fwdAnalysis ? checkPrimer(fwd, fwdAnalysis) : [];
  const revFindings = revAnalysis ? checkPrimer(rev, revAnalysis) : [];
  const pairFindings = pair ? checkPair(fwd, rev, pair) : [];
  const overall = verdictOf([...fwdFindings, ...revFindings, ...pairFindings]);
  const entered = fwdAnalysis !== null || revAnalysis !== null;

  return (
    <div class="primers-analysis">
      <div class="primers-grid">
        <PrimerEntry side={forward} />
        <PrimerEntry side={reverse} />
      </div>
      {advanced && (
        <div class="primers-advanced">
          <ConditionsEditor conditions={conditions} onChange={props.onConditions} />
          <NumberField
            label={t('primers.mismatches')}
            value={props.mismatches}
            min={0}
            max={6}
            step={1}
            onChange={props.onMismatches}
          />
        </div>
      )}
      {!entered && <p class="primers-hint">{t('primers.emptyAnalysis')}</p>}
      {entered && (
        <div class="primers-overall" aria-live="polite">
          <span class="field-label">{t('primers.overall')}</span>
          <VerdictBadge verdict={overall} />
          <span class="primers-overall-text">{t(`primers.verdictText.${overall}`)}</span>
        </div>
      )}
      <div class="primers-grid">
        {fwdAnalysis && (
          <PrimerCard title={forward.name || forward.label} analysis={fwdAnalysis} findings={fwdFindings} />
        )}
        {revAnalysis && (
          <PrimerCard title={reverse.name || reverse.label} analysis={revAnalysis} findings={revFindings} />
        )}
      </div>
      {pair && (
        <div class="primers-result">
          <div class="primers-result-head">
            <h3 class="primers-entry-title">{t('primers.pair')}</h3>
            <VerdictBadge verdict={verdictOf(pairFindings)} />
          </div>
          <p class="primers-tm-other">
            {t('primers.pairNumbers', { delta: pair.deltaTm.toFixed(1), dg: pair.crossDimer.dg.toFixed(1) })}
          </p>
          <FindingList findings={pairFindings} />
        </div>
      )}
    </div>
  );
}
