import { type Signal, signal } from '@preact/signals';
import { useId, useMemo, useRef } from 'preact/hooks';
import { LADDERS } from '../../../engine/gel';
import { ImageExportButtons } from '../../export';
import { t } from '../../i18n';
import { perDocument } from './documentState';
import { GelFigure, type GelLaneInput, type GelSelection } from './Gel';
import {
  AGAROSE_MAX,
  AGAROSE_MIN,
  AGAROSE_STEP,
  autoLadder,
  type CloseGroup,
  closeGroups,
  defaultAgarose,
  suggestAgarose,
} from './gelModel';
import './gel.css';

/** What the user chose for one gel; `null` means "use the suggestion". */
export interface GelSettings {
  readonly ladder: Signal<string | null>;
  readonly agarose: Signal<number | null>;
}

/** Creates the per-document store of one view's gel settings. Each view that draws a gel makes its own. */
export function createGelSettingsStore(): (docId: string) => GelSettings {
  return perDocument<GelSettings>(() => ({ ladder: signal(null), agarose: signal(null) }));
}

export interface GelPanelProps {
  readonly settings: GelSettings;
  readonly lanes: readonly GelLaneInput[];
  readonly selected: GelSelection | null;
  readonly onSelect?: (lane: string, sizes: readonly number[]) => void;
  /** File name of the SVG and PNG export, without extension. */
  readonly exportName: string;
  readonly title: string;
}

const sizeList = (sizes: readonly number[]) =>
  sizes.map((bp) => Math.round(bp).toLocaleString('en-US')).join(', ');

/** One warning for a group of fragments that cannot be told apart on this gel. */
function Warning(props: {
  readonly lane: string;
  readonly group: CloseGroup;
  readonly suggestion: number | null;
  readonly onUse: (percent: number) => void;
}) {
  const { lane, group, suggestion, onUse } = props;
  const params = { lane, sizes: sizeList(group.sizes) };
  let message = t(group.merged ? 'gel.warnMerged' : 'gel.warnClose', params);
  if (group.identical) message = t('gel.warnIdentical', params);
  return (
    <div class="gel-warning" role="alert">
      <strong>{t('gel.warnLabel')}</strong>
      <span>{message}</span>
      {!group.identical &&
        (suggestion === null ? (
          <span>{t('gel.warnNoFix')}</span>
        ) : (
          <button type="button" class="secondary" onClick={() => onUse(suggestion)}>
            {t('gel.useAgarose', { percent: suggestion.toFixed(1) })}
          </button>
        ))}
    </div>
  );
}

/**
 * The gel with its controls: the ladder (the engine's suggestion preselected, named on the picture), the agarose
 * percentage (a default that suits the fragment range), SVG and PNG export, and a warning for every lane whose
 * fragments are too close in size to separate at the chosen percentage.
 */
export function GelPanel({ settings, lanes, selected, onSelect, exportName, title }: GelPanelProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const ladderId = useId();
  const rangeId = useId();
  const allSizes = useMemo(() => lanes.flatMap((lane) => lane.sizes), [lanes]);
  const suggestedLadder = useMemo(() => autoLadder(allSizes), [allSizes]);
  const suggestedAgarose = useMemo(() => defaultAgarose(allSizes), [allSizes]);
  const ladder = LADDERS.find((l) => l.id === settings.ladder.value) ?? suggestedLadder;
  const agarose = settings.agarose.value ?? suggestedAgarose;
  const hasBands = allSizes.length > 0;

  const warnings = useMemo(
    () =>
      lanes.flatMap((lane) =>
        closeGroups(lane.sizes, agarose).map((group) => ({
          lane: lane.label,
          group,
          suggestion: suggestAgarose(lane.sizes, agarose),
        })),
      ),
    [lanes, agarose],
  );

  return (
    <section class="bracket-box gel-panel" aria-label={title}>
      <div class="bracket-inner" />
      <div class="gel-head">
        <h3 class="gel-title">{title}</h3>
        <ImageExportButtons name={exportName} getSvg={() => svgRef.current} />
      </div>
      <div class="gel-controls">
        <div class="gel-field">
          <label class="field-label" for={ladderId}>
            {t('gel.ladder')}
          </label>
          <select
            id={ladderId}
            value={ladder.id}
            onChange={(event) => {
              const id = (event.currentTarget as HTMLSelectElement).value;
              settings.ladder.value = id === suggestedLadder.id ? null : id;
            }}
          >
            {LADDERS.map((l) => (
              <option key={l.id} value={l.id}>
                {`${l.vendor} ${l.name}${l.id === suggestedLadder.id && hasBands ? ` (${t('gel.suggested')})` : ''}`}
              </option>
            ))}
          </select>
        </div>
        <div class="gel-field">
          <label class="field-label" for={rangeId}>
            {t('gel.agarose')}
          </label>
          <div class="gel-agarose">
            <input
              id={rangeId}
              type="range"
              min={AGAROSE_MIN}
              max={AGAROSE_MAX}
              step={AGAROSE_STEP}
              value={agarose}
              onInput={(event) => {
                const value = Number((event.currentTarget as HTMLInputElement).value);
                settings.agarose.value = Math.abs(value - suggestedAgarose) < 1e-9 ? null : value;
              }}
            />
            <output for={rangeId}>{`${agarose.toFixed(1)} %`}</output>
            {settings.agarose.value !== null && (
              <button type="button" class="secondary" onClick={() => (settings.agarose.value = null)}>
                {t('gel.agaroseReset', { percent: suggestedAgarose.toFixed(1) })}
              </button>
            )}
          </div>
        </div>
      </div>
      {!hasBands && <p class="gel-empty">{t('gel.empty')}</p>}
      <div class="gel-figure">
        <GelFigure
          lanes={lanes}
          ladder={ladder}
          agarose={agarose}
          selected={selected}
          {...(onSelect ? { onSelect } : {})}
          svgRef={svgRef}
        />
      </div>
      {warnings.length > 0 && (
        <div class="gel-warnings">
          {warnings.map((warning) => (
            <Warning
              key={`${warning.lane}:${warning.group.sizes.join(',')}`}
              {...warning}
              onUse={(percent) => (settings.agarose.value = percent)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
