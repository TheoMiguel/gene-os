import { useEffect, useId, useState } from 'preact/hooks';
import type { FeatureType } from '../../../engine/types';
import { settings } from '../../../state/settings';
import { t } from '../../i18n';
import { FEATURE_COLORS } from '../../viz/colors';
import { contrastGrade, contrastRatio, parseColor } from './model';

const FALLBACK_BACKGROUND = [8, 18, 26] as const;

/** The page background as the current theme draws it. */
function themeBackground(): readonly [number, number, number] {
  const css = getComputedStyle(document.documentElement).getPropertyValue('--bg');
  return parseColor(css) ?? FALLBACK_BACKGROUND;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface ColorPickerProps {
  /** The color the user chose, or undefined for the color of the feature's type. */
  readonly value: string | undefined;
  readonly type: FeatureType;
  readonly onChange: (color: string | undefined) => void;
}

/**
 * Picks a feature color: the theme's feature palette first, then a free color, with the contrast of the result
 * against the current background so a color that vanishes on a theme shows before it is saved.
 */
export function ColorPicker({ value, type, onChange }: ColorPickerProps) {
  const id = useId();
  const { luminosity, palette } = settings.value;
  const effective = value ?? FEATURE_COLORS[type];
  const rgb = parseColor(effective);
  const ratio = rgb ? contrastRatio(rgb, themeBackground()) : null;
  const grade = ratio === null ? null : contrastGrade(ratio);
  const free = HEX.test(effective) ? effective : '#888888';
  const [hex, setHex] = useState(value ?? '');
  useEffect(() => setHex(value ?? ''), [value]);

  return (
    <fieldset class="color-picker" data-theme-key={`${palette}/${luminosity}`}>
      <legend class="field-label">{t('features.field.color')}</legend>
      <div class="swatches">
        <button
          type="button"
          class={`swatch swatch-default${value === undefined ? ' on' : ''}`}
          aria-pressed={value === undefined}
          title={t('features.color.default')}
          onClick={() => onChange(undefined)}
        >
          <span class="swatch-chip" style={{ background: FEATURE_COLORS[type] }} />
          {t('features.color.default')}
        </button>
        {(Object.keys(FEATURE_COLORS) as FeatureType[]).map((name) => (
          <button
            key={name}
            type="button"
            class={`swatch${value === FEATURE_COLORS[name] ? ' on' : ''}`}
            aria-pressed={value === FEATURE_COLORS[name]}
            aria-label={t(`feat.type.${name}`)}
            title={t(`feat.type.${name}`)}
            onClick={() => onChange(FEATURE_COLORS[name])}
          >
            <span class="swatch-chip" style={{ background: FEATURE_COLORS[name] }} />
          </button>
        ))}
      </div>
      <div class="color-free">
        <label class="color-free-label" for={`${id}-free`}>
          {t('features.color.free')}
        </label>
        <input
          id={`${id}-free`}
          type="color"
          value={free}
          onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
        />
        <input
          type="text"
          class="color-hex"
          aria-label={t('features.color.hex')}
          value={hex}
          placeholder="#rrggbb"
          maxLength={7}
          onInput={(event) => {
            const text = (event.currentTarget as HTMLInputElement).value.trim();
            setHex(text);
            if (text === '') onChange(undefined);
            else if (HEX.test(text)) onChange(text.toLowerCase());
          }}
        />
      </div>
      {ratio !== null && grade !== null && (
        <p class={`color-contrast ${grade}`} role="status">
          <span class="swatch-chip" style={{ background: effective }} />
          {t('features.color.contrast', { ratio: ratio.toFixed(1), grade: t(`features.color.${grade}`) })}
        </p>
      )}
    </fieldset>
  );
}
