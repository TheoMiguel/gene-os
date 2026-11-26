import { useMemo } from 'preact/hooks';
import { digest } from '../../engine/restriction';
import { useAnalysis } from '../../state/analysis';
import type { SeqDocument } from '../../state/documents';
import { viewOf } from '../../state/view';
import { t } from '../i18n';
import { EnzymePicker } from './digest/EnzymePicker';
import { FragmentSection } from './digest/FragmentSection';
import { chosenSites, fragmentRows, NO_FILTER } from './digest/model';
import { digestGelOf, digestStateOf } from './digest/state';
import type { GelLaneInput } from './gel/Gel';
import { GelPanel } from './gel/GelPanel';
import './digest/digest.css';

const SINGLE_LANE_LIMIT = 3;

/**
 * The Digest & Gel view: pick enzymes with their cut counts on the loaded sequence, digest it, read the fragment
 * table and see the fragments on a virtual agarose gel with a warning for fragments that run together.
 */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  const { record } = doc;
  const state = digestStateOf(doc.id);
  const scanState = useAnalysis(doc, 'restriction', {});
  const scan = scanState.status === 'ready' ? scanState.value : null;
  const chosen = state.chosen.value;
  const choices = { endType: state.endType.value, cuts: state.cuts.value, supplier: state.supplier.value };
  const selected = state.selected.value;

  const sites = useMemo(() => (scan ? chosenSites(scan, chosen) : []), [scan, chosen]);
  const rows = useMemo(
    () => (sites.length > 0 ? fragmentRows(record.seq, digest(record.seq, record.topology, sites)) : []),
    [record, sites],
  );
  const lanes = useMemo<GelLaneInput[]>(() => {
    if (rows.length === 0) return [];
    const together: GelLaneInput = {
      id: 'all',
      label: chosen.join('+'),
      sizes: rows.map((row) => row.length),
    };
    if (!state.singleLanes.value || sites.length < 2 || sites.length > SINGLE_LANE_LIMIT) return [together];
    const alone = sites.map<GelLaneInput>((one) => ({
      id: one.enzyme.name,
      label: one.enzyme.name,
      sizes: digest(record.seq, record.topology, [one]).map((fragment) => fragment.length),
    }));
    return [...alone, together];
  }, [rows, sites, chosen, record, state.singleLanes.value]);

  const select = (index: number | null) => {
    state.selected.value = index;
    const row = index === null ? undefined : rows[index];
    if (!row) return;
    const view = viewOf(doc.id);
    view.select(row.firstSegment.start, row.firstSegment.end);
    view.reveal(row.firstSegment.start);
  };
  const toggle = (name: string) => {
    state.chosen.value = chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name];
    state.selected.value = null;
  };
  const selectedRow = selected === null ? undefined : rows[selected];

  return (
    <div class="digest-view">
      <section class="bracket-box digest-card digest-enzymes">
        <div class="bracket-inner" />
        <div class="stage-label">01</div>
        <h2 class="stage-title">{t('digest.enzymes')}</h2>
        {scanState.status === 'failed' && (
          <p class="digest-error" role="alert">
            {t('digest.scanFailed', { reason: scanState.reason })}
          </p>
        )}
        {scanState.status === 'pending' && <p class="digest-hint">{t('digest.scanning')}</p>}
        {scan && (
          <EnzymePicker
            scan={scan}
            choices={{ ...NO_FILTER, ...choices }}
            onChoices={(next) => {
              state.endType.value = next.endType;
              state.cuts.value = next.cuts;
              state.supplier.value = next.supplier;
            }}
            chosen={chosen}
            onToggle={toggle}
            onClear={() => {
              state.chosen.value = [];
              state.selected.value = null;
            }}
          />
        )}
      </section>

      <div class="digest-gel">
        {rows.length > 0 ? (
          <>
            <GelPanel
              title={t('digest.gelTitle')}
              settings={digestGelOf(doc.id)}
              lanes={lanes}
              selected={selectedRow ? { lane: 'all', size: selectedRow.length } : null}
              onSelect={(lane, sizes) => {
                if (lane !== 'all') return;
                const index = rows.findIndex((row) => sizes.includes(row.length));
                if (index >= 0) select(index);
              }}
              exportName={`${record.name}-${chosen.join('-')}-gel`}
            />
            {sites.length >= 2 && sites.length <= SINGLE_LANE_LIMIT && (
              <label class="digest-toggle">
                <input
                  type="checkbox"
                  checked={state.singleLanes.value}
                  onChange={(event) =>
                    (state.singleLanes.value = (event.currentTarget as HTMLInputElement).checked)
                  }
                />
                {t('digest.singleLanes')}
              </label>
            )}
          </>
        ) : (
          <section class="bracket-box digest-card">
            <div class="bracket-inner" />
            <div class="stage-label">02</div>
            <h2 class="stage-title">{t('digest.gelTitle')}</h2>
            <p class="digest-hint">{t('digest.emptyGel')}</p>
          </section>
        )}
      </div>

      <section class="bracket-box digest-card digest-fragments-card">
        <div class="bracket-inner" />
        <div class="stage-label">03</div>
        <h2 class="stage-title">{t('digest.fragments')}</h2>
        {rows.length > 0 ? (
          <FragmentSection
            record={record}
            rows={rows}
            enzymes={chosen.join('-')}
            selected={selected}
            onSelect={select}
          />
        ) : (
          <p class="digest-hint">
            {t('digest.emptyFragments', { topology: t(`topology.${record.topology}`) })}
          </p>
        )}
      </section>
    </div>
  );
}
