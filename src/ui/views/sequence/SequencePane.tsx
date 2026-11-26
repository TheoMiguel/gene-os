import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { RestrictionScan } from '../../../engine/restriction';
import { ALL_FRAMES, GENETIC_CODES, getGeneticCode } from '../../../engine/translate';
import type { PrimerBinding, Span } from '../../../engine/types';
import { useAnalysis } from '../../../state/analysis';
import type { SeqDocument } from '../../../state/documents';
import { useAdvanced } from '../../../state/settings';
import { OVERLAY_KINDS, type OverlayKind, viewOf } from '../../../state/view';
import { copyText } from '../../export/clipboard';
import { reportCopy, reportSave } from '../../export/feedback';
import { downloadSequence } from '../../export/sequence';
import { type MessageKey, t } from '../../i18n';
import { shortcuts } from '../../shortcuts';
import { featureOverlays, primerOverlays, restrictionOverlays, searchOverlays } from '../../viz/overlays';
import { SequenceRenderer } from '../../viz/SequenceRenderer';
import { useElementSize } from '../../viz/useContainerSize';
import { longestSpan } from './mapModel';
import { PaneFrame } from './PaneFrame';
import { Segmented } from './Segmented';
import {
  oppositeStrandText,
  selectedStrandText,
  selectionRecord,
  selectionStats,
  selectionTranslation,
} from './selection';
import { prefsOf, type ReadMode } from './state';

const BLOCK_SIZE = 10;
const CHAR_PX = 8.4;
const SCROLL_GUTTER_PX = 28;
const LINE_LENGTHS = [30, 60, 90, 120, 150] as const;
const MODES: readonly ReadMode[] = ['text', 'blocks', 'sixFrame', 'singleFrame'];
const MODE_KEYS = {
  text: 'sv.seq.modeText',
  blocks: 'sv.seq.modeBlocks',
  sixFrame: 'sv.seq.modeSix',
  singleFrame: 'sv.seq.modeOne',
} as const;
const OVERLAY_KEYS = {
  feature: 'sv.seq.showFeatures',
  restriction: 'sv.seq.showSites',
  search: 'sv.seq.showHits',
  primer: 'sv.seq.showPrimers',
} as const;
const FRAMES = ALL_FRAMES;

interface SequencePaneProps {
  readonly doc: SeqDocument;
  readonly scan: RestrictionScan | null;
  /** Enzymes whose sites show in the text. */
  readonly shown: ReadonlySet<string>;
}

/** How many bases fit on a line in `width` px. A multiple of ten, so the numbers on the left stay tidy. */
export function fitLineLength(width: number, length: number, blockSize: number): number {
  const digits = String(Math.max(1, length)).length + 2;
  const columns = (width - SCROLL_GUTTER_PX) / CHAR_PX - digits;
  const bases = blockSize > 0 ? (columns * blockSize) / (blockSize + 1) : columns;
  return Math.max(10, Math.min(300, Math.floor(bases / 10) * 10));
}

const spanOf = (location: { readonly segments: readonly Span[] }) => longestSpan(location.segments);

/**
 * The sequence viewer and its controls: view modes, line length, frames, layers, jump to position, find, the
 * selection readout with its actions. The text is the shared sequence renderer, so the selection is the same one
 * the map and the list show.
 */
export function SequencePane({ doc, scan, shown }: SequencePaneProps) {
  const { record } = doc;
  const view = viewOf(doc.id);
  const prefs = prefsOf(doc.id);
  const mode = prefs.readMode.value;
  const fit = prefs.lineFit.value;
  const picked = prefs.picked.value;
  const selection = view.selection.value;
  const caret = view.caret.value;
  const search = view.search.value;
  const hits = view.hits.value;
  const enabled = view.overlays.value;
  const protein = record.alphabet === 'protein';
  const advanced = useAdvanced();
  const codeId = prefs.geneticCode.value;
  const stage = useElementSize();
  const jumpRef = useRef<HTMLInputElement | null>(null);
  const hitIndex = useRef(-1);
  const laidOut = useRef(false);

  const blockSize = mode === 'blocks' ? BLOCK_SIZE : 0;
  const lineLength = fit === 'auto' ? fitLineLength(stage.width, record.seq.length, blockSize) : fit;
  const frame = prefs.frame.value;
  const frameCount = protein ? 0 : mode === 'sixFrame' ? ALL_FRAMES.length : mode === 'singleFrame' ? 1 : 0;
  useEffect(() => {
    view.lineLength.value = lineLength;
    if (!laidOut.current) {
      laidOut.current = true;
      return;
    }
    // Rows change height and length with the mode and the line length, so keep the middle of the screen in view.
    const { start, end } = view.window.peek();
    view.reveal((start + end) / 2);
  }, [view, lineLength, blockSize, frameCount]);

  useEffect(() => {
    view.frames.value = protein ? [] : mode === 'sixFrame' ? FRAMES : mode === 'singleFrame' ? [frame] : [];
  }, [view, mode, frame, protein]);

  useEffect(() => shortcuts.on('goTo', () => jumpRef.current?.focus()), []);

  const found = useAnalysis(doc, 'search', { query: search.query, mode: search.mode });
  useEffect(() => {
    if (found.status === 'ready') view.hits.value = found.value.hits;
    else if (search.query === '') view.hits.value = [];
  }, [view, found, search.query]);

  const overlays = useMemo(() => {
    const plain = record.features.filter((feature) => feature.type !== 'primer_bind');
    const bindings: PrimerBinding[] = [];
    const names = new Map<string, string>();
    for (const feature of record.features) {
      if (feature.type !== 'primer_bind') continue;
      names.set(feature.id, feature.name);
      for (const span of feature.location.segments)
        bindings.push({ primerId: feature.id, strand: feature.location.strand, span, mismatches: 0 });
    }
    const sites = scan
      ? [
          ...restrictionOverlays(scan, new Set([...shown].filter((name) => !picked.has(name)))),
          ...restrictionOverlays(scan, picked).map((overlay) => ({ ...overlay, color: 'var(--accent)' })),
        ]
      : [];
    return [...featureOverlays(plain), ...sites, ...primerOverlays(bindings, names), ...searchOverlays(hits)];
  }, [record.features, scan, shown, picked, hits]);

  const stats = useMemo(
    () => (selection ? selectionStats(record.seq, selection, record.alphabet) : null),
    [selection, record.seq, record.alphabet],
  );

  const copy = async (text: string) => reportCopy(await copyText(text));
  const stepHit = (direction: 1 | -1) => {
    if (hits.length === 0) return;
    hitIndex.current = (hitIndex.current + direction + hits.length) % hits.length;
    const hit = hits[hitIndex.current];
    if (!hit) return;
    const span = spanOf(hit.location);
    view.select(span.start, span.end, hit.strand);
    view.reveal(span.start);
  };
  const jump = (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem('position') as HTMLInputElement;
    const position = Number.parseInt(input.value.replaceAll(/[,\s]/g, ''), 10);
    if (Number.isFinite(position) && position >= 1) view.goTo(Math.min(position, record.seq.length) - 1);
  };

  const lineOption = t('sv.seq.lineAuto', {
    count: fitLineLength(stage.width, record.seq.length, blockSize),
  });
  const action = (label: MessageKey, short: MessageKey) => ({
    title: t(label),
    'aria-label': t(label),
    children: t(short),
  });

  return (
    <PaneFrame index="02" title={t('sv.seq.title')} class="text-pane">
      <div class="pane-tools">
        {!protein && (
          <Segmented
            legend={t('sv.seq.mode')}
            name={`mode-${doc.id}`}
            value={mode}
            options={MODES.map((value) => ({ value, label: t(MODE_KEYS[value]) }))}
            onChange={(value) => {
              prefs.readMode.value = value;
            }}
          />
        )}
        {mode === 'singleFrame' && !protein && (
          <label class="tool inline">
            <span class="field-label">{t('sv.seq.frame')}</span>
            <select
              value={String(frame)}
              onChange={(event) => {
                prefs.frame.value = Number((event.currentTarget as HTMLSelectElement).value) as typeof frame;
              }}
            >
              {FRAMES.map((value) => (
                <option key={value} value={String(value)}>
                  {value > 0 ? `+${value}` : value}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div class="pane-tools">
        <form class="tool inline" onSubmit={jump}>
          <label class="field-label" for={`jump-${doc.id}`}>
            {t('sv.seq.jump')}
          </label>
          <input
            id={`jump-${doc.id}`}
            name="position"
            ref={jumpRef}
            class="narrow-input"
            inputMode="numeric"
            placeholder={String(Math.min(caret + 1, record.seq.length))}
            autoComplete="off"
          />
          <button type="submit" class="export-button">
            {t('sv.seq.go')}
          </button>
        </form>
        <div class="tool inline">
          <label class="field-label" for={`find-${doc.id}`}>
            {t('sv.seq.find')}
          </label>
          <input
            id={`find-${doc.id}`}
            type="search"
            class="wide-input"
            value={search.query}
            placeholder={t('sv.seq.findPlaceholder')}
            autoComplete="off"
            spellcheck={false}
            onInput={(event) => {
              hitIndex.current = -1;
              view.search.value = { ...search, query: (event.currentTarget as HTMLInputElement).value };
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') stepHit(event.shiftKey ? -1 : 1);
            }}
          />
          <button
            type="button"
            class="export-button"
            aria-label={t('sv.seq.prevHit')}
            disabled={hits.length === 0}
            onClick={() => stepHit(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            class="export-button"
            aria-label={t('sv.seq.nextHit')}
            disabled={hits.length === 0}
            onClick={() => stepHit(1)}
          >
            ›
          </button>
          <span class="tool-status" role="status" aria-live="polite">
            {found.status === 'failed'
              ? t('sv.seq.findFailed')
              : search.query === ''
                ? ''
                : t('sv.seq.hits', { count: hits.length.toLocaleString() })}
          </span>
        </div>
        <details class="options">
          <summary>{t('sv.seq.options')}</summary>
          <div class="options-body">
            <label class="tool inline">
              <span class="field-label">{t('sv.seq.lineLength')}</span>
              <select
                value={String(fit)}
                onChange={(event) => {
                  const value = (event.currentTarget as HTMLSelectElement).value;
                  prefs.lineFit.value = value === 'auto' ? 'auto' : Number(value);
                }}
              >
                <option value="auto">{lineOption}</option>
                {LINE_LENGTHS.map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {advanced && !protein && (
              <label class="tool inline">
                <span class="field-label">{t('sv.seq.geneticCode')}</span>
                <select
                  value={String(codeId)}
                  onChange={(event) => {
                    prefs.geneticCode.value = Number((event.currentTarget as HTMLSelectElement).value);
                  }}
                >
                  {GENETIC_CODES.map((code) => (
                    <option key={code.id} value={String(code.id)}>
                      {`${code.id}. ${code.name}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <fieldset class="layers">
              <legend class="field-label">{t('sv.seq.layers')}</legend>
              {OVERLAY_KINDS.filter((kind) => !protein || kind === 'search').map((kind: OverlayKind) => (
                <label key={kind} class="check">
                  <input
                    type="checkbox"
                    checked={enabled[kind]}
                    onChange={(event) => {
                      view.overlays.value = {
                        ...enabled,
                        [kind]: (event.currentTarget as HTMLInputElement).checked,
                      };
                    }}
                  />
                  {t(OVERLAY_KEYS[kind])}
                </label>
              ))}
            </fieldset>
          </div>
        </details>
      </div>
      <div class="text-stage" ref={stage.ref}>
        <SequenceRenderer
          seq={record.seq}
          alphabet={record.alphabet}
          view={view}
          overlays={overlays}
          blockSize={blockSize}
          geneticCode={getGeneticCode(codeId)}
          label={t('sv.seq.label', { name: record.name })}
        />
      </div>
      <div class="selection-bar">
        <p class="selection-readout">
          {selection && stats ? (
            <>
              <b>{`${(selection.start + 1).toLocaleString()}–${selection.end.toLocaleString()}`}</b>
              <span>{t('sv.seq.length', { count: stats.length.toLocaleString() })}</span>
              {stats.gc !== null && <span>{t('sv.seq.gc', { value: stats.gc.toFixed(1) })}</span>}
              {stats.tm !== null && <span>{t('sv.seq.tm', { value: stats.tm.toFixed(1) })}</span>}
              {selection.strand === -1 && <span>{t('sv.seq.reverseStrand')}</span>}
            </>
          ) : (
            <span>
              {t('sv.seq.caret', { position: Math.min(caret + 1, record.seq.length).toLocaleString() })}
            </span>
          )}
        </p>
        <span class="selection-actions">
          <button
            type="button"
            class="export-button"
            disabled={!selection}
            onClick={() => selection && void copy(selectedStrandText(record.seq, selection, record.alphabet))}
            {...action('sv.seq.copy', 'sv.seq.copyShort')}
          />
          {!protein && (
            <>
              <button
                type="button"
                class="export-button"
                disabled={!selection}
                onClick={() =>
                  selection && void copy(oppositeStrandText(record.seq, selection, record.alphabet))
                }
                {...action('sv.seq.copyReverse', 'sv.seq.copyReverseShort')}
              />
              <button
                type="button"
                class="export-button"
                disabled={!selection || selection.end - selection.start < 3}
                onClick={() =>
                  selection && void copy(selectionTranslation(record.seq, selection, record.alphabet, codeId))
                }
                {...action('sv.seq.copyTranslation', 'sv.seq.copyTranslationShort')}
              />
            </>
          )}
          <button
            type="button"
            class="export-button"
            disabled={!selection}
            onClick={async () =>
              selection && reportSave(await downloadSequence(selectionRecord(record, selection), 'fasta'))
            }
            {...action('sv.seq.exportFasta', 'sv.seq.exportFastaShort')}
          />
        </span>
      </div>
    </PaneFrame>
  );
}
