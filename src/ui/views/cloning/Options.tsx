import { useMemo } from 'preact/hooks';
import { GOLDEN_GATE_ENZYMES } from '../../../engine/cloning';
import type { SeqRecord } from '../../../engine/types';
import { useAdvanced } from '../../../state/settings';
import { viewOf } from '../../../state/view';
import { t } from '../../i18n';
import { ATT_VARIANTS, type CloningSetup, METHODS, OVERLAP_DEFAULTS, singleCutters } from './model';

type Patch = (patch: Partial<CloningSetup>) => void;

interface OptionProps {
  readonly setup: CloningSetup;
  readonly onChange: Patch;
  readonly vector: SeqRecord | null;
  readonly vectorDocId: string | null;
}

const DNTPS = ['A', 'C', 'G', 'T'] as const;

/** The seven methods as radio cards, each with one sentence on what it is for. */
export function MethodChooser(props: { readonly setup: CloningSetup; readonly onChange: Patch }) {
  return (
    <fieldset class="clone-methods">
      <legend class="visually-hidden">{t('clone.method.title')}</legend>
      {METHODS.map(({ id }) => (
        <label key={id} class={`clone-choice${props.setup.method === id ? ' selected' : ''}`}>
          <input
            type="radio"
            name="clone-method"
            class="visually-hidden"
            checked={props.setup.method === id}
            onChange={() => props.onChange({ method: id })}
          />
          <strong>{t(`clone.method.${id}`)}</strong>
          <p>{t(`clone.method.${id}Hint`)}</p>
        </label>
      ))}
    </fieldset>
  );
}

function TextField(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly list?: string;
  readonly onInput: (value: string) => void;
}) {
  return (
    <div class="clone-field">
      <label class="field-label" for={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        type="text"
        value={props.value}
        {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
        {...(props.list === undefined ? {} : { list: props.list })}
        onInput={(event) => props.onInput((event.currentTarget as HTMLInputElement).value)}
      />
    </div>
  );
}

function Check(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <label class="clone-check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange((event.currentTarget as HTMLInputElement).checked)}
      />
      {props.label}
    </label>
  );
}

function Radios<T extends string>(props: {
  readonly name: string;
  readonly legend: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string; readonly hint?: string }[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <fieldset class="clone-radios">
      <legend class="field-label">{props.legend}</legend>
      {props.options.map((option) => (
        <label key={option.value} class="clone-check clone-radio">
          <input
            type="radio"
            name={props.name}
            checked={props.value === option.value}
            onChange={() => props.onChange(option.value)}
          />
          <span>
            <strong>{option.label}</strong>
            {option.hint && <span class="clone-hint"> {option.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const pair = (current: readonly [string, string], index: 0 | 1, value: string): [string, string] =>
  index === 0 ? [value, current[1]] : [current[0], value];

/** How the vector opens, for the methods that need it: with enzymes, or by removing a stretch. */
function OpeningFields({ setup, onChange }: OptionProps) {
  return (
    <>
      <Radios
        name="clone-opening"
        legend={t('clone.opening.title')}
        value={setup.opening}
        options={[
          { value: 'enzymes', label: t('clone.opening.enzymes'), hint: t('clone.opening.enzymesHint') },
          { value: 'region', label: t('clone.opening.region'), hint: t('clone.opening.regionHint') },
        ]}
        onChange={(opening) => onChange({ opening })}
      />
      {setup.opening === 'enzymes' ? (
        <div class="clone-pair">
          {([0, 1] as const).map((i) => (
            <TextField
              key={i}
              id={`clone-open-${i}`}
              label={t(i === 0 ? 'clone.enzyme.first' : 'clone.enzyme.second')}
              value={setup.openEnzymes[i]}
              list="clone-enzymes"
              onInput={(value) => onChange({ openEnzymes: pair(setup.openEnzymes, i, value) })}
            />
          ))}
        </div>
      ) : (
        <div class="clone-pair">
          <TextField
            id="clone-remove-start"
            label={t('clone.opening.start')}
            value={setup.removeStart}
            onInput={(removeStart) => onChange({ removeStart })}
          />
          <TextField
            id="clone-remove-length"
            label={t('clone.opening.length')}
            value={setup.removeLength}
            onInput={(removeLength) => onChange({ removeLength })}
          />
        </div>
      )}
    </>
  );
}

function AttSelect(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div class="clone-field">
      <label class="field-label" for={props.id}>
        {props.label}
      </label>
      <select
        id={props.id}
        value={props.value}
        onChange={(e) => props.onChange((e.currentTarget as HTMLSelectElement).value)}
      >
        {ATT_VARIANTS.map((variant) => (
          <option key={variant} value={String(variant)}>
            {`attB${variant}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function MethodFields(props: OptionProps) {
  const { setup, onChange, vectorDocId } = props;
  const advanced = useAdvanced();
  switch (setup.method) {
    case 'restriction':
      return (
        <>
          <p class="clone-hint">{t('clone.restriction.auto')}</p>
          {advanced && (
            <>
              <div class="clone-pair">
                {([0, 1] as const).map((i) => (
                  <TextField
                    key={i}
                    id={`clone-enzyme-${i}`}
                    label={t(i === 0 ? 'clone.enzyme.first' : 'clone.enzyme.second')}
                    value={setup.enzymes[i]}
                    placeholder={t('clone.enzyme.auto')}
                    list="clone-enzymes"
                    onInput={(value) => onChange({ enzymes: pair(setup.enzymes, i, value) })}
                  />
                ))}
              </div>
              <Radios
                name="clone-insert-mode"
                legend={t('clone.restriction.insertMode')}
                value={setup.insertMode}
                options={[
                  {
                    value: 'amplify',
                    label: t('clone.restriction.amplify'),
                    hint: t('clone.restriction.amplifyHint'),
                  },
                  {
                    value: 'digest',
                    label: t('clone.restriction.digest'),
                    hint: t('clone.restriction.digestHint'),
                  },
                ]}
                onChange={(insertMode) => onChange({ insertMode })}
              />
              <Check
                label={t('clone.restriction.dephosphorylate')}
                checked={setup.dephosphorylate}
                onChange={(dephosphorylate) => onChange({ dephosphorylate })}
              />
              <Check
                label={t('clone.restriction.reverse')}
                checked={setup.insertReverse}
                onChange={(insertReverse) => onChange({ insertReverse })}
              />
            </>
          )}
        </>
      );
    case 'gibson':
    case 'in_fusion':
      return (
        <>
          <OpeningFields {...props} />
          {advanced && (
            <TextField
              id="clone-overlap"
              label={t('clone.overlap')}
              value={setup.overlap}
              placeholder={String(OVERLAP_DEFAULTS[setup.method])}
              onInput={(overlap) => onChange({ overlap })}
            />
          )}
        </>
      );
    case 'golden_gate':
      return (
        <>
          <div class="clone-field">
            <label class="field-label" for="clone-golden-enzyme">
              {t('clone.golden.enzyme')}
            </label>
            <select
              id="clone-golden-enzyme"
              value={setup.goldenEnzyme}
              onChange={(e) => onChange({ goldenEnzyme: (e.currentTarget as HTMLSelectElement).value })}
            >
              {GOLDEN_GATE_ENZYMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <p class="clone-hint">{t('clone.golden.hint')}</p>
          {advanced && (
            <>
              <Radios
                name="clone-golden-vector"
                legend={t('clone.golden.vectorMode')}
                value={setup.goldenVectorMode}
                options={[
                  { value: 'digest', label: t('clone.golden.digest'), hint: t('clone.golden.digestHint') },
                  { value: 'pcr', label: t('clone.golden.pcr'), hint: t('clone.golden.pcrHint') },
                ]}
                onChange={(goldenVectorMode) => onChange({ goldenVectorMode })}
              />
              <Radios
                name="clone-golden-style"
                legend={t('clone.golden.style')}
                value={setup.goldenStyle}
                options={[
                  { value: 'scar', label: t('clone.golden.scar'), hint: t('clone.golden.scarHint') },
                  { value: 'native', label: t('clone.golden.native'), hint: t('clone.golden.nativeHint') },
                ]}
                onChange={(goldenStyle) => onChange({ goldenStyle })}
              />
            </>
          )}
        </>
      );
    case 'gateway':
      return (
        <>
          <Radios
            name="clone-gateway"
            legend={t('clone.gateway.reaction')}
            value={setup.gatewayReaction}
            options={[
              { value: 'BP', label: t('clone.gateway.bp'), hint: t('clone.gateway.bpHint') },
              { value: 'LR', label: t('clone.gateway.lr'), hint: t('clone.gateway.lrHint') },
            ]}
            onChange={(gatewayReaction) => onChange({ gatewayReaction })}
          />
          <p class="clone-hint clone-requirement">{t('clone.gateway.requirement')}</p>
          {advanced && setup.gatewayReaction === 'BP' && (
            <>
              <Check
                label={t('clone.gateway.primers')}
                checked={setup.gatewayPrimers}
                onChange={(gatewayPrimers) => onChange({ gatewayPrimers })}
              />
              {setup.gatewayPrimers && (
                <div class="clone-pair">
                  <AttSelect
                    id="clone-att-left"
                    label={t('clone.gateway.attLeft')}
                    value={setup.attLeft}
                    onChange={(attLeft) => onChange({ attLeft })}
                  />
                  <AttSelect
                    id="clone-att-right"
                    label={t('clone.gateway.attRight')}
                    value={setup.attRight}
                    onChange={(attRight) => onChange({ attRight })}
                  />
                </div>
              )}
            </>
          )}
        </>
      );
    case 'topo': {
      const caret = vectorDocId === null ? null : viewOf(vectorDocId).caret.value;
      return (
        <>
          <Radios
            name="clone-topo"
            legend={t('clone.topo.kind')}
            value={setup.topoDirectional ? 'directional' : 'ta'}
            options={[
              {
                value: 'directional',
                label: t('clone.topo.directional'),
                hint: t('clone.topo.directionalHint'),
              },
              { value: 'ta', label: t('clone.topo.ta'), hint: t('clone.topo.taHint') },
            ]}
            onChange={(kind) => onChange({ topoDirectional: kind === 'directional' })}
          />
          <div class="clone-pair">
            <TextField
              id="clone-topo-site"
              label={t('clone.topo.site')}
              value={setup.topoSite}
              onInput={(topoSite) => onChange({ topoSite })}
            />
            {caret !== null && (
              <button
                type="button"
                class="secondary clone-caret"
                onClick={() => onChange({ topoSite: String(caret + 1) })}
              >
                {t('clone.topo.useCaret', { position: caret + 1 })}
              </button>
            )}
          </div>
          <p class="clone-hint">{t('clone.topo.siteHint')}</p>
          {advanced && (
            <>
              <Check
                label={t('clone.topo.amplify')}
                checked={setup.topoAmplify}
                onChange={(topoAmplify) => onChange({ topoAmplify })}
              />
              <div class="clone-field">
                <label class="field-label" for="clone-topo-polymerase">
                  {t('clone.topo.polymerase')}
                </label>
                <select
                  id="clone-topo-polymerase"
                  value={setup.topoPolymerase}
                  onChange={(e) =>
                    onChange({
                      topoPolymerase: (e.currentTarget as HTMLSelectElement)
                        .value as CloningSetup['topoPolymerase'],
                    })
                  }
                >
                  <option value="">{t('clone.topo.polymeraseAuto')}</option>
                  <option value="taq">{t('clone.topo.taq')}</option>
                  <option value="proofreading">{t('clone.topo.proofreading')}</option>
                </select>
              </div>
            </>
          )}
        </>
      );
    }
    case 'lic':
      return (
        <>
          <OpeningFields {...props} />
          {advanced && (
            <div class="clone-pair">
              {(['vectorDntp', 'insertDntp'] as const).map((field) => (
                <div key={field} class="clone-field">
                  <label class="field-label" for={`clone-${field}`}>
                    {t(field === 'vectorDntp' ? 'clone.lic.vectorDntp' : 'clone.lic.insertDntp')}
                  </label>
                  <select
                    id={`clone-${field}`}
                    value={setup[field]}
                    onChange={(e) => onChange({ [field]: (e.currentTarget as HTMLSelectElement).value })}
                  >
                    <option value="">{t('clone.lic.auto')}</option>
                    {DNTPS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </>
      );
  }
}

/** The options of the chosen method, with the engine's defaults filled in. Advanced mode adds the ones a default almost always fits. */
export function MethodOptions(props: OptionProps) {
  const advanced = useAdvanced();
  const { setup, onChange } = props;
  const cutters = useMemo(() => (props.vector ? singleCutters(props.vector) : []), [props.vector]);
  return (
    <div class="clone-options">
      <datalist id="clone-enzymes">
        {cutters.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <MethodFields {...props} />
      {advanced && (
        <fieldset class="clone-primers">
          <legend class="field-label">{t('clone.primers.options')}</legend>
          <TextField
            id="clone-tm"
            label={t('clone.primers.tm')}
            value={setup.targetTm}
            placeholder="60"
            onInput={(targetTm) => onChange({ targetTm })}
          />
          <TextField
            id="clone-anneal-min"
            label={t('clone.primers.annealMin')}
            value={setup.annealMin}
            placeholder="18"
            onInput={(annealMin) => onChange({ annealMin })}
          />
          <TextField
            id="clone-anneal-max"
            label={t('clone.primers.annealMax')}
            value={setup.annealMax}
            placeholder="35"
            onInput={(annealMax) => onChange({ annealMax })}
          />
        </fieldset>
      )}
    </div>
  );
}
