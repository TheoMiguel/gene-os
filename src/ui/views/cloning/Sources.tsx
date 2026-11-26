import type { Topology } from '../../../engine/types';
import { t } from '../../i18n';
import { requestErrorText } from './messages';
import { type CloningSource, type PartRole, resolvePart, type SourceChoice } from './model';

const encode = (choice: SourceChoice): string =>
  choice.kind === 'paste' ? 'paste' : `${choice.kind === 'selection' ? 'sel' : 'doc'}:${choice.docId}`;

function decode(value: string, previous: SourceChoice): SourceChoice {
  if (value === 'paste') {
    return previous.kind === 'paste' ? previous : { kind: 'paste', text: '', topology: 'linear' };
  }
  const [kind, docId = ''] = value.split(/:(.*)/s);
  return { kind: kind === 'sel' ? 'selection' : 'doc', docId };
}

interface SourcePickerProps {
  readonly kind: PartRole;
  readonly index: number;
  readonly heading: string;
  readonly choice: SourceChoice;
  readonly sources: readonly CloningSource[];
  readonly onChange: (choice: SourceChoice) => void;
  readonly onRemove?: (() => void) | undefined;
}

/**
 * Chooses where an insert or the vector comes from: the region selected in the Sequence view of any open
 * document (the easy path), a whole open document, or pasted text. Says at once what the choice resolves to.
 */
export function SourcePicker(props: SourcePickerProps) {
  const { kind: role, index, choice, sources } = props;
  const id = `clone-source-${role}-${index}`;
  const resolved = resolvePart(choice, sources, role, index);
  const detail =
    'part' in resolved
      ? t('clone.source.resolved', {
          name: resolved.part.id,
          length: (resolved.part.region?.length ?? resolved.part.record.seq.length).toLocaleString(),
        })
      : null;

  return (
    <div class="clone-source">
      <label class="field-label" for={id}>
        {props.heading}
      </label>
      <div class="clone-source-row">
        <select
          id={id}
          value={encode(choice)}
          onChange={(event) =>
            props.onChange(decode((event.currentTarget as HTMLSelectElement).value, choice))
          }
        >
          {sources
            .filter((s) => s.selection !== null)
            .map((s) => (
              <option key={`sel:${s.doc.id}`} value={`sel:${s.doc.id}`}>
                {t('clone.source.selection', {
                  name: s.doc.record.name,
                  from: (s.selection?.start ?? 0) + 1,
                  to: s.selection?.end ?? 0,
                })}
              </option>
            ))}
          {sources.map((s) => (
            <option key={`doc:${s.doc.id}`} value={`doc:${s.doc.id}`}>
              {t('clone.source.whole', {
                name: s.doc.record.name,
                length: s.doc.record.seq.length.toLocaleString(),
                topology: t(`topology.${s.doc.record.topology}`),
              })}
            </option>
          ))}
          {choice.kind === 'selection' && !sources.some((s) => s.doc.id === choice.docId && s.selection) && (
            <option value={encode(choice)}>{t('clone.source.noSelection')}</option>
          )}
          <option value="paste">{t('clone.source.paste')}</option>
        </select>
        {props.onRemove && (
          <button type="button" class="secondary" onClick={props.onRemove}>
            {t('clone.insert.remove')}
          </button>
        )}
      </div>
      {choice.kind === 'paste' && (
        <div class="clone-paste">
          <textarea
            class="paste-input"
            aria-label={props.heading}
            spellcheck={false}
            placeholder={t('clone.source.pastePlaceholder')}
            value={choice.text}
            onInput={(event) =>
              props.onChange({ ...choice, text: (event.currentTarget as HTMLTextAreaElement).value })
            }
          />
          {role === 'insert' && (
            <label class="clone-inline">
              <span class="field-label">{t('clone.source.topology')}</span>
              <select
                value={choice.topology}
                onChange={(event) =>
                  props.onChange({
                    ...choice,
                    topology: (event.currentTarget as HTMLSelectElement).value as Topology,
                  })
                }
              >
                <option value="linear">{t('topology.linear')}</option>
                <option value="circular">{t('topology.circular')}</option>
              </select>
            </label>
          )}
        </div>
      )}
      {detail ? (
        <p class="clone-hint">{detail}</p>
      ) : (
        'error' in resolved && (
          <p class="clone-warning">{requestErrorText({ kind: 'part', error: resolved.error })}</p>
        )
      )}
    </div>
  );
}
