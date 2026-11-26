import type { Topology } from '../../../engine/types';
import { t } from '../../i18n';
import type { TopologyReading } from './model';
import { chooseTopology } from './topology';

const OPTIONS: readonly Topology[] = ['linear', 'circular'];

/**
 * Two buttons that set the molecule's topology. The choice is written to the document record as an undoable
 * edit, so the plasmid map and every other view follow it, and Ctrl+Z restores the earlier value.
 */
export function TopologyControl({
  docId,
  current,
  reading,
}: {
  readonly docId: string;
  /** Topology the record holds now. */
  readonly current: Topology;
  readonly reading: TopologyReading;
}) {
  const inferred = reading.basis === 'overlap' || reading.basis === 'vector' || reading.basis === 'assumed';
  const unapplied = inferred && reading.topology !== current;
  return (
    <div class="topology-control">
      <fieldset class="segmented">
        <legend class="visually-hidden">{t('summary.topology.control')}</legend>
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            class="segmented-button"
            aria-pressed={reading.topology === option}
            onClick={() => chooseTopology(docId, option)}
          >
            {t(`topology.${option}`)}
          </button>
        ))}
      </fieldset>
      {unapplied && (
        <p class="topology-hint">{t('summary.topology.unapplied', { topology: t(`topology.${current}`) })}</p>
      )}
    </div>
  );
}
