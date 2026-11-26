import { useMemo, useState } from 'preact/hooks';
import type {
  CloningDesign,
  CloningProblem,
  CloningWarning,
  JunctionInfo,
  PlannedPrimer,
  PreparedFragment,
} from '../../../engine/cloning';
import { workspace } from '../../../state/documents';
import { notice } from '../../actions';
import { copyText, downloadSequence, downloadText, reportCopy, reportSave } from '../../export';
import { t } from '../../i18n';
import { Table, type TableColumn } from '../../table';
import { ConstructMap } from './ConstructMap';
import { problemText, requestErrorText, warningText } from './messages';
import { orderList } from './model';
import type { CloningRun } from './store';

const TABLE_CHROME = 32 + 54;
const ROW = 28;
const tableHeight = (rows: number) => `${Math.min(Math.max(rows, 1), 8) * ROW + TABLE_CHROME + 8}px`;

/** Problems first, then warnings, each as a sentence with a visible label. */
function Messages(props: {
  readonly problems: readonly CloningProblem[];
  readonly warnings: readonly CloningWarning[];
}) {
  if (props.problems.length === 0 && props.warnings.length === 0) return null;
  return (
    <ul class="clone-messages">
      {props.problems.map((problem) => (
        <li key={problemText(problem)} class="clone-problem" role="alert">
          <span class="clone-tag">{t('clone.tag.problem')}</span>
          {problemText(problem)}
        </li>
      ))}
      {props.warnings.map((warning) => (
        <li key={warningText(warning)} class="clone-warn">
          <span class="clone-tag">{t('clone.tag.warning')}</span>
          {warningText(warning)}
        </li>
      ))}
    </ul>
  );
}

const primerColumns = (): TableColumn<PlannedPrimer>[] => [
  { id: 'name', header: t('clone.primer.name'), width: 150, value: (p) => p.name },
  { id: 'seq', header: t('clone.primer.seq'), width: 560, value: (p) => p.seq },
  { id: 'length', header: t('clone.primer.length'), type: 'number', width: 80, value: (p) => p.seq.length },
  { id: 'anneal', header: t('clone.primer.anneal'), type: 'number', width: 90, value: (p) => p.annealLength },
  { id: 'tail', header: t('clone.primer.tail'), type: 'number', width: 80, value: (p) => p.tailLength },
  {
    id: 'tm',
    header: t('clone.primer.tm'),
    type: 'number',
    width: 90,
    value: (p) => +p.tm.toFixed(1),
    format: (v) => (typeof v === 'number' ? v.toFixed(1) : ''),
  },
  { id: 'template', header: t('clone.primer.template'), width: 170, value: (p) => p.templateId },
];

const fragmentColumns = (): TableColumn<PreparedFragment>[] => [
  { id: 'name', header: t('clone.fragment.name'), width: 190, value: (f) => f.name },
  {
    id: 'kind',
    header: t('clone.fragment.kind'),
    width: 190,
    value: (f) => f.kind,
    format: (_, f) => t(`clone.fragment.kind.${f.kind}`),
  },
  {
    id: 'length',
    header: t('clone.fragment.length'),
    type: 'number',
    width: 100,
    value: (f) => f.product.length,
  },
  { id: 'template', header: t('clone.fragment.template'), width: 170, value: (f) => f.templateId },
  { id: 'primers', header: t('clone.fragment.primers'), width: 190, value: (f) => f.primerIds.join(' + ') },
  { id: 'dntp', header: t('clone.fragment.dntp'), width: 80, value: (f) => f.dntp ?? '' },
];

const junctionColumns = (): TableColumn<JunctionInfo>[] => [
  { id: 'label', header: t('clone.junction.name'), width: 220, value: (j) => j.label },
  {
    id: 'kind',
    header: t('clone.junction.kind'),
    width: 160,
    value: (j) => j.kind,
    format: (_, j) => t(`clone.junction.kind.${j.kind}`),
  },
  {
    id: 'position',
    header: t('clone.junction.position'),
    type: 'number',
    width: 100,
    value: (j) => j.position + 1,
  },
  { id: 'length', header: t('clone.junction.length'), type: 'number', width: 90, value: (j) => j.length },
];

function PrimerSection({ primers }: { readonly primers: readonly PlannedPrimer[] }) {
  const columns = useMemo(primerColumns, []);
  return (
    <section class="clone-section" aria-labelledby="clone-primers-title">
      <h3 id="clone-primers-title" class="field-label">
        {t('clone.primers.title', { count: primers.length })}
      </h3>
      {primers.length === 0 ? (
        <p class="clone-hint">{t('clone.primers.none')}</p>
      ) : (
        <>
          <p class="clone-hint">{t('clone.primers.hint')}</p>
          <div class="clone-table" style={{ height: tableHeight(primers.length) }}>
            <Table
              label={t('clone.primers.label')}
              columns={columns}
              rows={primers}
              exportName="cloning-primers"
            />
          </div>
          <div class="clone-actions">
            <button
              type="button"
              class="export-button"
              onClick={async () => reportCopy(await copyText(orderList(primers)))}
            >
              {t('clone.primers.copyOrder')}
            </button>
            <button
              type="button"
              class="export-button"
              onClick={async () =>
                reportSave(
                  await downloadText(orderList(primers), 'primer-order.tsv', 'text/tab-separated-values'),
                )
              }
            >
              {t('clone.primers.saveOrder')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ConstructSection({ design }: { readonly design: CloningDesign }) {
  const [chosen, setChosen] = useState(0);
  const construct = design.constructs[chosen] ?? design.constructs[0];
  const columns = useMemo(junctionColumns, []);
  if (!construct) return null;
  const { record } = construct;
  const orientation = (value: string) =>
    value === 'forward' || value === 'reverse' ? t(`clone.orientation.${value}`) : value;

  const open = () => {
    workspace.open(record);
    notice.value = { key: 'clone.opened', tone: 'info' };
  };

  return (
    <section class="clone-section" aria-labelledby="clone-construct-title">
      <h3 id="clone-construct-title" class="field-label">
        {t('clone.construct.title')}
      </h3>
      {design.constructs.length > 1 && (
        <fieldset class="clone-orientations">
          <legend class="clone-hint">
            {t('clone.construct.several', { count: design.constructs.length })}
          </legend>
          {design.constructs.map((c, i) => (
            <label key={c.orientation} class={`clone-orientation${i === chosen ? ' selected' : ''}`}>
              <input
                type="radio"
                name="clone-orientation"
                class="visually-hidden"
                checked={i === chosen}
                onChange={() => setChosen(i)}
              />
              {i === 0
                ? t('clone.construct.intended', { orientation: orientation(c.orientation) })
                : orientation(c.orientation)}
            </label>
          ))}
        </fieldset>
      )}
      <p class="clone-hint">
        {t('clone.construct.summary', {
          name: record.name,
          length: record.seq.length.toLocaleString(),
          orientation: orientation(construct.orientation),
        })}
      </p>
      <ConstructMap construct={construct} name={record.name} />
      <div class="clone-actions">
        <button type="button" class="primary-btn" onClick={open}>
          {t('clone.construct.open')}
        </button>
        <button
          type="button"
          class="export-button"
          onClick={async () => reportSave(await downloadSequence(record, 'genbank'))}
        >
          {t('clone.construct.saveGenbank')}
        </button>
        <button
          type="button"
          class="export-button"
          onClick={async () => reportSave(await downloadSequence(record, 'fasta'))}
        >
          {t('clone.construct.saveFasta')}
        </button>
      </div>
      <h4 class="field-label">{t('clone.junction.title', { count: construct.junctions.length })}</h4>
      <div class="clone-table" style={{ height: tableHeight(construct.junctions.length) }}>
        <Table
          label={t('clone.junction.title', { count: construct.junctions.length })}
          columns={columns}
          rows={construct.junctions}
          exportName="cloning-junctions"
        />
      </div>
    </section>
  );
}

function FragmentSection({ fragments }: { readonly fragments: readonly PreparedFragment[] }) {
  const columns = useMemo(fragmentColumns, []);
  return (
    <section class="clone-section" aria-labelledby="clone-fragments-title">
      <h3 id="clone-fragments-title" class="field-label">
        {t('clone.fragments.title', { count: fragments.length })}
      </h3>
      <p class="clone-hint">{t('clone.fragments.hint')}</p>
      <div class="clone-table" style={{ height: tableHeight(fragments.length) }}>
        <Table
          label={t('clone.fragments.title', { count: fragments.length })}
          columns={columns}
          rows={fragments}
          exportName="cloning-fragments"
        />
      </div>
    </section>
  );
}

/** What the Design button produced: problems and warnings in plain sentences, then primers, fragments and the construct. */
export function CloningResultView({ run }: { readonly run: Exclude<CloningRun, { kind: 'running' }> }) {
  if (run.kind === 'invalid') {
    return (
      <p class="clone-problem clone-standalone" role="alert">
        <span class="clone-tag">{t('clone.tag.problem')}</span>
        {requestErrorText(run.error)}
      </p>
    );
  }
  if (run.kind === 'failed') {
    return (
      <p class="clone-problem clone-standalone" role="alert">
        <span class="clone-tag">{t('clone.tag.problem')}</span>
        {t('clone.failed', { message: run.message })}
      </p>
    );
  }
  const { result } = run;
  if (!result.ok) {
    return (
      <div class="clone-result">
        <h3 class="stage-title">{t('clone.result.stopped')}</h3>
        <Messages problems={result.problems} warnings={result.warnings} />
      </div>
    );
  }
  const { design } = result;
  return (
    <div class="clone-result">
      <h3 class="stage-title">{t('clone.result.title', { method: t(`clone.method.${design.method}`) })}</h3>
      <Messages problems={[]} warnings={design.warnings} />
      <PrimerSection primers={design.primers} />
      <FragmentSection fragments={design.fragments} />
      <ConstructSection design={design} />
    </div>
  );
}
