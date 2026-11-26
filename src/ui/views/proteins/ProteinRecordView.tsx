import type { SeqDocument } from '../../../state/documents';
import { useAdvanced } from '../../../state/settings';
import { t } from '../../i18n';
import { NumberField } from './controls';
import { orfSessionOf } from './orfSession';
import { HydropathyBlock, ProteinInspector, Translation } from './ProteinDetail';

/** The Proteins view of a protein record: no DNA to search, so the inspector shows the whole chain. */
export function ProteinRecordView({ doc }: { readonly doc: SeqDocument }) {
  const { record } = doc;
  const advanced = useAdvanced();
  const session = orfSessionOf(doc.id);
  const { hydropathyWindow } = session.settings.value;
  const protein = record.seq.replaceAll('*', '');
  return (
    <div class="pv">
      <div class="bracket-box pv-card">
        <div class="bracket-inner" />
        <div class="stage-label">01</div>
        <h2 class="stage-title">{t('proteins.stage.protein')}</h2>
        {advanced && (
          <NumberField
            id={`${doc.id}-protein-window`}
            label={t('proteins.param.window')}
            value={hydropathyWindow}
            min={3}
            max={51}
            onCommit={(next) => {
              session.settings.value = { ...session.settings.value, hydropathyWindow: next };
            }}
          />
        )}
        <Translation protein={protein} />
        <HydropathyBlock protein={protein} window={hydropathyWindow} exportName={record.name} />
      </div>
      <div class="bracket-box pv-card">
        <div class="bracket-inner" />
        <ProteinInspector
          title={record.name}
          subtitle={t('proteins.record.subtitle', { count: protein.length.toLocaleString() })}
          protein={protein}
          searchName={record.metadata.accession ?? record.name}
          exportName={record.name}
        />
      </div>
    </div>
  );
}
