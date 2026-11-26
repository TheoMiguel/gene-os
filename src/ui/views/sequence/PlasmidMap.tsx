import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SeqDocument } from '../../../state/documents';
import { viewOf } from '../../../state/view';
import { ImageExportButtons } from '../../export/ImageExportButtons';
import { t } from '../../i18n';
import { CircularOverlay, CircularStatic } from './CircularContent';
import { buildCircularScene } from './circularMap';
import { LinearOverlay, LinearStatic } from './LinearContent';
import { buildLinearScene } from './linearMap';
import type { MapItem } from './mapItems';
import { type ChosenSites, layoutFeatures, type SiteDisplay } from './mapModel';
import {
  type BaseWindow,
  type Camera,
  centerWindow,
  fitCamera,
  panCamera,
  panWindow,
  viewBoxOf,
  zoomCamera,
  zoomWindow,
} from './mapZoom';
import { PaneFrame } from './PaneFrame';
import { activePick, pickItem } from './pick';
import { type MapKind, prefsOf } from './state';
import { useElementSize } from './useElementSize';

const DRAG_THRESHOLD = 4;
const ZOOM_STEP = 1.6;
const MAP_KINDS: readonly MapKind[] = ['auto', 'circular', 'linear'];
const SITE_DISPLAYS: readonly SiteDisplay[] = ['none', 'unique', 'few', 'all'];
const KIND_KEYS = {
  auto: 'sv.map.kindAuto',
  circular: 'sv.map.kindCircular',
  linear: 'sv.map.kindLinear',
} as const;
const DISPLAY_KEYS = {
  none: 'sv.map.sitesNone',
  unique: 'sv.map.sitesUnique',
  few: 'sv.map.sitesFew',
  all: 'sv.map.sitesAll',
} as const;

interface MapProps {
  readonly doc: SeqDocument;
  /** The cuts to draw, chosen by the view from the scan, the display setting and the picked enzymes. */
  readonly sites: ChosenSites;
  /** Recognition sequence of each enzyme, for the tooltip. */
  readonly recognition: ReadonlyMap<string, string>;
}

interface Drag {
  readonly x: number;
  readonly y: number;
  readonly camera: Camera;
  readonly window: BaseWindow;
  moved: boolean;
}

/**
 * The plasmid map: circular for a circular molecule and linear for a linear one unless the user chooses, with
 * features in lanes, restriction ticks, primer arrows, a base-pair scale, collision-free labels, hover tooltips,
 * zoom and pan, and SVG and PNG export. A click selects the element in every pane.
 */
export function PlasmidMap({ doc, sites: chosen, recognition }: MapProps) {
  const { record } = doc;
  const length = record.seq.length;
  const view = viewOf(doc.id);
  const prefs = prefsOf(doc.id);
  const shape = prefs.mapKind.value;
  const circular = shape === 'auto' ? record.topology === 'circular' : shape === 'circular';
  const display = prefs.siteDisplay.value;
  const picked = prefs.picked.value;
  const selection = view.selection.value;
  const caret = view.caret.value;
  const textWindow = view.window.value;
  const clicked = activePick(prefs.pick.value, selection);

  const stage = useElementSize();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>(() => fitCamera(stage.width, stage.height));
  const [zoomed, setZoomed] = useState<BaseWindow | null>(null);
  const mapWindow = zoomed ?? { start: 0, end: Math.max(1, length) };

  const features = useMemo(() => {
    const layout = (primer: boolean) =>
      layoutFeatures(
        record.features.filter((feature) => (feature.type === 'primer_bind') === primer),
        length,
        record.topology === 'circular',
      );
    return { plain: layout(false), primers: layout(true) };
  }, [record.features, record.topology, length]);

  const common = {
    length,
    features: features.plain,
    primers: features.primers,
    sites: chosen.sites,
    hiddenSites: chosen.hidden,
    recognition,
    picked,
    width: stage.width,
    height: stage.height,
  };
  const circularScene = useMemo(
    () => (circular && length > 0 ? buildCircularScene(common) : null),
    [circular, length, features, chosen, recognition, picked, stage.width, stage.height],
  );
  const linearScene = useMemo(
    () => (!circular && length > 0 ? buildLinearScene({ ...common, window: mapWindow }) : null),
    [
      circular,
      length,
      features,
      chosen,
      recognition,
      picked,
      stage.width,
      stage.height,
      mapWindow.start,
      mapWindow.end,
    ],
  );
  const scene = circularScene ?? linearScene;

  const lengthLabel = t('sv.map.bp', { length: length.toLocaleString() });
  const circularStatic = useMemo(
    () =>
      circularScene && (
        <CircularStatic
          scene={circularScene}
          name={record.name}
          length={length}
          picked={picked}
          lengthLabel={lengthLabel}
        />
      ),
    [circularScene, record.name, length, picked, lengthLabel],
  );
  const linearStatic = useMemo(
    () => linearScene && <LinearStatic scene={linearScene} picked={picked} />,
    [linearScene, picked],
  );

  const ordered = useMemo(
    () => (scene ? [...scene.items.values()].sort((a, b) => a.select.start - b.select.start) : []),
    [scene],
  );
  const highlight = [hover?.id, focused, clicked].filter((id): id is string => Boolean(id));

  useEffect(() => {
    if (circular || !zoomed || !selection || !clicked) return;
    if (selection.start < zoomed.start || selection.end > zoomed.end)
      setZoomed(centerWindow((selection.start + selection.end) / 2, zoomed.end - zoomed.start, length));
    // Only a new click moves the window; dragging the window must not be undone.
  }, [clicked]);

  const zoomBy = (factor: number, fx = 0.5, fy = 0.5) => {
    if (circular) setCamera((old) => zoomCamera(old, stage.width, stage.height, fx, fy, factor));
    else setZoomed((old) => zoomWindow(old ?? mapWindow, length, fx, factor));
  };
  const resetZoom = () => {
    setCamera(fitCamera(stage.width, stage.height));
    setZoomed(null);
  };
  const isZoomed = circular ? camera.k > 1 : zoomed !== null;

  const fractions = (event: { clientX: number; clientY: number }) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return { fx: 0.5, fy: 0.5, x: 0, y: 0 };
    return {
      fx: (event.clientX - box.left) / box.width,
      fy: (event.clientY - box.top) / box.height,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    };
  };
  const itemUnder = (target: EventTarget | null): MapItem | null => {
    const id = (target as Element | null)?.closest?.('[data-id]')?.getAttribute('data-id');
    return (id && scene?.items.get(id)) || null;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const { fx, fy } = fractions(event);
    zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, fx, fy);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    suppressClick.current = false;
    drag.current = { x: event.clientX, y: event.clientY, camera, window: mapWindow, moved: false };
  };
  const onPointerMove = (event: PointerEvent) => {
    const start = drag.current;
    if (start && event.buttons === 1) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!start.moved) svgRef.current?.setPointerCapture?.(event.pointerId);
      start.moved = true;
      suppressClick.current = true;
      setHover(null);
      const box = svgRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      if (circular)
        setCamera(panCamera(start.camera, stage.width, stage.height, dx / box.width, dy / box.height));
      else setZoomed(panWindow(start.window, length, -dx / box.width));
      return;
    }
    const item = itemUnder(event.target);
    const { x, y } = fractions(event);
    setHover(item ? { id: item.id, x, y } : null);
  };
  const onPointerUp = (event: PointerEvent) => {
    drag.current = null;
    svgRef.current?.releasePointerCapture?.(event.pointerId);
  };
  const onClick = (event: MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const item = itemUnder(event.target);
    if (item) pickItem(view, prefs, item);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = focused ? ordered.findIndex((item) => item.id === focused) : -1;
    const move = (to: number) => {
      const item = ordered[(to + ordered.length) % ordered.length];
      if (item) setFocused(item.id);
    };
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(index < 0 ? -1 : index - 1);
    else if ((event.key === 'Enter' || event.key === ' ') && focused) {
      const item = scene?.items.get(focused);
      if (item) pickItem(view, prefs, item);
    } else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-') zoomBy(1 / ZOOM_STEP);
    else if (event.key === '0') resetZoom();
    else if (event.key === 'Escape') setFocused(null);
    else return;
    event.preventDefault();
  };

  const tooltip = hover ? scene?.items.get(hover.id) : null;
  const focusedItem = focused ? scene?.items.get(focused) : null;
  const strandText = (item: MapItem) =>
    t(item.strand === -1 ? 'sv.map.strandReverse' : 'sv.map.strandForward');

  return (
    <PaneFrame index="01" title={t('sv.map.title')} class="map-pane">
      <div class="pane-tools">
        <label class="tool inline">
          <span class="field-label">{t('sv.map.shape')}</span>
          <select
            value={shape}
            onChange={(event) => {
              prefs.mapKind.value = (event.currentTarget as HTMLSelectElement).value as MapKind;
              resetZoom();
            }}
          >
            {MAP_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(KIND_KEYS[kind])}
              </option>
            ))}
          </select>
        </label>
        <label class="tool inline">
          <span class="field-label">{t('sv.map.sites')}</span>
          <select
            value={display}
            onChange={(event) => {
              prefs.siteDisplay.value = (event.currentTarget as HTMLSelectElement).value as SiteDisplay;
            }}
          >
            {SITE_DISPLAYS.map((option) => (
              <option key={option} value={option}>
                {t(DISPLAY_KEYS[option])}
              </option>
            ))}
          </select>
        </label>
        <span class="tool-group">
          <button
            type="button"
            class="export-button"
            aria-label={t('sv.map.zoomIn')}
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            +
          </button>
          <button
            type="button"
            class="export-button"
            aria-label={t('sv.map.zoomOut')}
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            −
          </button>
          <button type="button" class="export-button" disabled={!isZoomed} onClick={resetZoom}>
            {t('sv.map.zoomReset')}
          </button>
        </span>
        <ImageExportButtons name={`${record.name}-map`} getSvg={() => svgRef.current} />
      </div>
      <div
        class="map-stage"
        ref={stage.ref}
        role="application"
        aria-roledescription={t('sv.map.title')}
        aria-label={t('sv.map.label', {
          name: record.name,
          length: length.toLocaleString(),
          topology: t(`topology.${record.topology}`),
        })}
        aria-describedby="sv-map-hint"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the map takes arrow keys to step through its elements
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {length === 0 || !scene ? (
          <p class="pane-empty">{t('sv.map.empty')}</p>
        ) : (
          <svg
            ref={svgRef}
            class="map-svg"
            width={stage.width}
            height={stage.height}
            viewBox={
              circular ? viewBoxOf(camera, stage.width, stage.height) : `0 0 ${stage.width} ${stage.height}`
            }
            aria-hidden="true"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onClick={onClick}
          >
            {circular ? circularStatic : linearStatic}
            {circularScene ? (
              <CircularOverlay
                scene={circularScene}
                length={length}
                selection={selection}
                caret={caret}
                window={textWindow}
                highlight={highlight}
              />
            ) : (
              linearScene && (
                <LinearOverlay
                  scene={linearScene}
                  selection={selection}
                  caret={caret}
                  highlight={highlight}
                />
              )
            )}
          </svg>
        )}
        {tooltip && hover && (
          <div
            class="map-tooltip"
            role="tooltip"
            style={{ left: `${Math.min(hover.x + 14, stage.width - 190)}px`, top: `${hover.y + 14}px` }}
          >
            <b>{tooltip.title}</b>
            <span>{tooltip.detail}</span>
            <span>{t('sv.map.tipSpan', { span: tooltip.span })}</span>
            <span>{strandText(tooltip)}</span>
          </div>
        )}
        <span class="visually-hidden" role="status" aria-live="polite">
          {focusedItem ? `${focusedItem.title}, ${focusedItem.detail}, ${focusedItem.span}` : ''}
        </span>
      </div>
      <p class="pane-note" id="sv-map-hint">
        {scene && scene.hiddenSites > 0
          ? t('sv.map.hiddenSites', { count: scene.hiddenSites.toLocaleString() })
          : t('sv.map.hint')}
      </p>
    </PaneFrame>
  );
}
