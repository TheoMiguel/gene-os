import { ALL_FRAMES, type Frame, GENETIC_CODES } from '../../../engine/translate';
import type { Topology } from '../../../engine/types';
import { t } from '../../i18n';
import { CheckField, NumberField, SegmentedField, SelectField } from './controls';
import { frameLabel } from './orfRows';
import type { OrfSettings } from './orfSession';

const START_OPTIONS = [
  { value: 'atg', label: 'proteins.start.atg' },
  { value: 'atg-gtg-ttg', label: 'proteins.start.three' },
  { value: 'table', label: 'proteins.start.table' },
] as const;

interface OrfParamsProps {
  readonly docId: string;
  readonly settings: OrfSettings;
  readonly topology: Topology;
  readonly advanced: boolean;
  readonly onChange: (patch: Partial<OrfSettings>) => void;
}

/**
 * The ORF search controls. A student sees the minimum length and the start-codon set; advanced mode adds the
 * strands and frames, the genetic code and the reporting options.
 */
export function OrfParams({ docId, settings, topology, advanced, onChange }: OrfParamsProps) {
  const toggleFrame = (frame: Frame, on: boolean) =>
    onChange({ frames: ALL_FRAMES.filter((f) => (f === frame ? on : settings.frames.includes(f))) });

  return (
    <div class="pv-params">
      <NumberField
        id={`${docId}-orf-min`}
        label={t('proteins.param.minCodons')}
        value={settings.minCodons}
        min={1}
        max={100000}
        onCommit={(minCodons) => onChange({ minCodons })}
      />
      <SegmentedField
        legend={t('proteins.param.startCodons')}
        name={`${docId}-orf-start`}
        value={settings.startCodons}
        options={START_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
        onChange={(startCodons) => onChange({ startCodons })}
      />
      {advanced && (
        <>
          <fieldset class="settings-field view-field">
            <legend class="field-label">{t('proteins.param.frames')}</legend>
            <div class="pv-check-row">
              {ALL_FRAMES.map((frame) => (
                <CheckField
                  key={frame}
                  label={frameLabel(frame)}
                  checked={settings.frames.includes(frame)}
                  onChange={(on) => toggleFrame(frame, on)}
                />
              ))}
            </div>
          </fieldset>
          <SelectField
            id={`${docId}-orf-code`}
            label={t('proteins.param.table')}
            value={settings.table}
            options={GENETIC_CODES.map((code) => ({ value: code.id, label: `${code.id}. ${code.name}` }))}
            onChange={(table) => onChange({ table })}
          />
          <NumberField
            id={`${docId}-orf-window`}
            label={t('proteins.param.window')}
            value={settings.hydropathyWindow}
            min={3}
            max={51}
            onCommit={(hydropathyWindow) => onChange({ hydropathyWindow })}
          />
          <fieldset class="settings-field view-field">
            <legend class="field-label">{t('proteins.param.report')}</legend>
            <div class="pv-check-row">
              <CheckField
                label={t('proteins.param.allStarts')}
                checked={!settings.longestOnly}
                onChange={(on) => onChange({ longestOnly: !on })}
              />
              {topology === 'linear' && (
                <CheckField
                  label={t('proteins.param.openEnded')}
                  checked={settings.openEnded}
                  onChange={(openEnded) => onChange({ openEnded })}
                />
              )}
            </div>
          </fieldset>
        </>
      )}
    </div>
  );
}
