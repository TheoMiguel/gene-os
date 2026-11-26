import { useMemo } from 'preact/hooks';
import { useAnalysis } from '../../state/analysis';
import type { SeqDocument } from '../../state/documents';
import { t } from '../i18n';
import { selectMapSites } from './sequence/mapModel';
import { PlasmidMap } from './sequence/PlasmidMap';
import { RestrictionPane } from './sequence/RestrictionPane';
import { Segmented } from './sequence/Segmented';
import { SequencePane } from './sequence/SequencePane';
import { Splitter } from './sequence/Splitter';
import { type PaneFocus, prefsOf } from './sequence/state';
import { useElementSize } from './sequence/useElementSize';
import './sequence/sequence.css';

/** Below this width the three panes cannot sit side by side, so one pane at a time fills the area. */
export const COMPACT_WIDTH = 900;

/** From this height the list shows its filters open; below it they start folded so the table keeps its rows. */
export const ROOMY_HEIGHT = 700;

const FOCUS_KEYS = {
  all: 'sv.focus.all',
  map: 'sv.focus.map',
  sequence: 'sv.focus.sequence',
  sites: 'sv.focus.sites',
} as const;

/**
 * The sequence view: plasmid map, sequence text and restriction list in one tab, sharing one selection. Wide windows
 * show the map beside the text and the list. A narrow window shows one pane at a time, chosen from a switch above, so
 * nothing overflows and the page never scrolls.
 */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  const prefs = prefsOf(doc.id);
  const root = useElementSize();
  const compact = root.width < COMPACT_WIDTH;
  const focus: PaneFocus = compact && prefs.focus.value === 'all' ? 'map' : prefs.focus.value;

  const analysis = useAnalysis(doc, 'restriction', {});
  const scan = analysis.status === 'ready' ? analysis.value : null;
  const display = prefs.siteDisplay.value;
  const picked = prefs.picked.value;
  const chosen = useMemo(
    () => (scan ? selectMapSites(scan, display, picked) : { sites: [], hidden: 0 }),
    [scan, display, picked],
  );
  const shown = useMemo(() => new Set(chosen.sites.map((site) => site.enzyme)), [chosen]);
  const recognition = useMemo(
    () => new Map((scan?.sites ?? []).map(({ enzyme }) => [enzyme.name, enzyme.site])),
    [scan],
  );

  const split = prefs.split.value;
  const map = <PlasmidMap doc={doc} sites={chosen} recognition={recognition} />;
  const text = <SequencePane doc={doc} scan={scan} shown={shown} />;
  const sites = <RestrictionPane doc={doc} analysis={analysis} roomy={root.height >= ROOMY_HEIGHT} />;

  const options = (['all', 'map', 'sequence', 'sites'] as const)
    .filter((value) => !compact || value !== 'all')
    .map((value) => ({ value, label: t(FOCUS_KEYS[value]) }));

  return (
    <div class={`seq-view${compact ? ' compact' : ''} focus-${focus}`} ref={root.ref}>
      <div class="seq-switch">
        <Segmented
          legend={t('sv.focus.legend')}
          name={`focus-${doc.id}`}
          value={focus}
          options={options}
          onChange={(value) => {
            prefs.focus.value = value;
          }}
        />
      </div>
      {focus === 'all' ? (
        <div class="seq-grid split" style={{ gridTemplateColumns: `${split.col}fr 8px ${1 - split.col}fr` }}>
          {map}
          <Splitter
            orientation="vertical"
            ratio={split.col}
            label={t('sv.split.columns')}
            onChange={(col) => {
              prefs.split.value = { ...split, col };
            }}
          />
          <div class="right-col" style={{ gridTemplateRows: `${split.row}fr 8px ${1 - split.row}fr` }}>
            {text}
            <Splitter
              orientation="horizontal"
              ratio={split.row}
              label={t('sv.split.rows')}
              onChange={(row) => {
                prefs.split.value = { ...split, row };
              }}
            />
            {sites}
          </div>
        </div>
      ) : (
        <div class="seq-grid">{focus === 'map' ? map : focus === 'sequence' ? text : sites}</div>
      )}
    </div>
  );
}
