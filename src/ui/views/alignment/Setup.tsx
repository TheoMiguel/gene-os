import type { MatrixName } from '../../../engine/align';
import { MATRIX_NAMES } from '../../../engine/align';
import { useAdvanced } from '../../../state/settings';
import { t } from '../../i18n';
import { ALIGN_MODES, type AlignSetup, type AlignSource, DEFAULT_SCORES, type ScoreField } from './model';

interface SetupProps {
  readonly sources: readonly AlignSource[];
  readonly setup: AlignSetup;
  readonly onChange: (patch: Partial<AlignSetup>) => void;
  readonly count: number;
  readonly alphabet: 'dna' | 'protein' | 'mixed';
  readonly invalid: readonly ScoreField[];
}

const toggle = (list: readonly string[], id: string, on: boolean) =>
  on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id);

function ScoreInput(props: {
  readonly field: ScoreField;
  readonly label: string;
  readonly placeholder: number;
  readonly setup: AlignSetup;
  readonly invalid: readonly ScoreField[];
  readonly onChange: SetupProps['onChange'];
}) {
  const id = `aln-score-${props.field}`;
  return (
    <div class="aln-field">
      <label class="field-label" for={id}>
        {props.label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={props.setup[props.field]}
        placeholder={String(props.placeholder)}
        aria-invalid={props.invalid.includes(props.field)}
        onInput={(event) =>
          props.onChange({ [props.field]: (event.currentTarget as HTMLInputElement).value })
        }
      />
    </div>
  );
}

/** What to align and how: the open documents, a pasted sequence, the method and, in advanced mode, the scores. */
export function AlignSetupForm(props: SetupProps) {
  const { sources, setup, onChange, count, alphabet, invalid } = props;
  const advanced = useAdvanced();
  const scoreProps = { setup, invalid, onChange };

  return (
    <div class="aln-setup">
      <div class="aln-card bracket-box">
        <div class="bracket-inner" />
        <div class="stage-label">01</div>
        <h2 class="stage-title">{t('align.what.title')}</h2>
        <fieldset class="aln-docs">
          <legend class="field-label">{t('align.what.open')}</legend>
          {sources.map((source) => {
            const on = setup.picked.includes(source.id);
            const selection = source.selection;
            return (
              <div key={source.id} class="aln-doc">
                <label class="aln-check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) =>
                      onChange({
                        picked: toggle(
                          setup.picked,
                          source.id,
                          (event.currentTarget as HTMLInputElement).checked,
                        ),
                      })
                    }
                  />
                  <span class="aln-doc-name">{source.name}</span>
                  <span class="aln-hint">
                    {t(source.protein ? 'align.what.residues' : 'doc.length', {
                      length: source.seq.length.toLocaleString(),
                    })}
                  </span>
                </label>
                {on && selection && (
                  <label class="aln-check aln-sub">
                    <input
                      type="checkbox"
                      checked={setup.regionOnly.includes(source.id)}
                      onChange={(event) =>
                        onChange({
                          regionOnly: toggle(
                            setup.regionOnly,
                            source.id,
                            (event.currentTarget as HTMLInputElement).checked,
                          ),
                        })
                      }
                    />
                    {t('align.what.region', { from: selection.start + 1, to: selection.end })}
                  </label>
                )}
              </div>
            );
          })}
        </fieldset>
        <div class="aln-field">
          <label class="field-label" for="aln-paste">
            {t('align.what.paste')}
          </label>
          <textarea
            id="aln-paste"
            class="paste-input aln-paste"
            spellcheck={false}
            placeholder={t('align.what.pastePlaceholder')}
            value={setup.pasted}
            onInput={(event) => onChange({ pasted: (event.currentTarget as HTMLTextAreaElement).value })}
          />
          <p class="aln-hint">{t('align.what.pasteHint')}</p>
        </div>
        <p class="aln-count" role="status">
          {count < 2
            ? t('align.what.needTwo')
            : count === 2
              ? t('align.what.pair')
              : t('align.what.group', { count })}
        </p>
        {alphabet === 'mixed' && (
          <p class="aln-warning" role="alert">
            {t('align.what.mixed')}
          </p>
        )}
      </div>

      <div class="aln-card bracket-box">
        <div class="bracket-inner" />
        <div class="stage-label">02</div>
        <h2 class="stage-title">{t('align.method.title')}</h2>
        {count >= 3 ? (
          <div class="aln-choice selected">
            <strong>{t('align.method.msa')}</strong>
            <p>{t('align.method.msaHint')}</p>
          </div>
        ) : (
          <fieldset class="aln-modes">
            <legend class="visually-hidden">{t('align.method.title')}</legend>
            {ALIGN_MODES.map((mode) => (
              <label key={mode} class={`aln-choice${setup.mode === mode ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="aln-mode"
                  class="visually-hidden"
                  checked={setup.mode === mode}
                  onChange={() => onChange({ mode })}
                />
                <strong>{t(`align.method.${mode}`)}</strong>
                <p>{t(`align.method.${mode}Hint`)}</p>
              </label>
            ))}
          </fieldset>
        )}
        {advanced && alphabet !== 'mixed' && (
          <fieldset class="aln-scores">
            <legend class="field-label">{t('align.scores.title')}</legend>
            {alphabet === 'dna' ? (
              <>
                <ScoreInput
                  field="match"
                  label={t('align.scores.match')}
                  placeholder={DEFAULT_SCORES.dna.match}
                  {...scoreProps}
                />
                <ScoreInput
                  field="mismatch"
                  label={t('align.scores.mismatch')}
                  placeholder={DEFAULT_SCORES.dna.mismatch}
                  {...scoreProps}
                />
              </>
            ) : (
              <div class="aln-field">
                <label class="field-label" for="aln-matrix">
                  {t('align.scores.matrix')}
                </label>
                <select
                  id="aln-matrix"
                  value={setup.matrix}
                  onChange={(event) =>
                    onChange({ matrix: (event.currentTarget as HTMLSelectElement).value as MatrixName })
                  }
                >
                  {MATRIX_NAMES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ScoreInput
              field="gapOpen"
              label={t('align.scores.gapOpen')}
              placeholder={DEFAULT_SCORES[alphabet].gapOpen}
              {...scoreProps}
            />
            <ScoreInput
              field="gapExtend"
              label={t('align.scores.gapExtend')}
              placeholder={DEFAULT_SCORES[alphabet].gapExtend}
              {...scoreProps}
            />
            {count >= 3 && (
              <div class="aln-field">
                <label class="field-label" for="aln-distance">
                  {t('align.scores.distance')}
                </label>
                <select
                  id="aln-distance"
                  value={setup.distance}
                  onChange={(event) =>
                    onChange({
                      distance: (event.currentTarget as HTMLSelectElement).value as AlignSetup['distance'],
                    })
                  }
                >
                  {(['auto', 'alignment', 'kmer'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`align.scores.distance.${value}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p class="aln-hint">{t('align.scores.hint')}</p>
          </fieldset>
        )}
      </div>
    </div>
  );
}
