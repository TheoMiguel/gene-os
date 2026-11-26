import { t } from '../i18n';
import { reportSave } from './feedback';
import { downloadPng, downloadSvg } from './svg';

interface ImageExportButtonsProps {
  /** File name without extension. */
  readonly name: string;
  /** Returns the rendered `<svg>` to save, read when a button is clicked. */
  readonly getSvg: () => SVGSVGElement | null;
}

/** "Save SVG" and "Save PNG" buttons for any rendered `<svg>`: a chart, the plasmid map, the gel. */
export function ImageExportButtons({ name, getSvg }: ImageExportButtonsProps) {
  const save = async (kind: 'svg' | 'png') => {
    const svg = getSvg();
    if (!svg) return;
    reportSave(await (kind === 'svg' ? downloadSvg(svg, name) : downloadPng(svg, name)));
  };
  return (
    <span class="export-buttons">
      <button type="button" class="export-button" onClick={() => void save('svg')}>
        {t('export.svg')}
      </button>
      <button type="button" class="export-button" onClick={() => void save('png')}>
        {t('export.png')}
      </button>
    </span>
  );
}
