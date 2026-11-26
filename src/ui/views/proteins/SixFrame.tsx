import { useMemo } from 'preact/hooks';
import { type FrameTranslation, sixFrameTranslation } from '../../../engine/translate';
import type { SeqDocument } from '../../../state/documents';
import { copyText } from '../../export/clipboard';
import { reportCopy, reportSave } from '../../export/feedback';
import { downloadSequence } from '../../export/sequence';
import { t } from '../../i18n';
import { ScrollRegion } from './controls';
import { frameLabel } from './orfRows';
import { proteinRecord } from './proteinRecord';

/** Residues of a frame drawn on screen. Copy and export always carry the whole frame. */
export const FRAME_PREVIEW_RESIDUES = 3000;

function FrameCard({
  doc,
  frame,
  protein,
}: {
  readonly doc: SeqDocument;
  readonly frame: FrameTranslation['frame'];
  readonly protein: string;
}) {
  const label = frameLabel(frame);
  const name = `${doc.record.name}_frame${label}`;
  const description = t('proteins.frames.description', { name: doc.record.name, frame: label });
  return (
    <section class="bracket-box pv-frame-card" aria-label={t('proteins.frames.frame', { frame: label })}>
      <div class="bracket-inner" />
      <div class="pv-detail-head">
        <div>
          <h3 class="pv-detail-title">{t('proteins.frames.frame', { frame: label })}</h3>
          <p class="pv-detail-sub">
            {t('proteins.frames.length', { count: protein.length.toLocaleString() })}
          </p>
        </div>
        <div class="pv-actions">
          <button type="button" class="chip-btn" onClick={async () => reportCopy(await copyText(protein))}>
            {t('proteins.frames.copy', { frame: label })}
          </button>
          <button
            type="button"
            class="chip-btn"
            onClick={async () =>
              reportSave(await downloadSequence(proteinRecord(name, description, protein), 'fasta'))
            }
          >
            {t('proteins.frames.export', { frame: label })}
          </button>
        </div>
      </div>
      <ScrollRegion label={t('proteins.frames.cardLabel', { frame: label })}>
        {protein.slice(0, FRAME_PREVIEW_RESIDUES)}
      </ScrollRegion>
      {protein.length > FRAME_PREVIEW_RESIDUES && (
        <p class="pv-note">
          {t('proteins.translation.truncated', {
            shown: FRAME_PREVIEW_RESIDUES.toLocaleString(),
            total: protein.length.toLocaleString(),
          })}
        </p>
      )}
    </section>
  );
}

/** The plain translation of the whole sequence in all six frames, stops written as `*`. */
export function SixFrame({ doc, table }: { readonly doc: SeqDocument; readonly table: number }) {
  const frames = useMemo(() => sixFrameTranslation(doc.record.seq, { table }), [doc.record.seq, table]);
  return (
    <div class="pv-frames">
      {frames.map(({ frame, protein }) => (
        <FrameCard key={frame} doc={doc} frame={frame} protein={protein} />
      ))}
    </div>
  );
}
