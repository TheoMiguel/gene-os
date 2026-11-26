import { useMemo } from 'preact/hooks';
import type { SeqDocument } from '../../state/documents';
import { workspace } from '../../state/documents';
import { t } from '../i18n';
import { type CloningSetup, METHODS, resolvePart, type SourceChoice, vectorDocId } from './cloning/model';
import { MethodChooser, MethodOptions } from './cloning/Options';
import { CloningResultView } from './cloning/Result';
import { SourcePicker } from './cloning/Sources';
import { cancelDesign, cloningPanelOf, runDesign, sourcesOf } from './cloning/store';
import './cloning/cloning.css';

const PASTE: SourceChoice = { kind: 'paste', text: '', topology: 'linear' };

/** The cloning view: choose a method, the insert and the vector, let the app design the primers, read the simulated construct. */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  const sources = sourcesOf(workspace.documents.value);
  const { setup, run } = cloningPanelOf(doc, sources);
  const current = setup.value;
  const method = METHODS.find((m) => m.id === current.method);
  const manyInserts = method?.manyInserts ?? false;

  const onChange = (patch: Partial<CloningSetup>) => {
    setup.value = { ...setup.value, ...patch };
  };
  const setInsert = (index: number, choice: SourceChoice) =>
    onChange({ inserts: current.inserts.map((c, i) => (i === index ? choice : c)) });

  const vector = resolvePart(current.vector, sources, 'vector');
  const vectorRecord = 'part' in vector ? vector.part.record : null;
  const shownInserts = manyInserts ? current.inserts : current.inserts.slice(0, 1);
  const result = run.value;
  const resultView = useMemo(
    () => (result && result.kind !== 'running' ? <CloningResultView run={result} /> : null),
    [result],
  );
  const running = result?.kind === 'running';

  return (
    <div class="clone-view">
      <div class="clone-card bracket-box">
        <div class="bracket-inner" />
        <div class="stage-label">01</div>
        <h2 class="stage-title">{t('clone.method.title')}</h2>
        <MethodChooser setup={current} onChange={onChange} />
      </div>

      <div class="clone-grid">
        <div class="clone-card bracket-box">
          <div class="bracket-inner" />
          <div class="stage-label">02</div>
          <h2 class="stage-title">{t(manyInserts ? 'clone.insert.titleMany' : 'clone.insert.title')}</h2>
          <p class="clone-hint">{t('clone.insert.hint')}</p>
          {shownInserts.map((choice, i) => (
            <SourcePicker
              key={i}
              kind="insert"
              index={i + 1}
              heading={manyInserts ? t('clone.insert.numbered', { index: i + 1 }) : t('clone.insert.one')}
              choice={choice}
              sources={sources}
              onChange={(next) => setInsert(i, next)}
              onRemove={
                manyInserts && current.inserts.length > 1
                  ? () => onChange({ inserts: current.inserts.filter((_, k) => k !== i) })
                  : undefined
              }
            />
          ))}
          {manyInserts && (
            <button
              type="button"
              class="secondary clone-add"
              onClick={() => onChange({ inserts: [...current.inserts, PASTE] })}
            >
              {t('clone.insert.add')}
            </button>
          )}
        </div>

        <div class="clone-card bracket-box">
          <div class="bracket-inner" />
          <div class="stage-label">03</div>
          <h2 class="stage-title">{t('clone.vector.title')}</h2>
          <p class="clone-hint">{t('clone.vector.hint')}</p>
          <SourcePicker
            kind="vector"
            index={1}
            heading={t('clone.vector.one')}
            choice={current.vector}
            sources={sources}
            onChange={(next) => onChange({ vector: next })}
          />
        </div>
      </div>

      <div class="clone-card bracket-box">
        <div class="bracket-inner" />
        <div class="stage-label">04</div>
        <h2 class="stage-title">
          {t('clone.options.title', { method: t(`clone.method.${current.method}`) })}
        </h2>
        <MethodOptions
          setup={current}
          onChange={onChange}
          vector={vectorRecord}
          vectorDocId={vectorDocId(current)}
        />
      </div>

      <div class="clone-actions clone-run">
        <button
          type="button"
          class="primary-btn"
          disabled={running}
          onClick={() => runDesign(doc.id, sources)}
        >
          {t('clone.design')}
        </button>
        {running ? (
          <>
            <span class="clone-hint" role="status">
              {t('clone.running')}
            </span>
            <button type="button" class="secondary" onClick={() => cancelDesign(doc.id)}>
              {t('clone.cancel')}
            </button>
          </>
        ) : (
          <span class="clone-hint">{t('clone.design.hint')}</span>
        )}
      </div>

      {resultView ?? <p class="clone-hint">{t('clone.empty')}</p>}
    </div>
  );
}
