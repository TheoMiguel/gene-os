import { useMemo } from 'preact/hooks';
import type { PrimerPair } from '../../engine/primers';
import type { Feature, Primer, PrimerBinding } from '../../engine/types';
import type { SeqDocument } from '../../state/documents';
import type { Overlay } from '../../state/view';
import { editFeatures, viewOf } from '../../state/view';
import { t } from '../i18n';
import { cleanPrimer, invalidCharacters } from './primers/analysis';
import { bestBindings, bindingFeature, exactBinding, splitAtOrigin } from './primers/binding';
import { DesignSection } from './primers/DesignSection';
import { PcrSection } from './primers/PcrSection';
import { PrimerAnalysisSection } from './primers/PrimerAnalysis';
import { Specificity } from './primers/Specificity';
import { COLONY_PCR_PAIR, HAIRPIN_EXAMPLE, standardPrimer } from './primers/standardPrimers';
import { primersGelOf, primersStateOf } from './primers/state';
import { usePrimerScan } from './primers/useScan';
import './primers/persist';
import './primers/primers.css';

const isUsable = (seq: string) => seq.length > 0 && invalidCharacters(seq).length === 0;

/**
 * The Primers & PCR view: manual primer analysis, specificity on the loaded sequence, automatic design for a region,
 * and virtual PCR with a gel. Primers the user adds become `primer_bind` features, so the plasmid map and the
 * sequence viewer draw them and Ctrl+Z removes them.
 */
export function Panel({ doc }: { readonly doc: SeqDocument }) {
  const { record } = doc;
  const n = record.seq.length;
  const state = primersStateOf(doc.id);
  const view = viewOf(doc.id);

  const forwardName = state.forwardName.value.trim() || t('primers.forward');
  const reverseName = state.reverseName.value.trim() || t('primers.reverse');
  const forwardSeq = cleanPrimer(state.forward.value);
  const reverseSeq = cleanPrimer(state.reverse.value);
  const primers = useMemo<Primer[]>(
    () => [
      ...(isUsable(forwardSeq) ? [{ id: 'fwd', name: forwardName, seq: forwardSeq }] : []),
      ...(isUsable(reverseSeq) ? [{ id: 'rev', name: reverseName, seq: reverseSeq }] : []),
    ],
    [forwardSeq, reverseSeq, forwardName, reverseName],
  );
  const scan = usePrimerScan(
    primers,
    record.seq,
    record.topology,
    state.mismatches.value,
    state.scanLarge.value,
  );

  const designed = state.design.value;
  const pair = state.pair.value;
  const selectedPair = designed.status === 'done' && pair !== null ? designed.pairs[pair] : undefined;
  const pairOverlays = useMemo<Overlay[]>(() => {
    if (!selectedPair) return [];
    const bindings: PrimerBinding[] = [
      exactBinding('design-fwd', 1, selectedPair.forward.span, n),
      exactBinding('design-rev', -1, selectedPair.reverse.span, n),
    ];
    return splitAtOrigin(bindings, n).map((binding, i) => ({
      id: `primer:${binding.primerId}:${binding.span.start}:${i}`,
      kind: 'primer',
      start: binding.span.start,
      end: binding.span.end,
      strand: binding.strand,
      label: binding.primerId === 'design-fwd' ? t('primers.designForward') : t('primers.designReverse'),
      color: binding.primerId === 'design-fwd' ? 'var(--accent)' : 'var(--cyan)',
    }));
  }, [selectedPair, n]);

  const setPrimers = (forward: string, reverse: string, forwardLabel: string, reverseLabel: string) => {
    state.forward.value = forward;
    state.reverse.value = reverse;
    state.forwardName.value = forwardLabel;
    state.reverseName.value = reverseLabel;
    state.binding.value = null;
    state.product.value = null;
  };
  const colony = () => {
    const [f, r] = COLONY_PCR_PAIR.map((id) => standardPrimer(id));
    if (f && r) setPrimers(f.seq, r.seq, f.name, r.name);
  };
  const take = (chosen: PrimerPair) =>
    setPrimers(
      chosen.forward.seq,
      chosen.reverse.seq,
      `${record.name}_F${chosen.forward.span.start + 1}`,
      `${record.name}_R${chosen.reverse.span.end % n || n}`,
    );

  const addFeatures = (label: string, additions: readonly Feature[]) =>
    editFeatures(doc.id, label, (features) => {
      const ids = new Set(additions.map((feature) => feature.id));
      return [...features.filter((feature) => !ids.has(feature.id)), ...additions];
    });
  const addManual = () => {
    if (scan.status !== 'ready') return;
    const additions = primers.flatMap((primer) => {
      const own = scan.bindings.filter((binding) => binding.primerId === primer.id);
      return own.length === 0
        ? []
        : bestBindings(own).map((binding) => bindingFeature(primer, binding, n, record.topology));
    });
    if (additions.length > 0) addFeatures('add primers', additions);
  };
  const addPair = (chosen: PrimerPair) =>
    addFeatures('add primer pair', [
      bindingFeature(
        { name: `${record.name}_F${chosen.forward.span.start + 1}`, seq: chosen.forward.seq },
        exactBinding('f', 1, chosen.forward.span, n),
        n,
        record.topology,
      ),
      bindingFeature(
        { name: `${record.name}_R${chosen.reverse.span.end % n || n}`, seq: chosen.reverse.seq },
        exactBinding('r', -1, chosen.reverse.span, n),
        n,
        record.topology,
      ),
    ]);

  const selectRange = (start: number, end: number, strand: 1 | -1) => {
    view.select(start, Math.min(end, n), strand);
    view.reveal(start);
  };
  const manualAdditions = scan.status === 'ready' ? scan.bindings.length : 0;

  return (
    <div class="primers-view">
      <section class="bracket-box primers-card">
        <div class="bracket-inner" />
        <div class="stage-label">01</div>
        <h2 class="stage-title">{t('primers.analysisTitle')}</h2>
        <div class="primers-actions">
          <button type="button" class="secondary" onClick={colony}>
            {t('primers.exampleM13')}
          </button>
          <button
            type="button"
            class="secondary"
            onClick={() =>
              setPrimers(HAIRPIN_EXAMPLE, state.reverse.value, t('primers.hairpinName'), reverseName)
            }
          >
            {t('primers.exampleHairpin')}
          </button>
          <button
            type="button"
            class="secondary"
            onClick={() => setPrimers('', '', t('primers.forward'), t('primers.reverse'))}
          >
            {t('primers.clear')}
          </button>
        </div>
        <PrimerAnalysisSection
          forward={{
            name: state.forwardName.value,
            seq: state.forward.value,
            onName: (v) => (state.forwardName.value = v),
            onSeq: (v) => (state.forward.value = v),
            label: t('primers.forward'),
          }}
          reverse={{
            name: state.reverseName.value,
            seq: state.reverse.value,
            onName: (v) => (state.reverseName.value = v),
            onSeq: (v) => (state.reverse.value = v),
            label: t('primers.reverse'),
          }}
          conditions={state.conditions.value}
          onConditions={(next) => (state.conditions.value = next)}
          mismatches={state.mismatches.value}
          onMismatches={(v) => (state.mismatches.value = v)}
        />
      </section>

      <section class="bracket-box primers-card">
        <div class="bracket-inner" />
        <div class="stage-label">02</div>
        <h2 class="stage-title">{t('primers.specificityTitle')}</h2>
        <div class="primers-actions">
          <button type="button" class="secondary" disabled={manualAdditions === 0} onClick={addManual}>
            {t('primers.addToSequence')}
          </button>
          <span class="primers-hint">{t('primers.addToSequenceHint')}</span>
        </div>
        <Specificity
          record={record}
          primers={primers}
          scan={scan}
          view={view}
          selected={state.binding.value}
          onSelect={(index) => {
            state.binding.value = index;
            const binding = scan.status === 'ready' ? scan.bindings[index] : undefined;
            if (binding) selectRange(binding.span.start, binding.span.end, binding.strand);
          }}
          onScanLarge={() => (state.scanLarge.value = true)}
          extraOverlays={pairOverlays}
        />
      </section>

      <section class="bracket-box primers-card">
        <div class="bracket-inner" />
        <div class="stage-label">03</div>
        <h2 class="stage-title">{t('primers.designTitle')}</h2>
        <DesignSection
          seq={record.seq}
          topology={record.topology}
          view={view}
          conditions={state.conditions.value}
          regionStart={state.regionStart}
          regionEnd={state.regionEnd}
          inputs={state.inputs}
          design={state.design}
          pair={state.pair}
          onTake={take}
          onAdd={addPair}
        />
      </section>

      <section class="bracket-box primers-card" id={`${doc.id}-pcr`}>
        <div class="bracket-inner" />
        <div class="stage-label">04</div>
        <h2 class="stage-title">{t('pcr.title')}</h2>
        <PcrSection
          record={record}
          primers={primers}
          scan={scan}
          selected={state.product.value}
          onSelect={(index) => {
            state.product.value = index;
            const amplicon = scan.status === 'ready' ? scan.amplicons[index] : undefined;
            if (amplicon) selectRange(amplicon.forward.span.start, amplicon.reverse.span.end, 1);
          }}
          gel={primersGelOf(doc.id)}
          onColony={colony}
          onScanLarge={() => (state.scanLarge.value = true)}
        />
      </section>
    </div>
  );
}
