import { useMemo } from 'preact/hooks';
import { hydropathyProfile } from '../../../engine/protein';
import { copyText } from '../../export/clipboard';
import { reportCopy, reportSave } from '../../export/feedback';
import { downloadSequence } from '../../export/sequence';
import { t } from '../../i18n';
import { AminoAcidCompositionChart, HydropathyChart } from '../../viz';
import { ScrollRegion } from './controls';
import { externalLinks } from './externalLinks';
import { type ProteinProperties, proteinProperties, UNSTABLE_ABOVE } from './proteinProperties';
import { proteinRecord } from './proteinRecord';
import {
  classRuns,
  classShares,
  RESIDUE_CLASS_COLOR,
  RESIDUE_CLASSES,
  type ResidueClass,
} from './residueClasses';

/** Residues of the translation drawn on screen. Copy and export always carry the whole chain. */
export const PREVIEW_RESIDUES = 6000;

const LINK_LABELS = {
  blastp: 'proteins.link.blastp',
  uniprot: 'proteins.link.uniprot',
  alphafold: 'proteins.link.alphafold',
} as const;

const CLASS_LABELS = {
  hydrophobic: 'proteins.class.hydrophobic',
  polar: 'proteins.class.polar',
  basic: 'proteins.class.basic',
  acidic: 'proteins.class.acidic',
} as const satisfies Record<ResidueClass, string>;

const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const number = (value: number, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : '–');

/** Strip of the four residue classes as one bar. */
function ClassStrip({ protein }: { readonly protein: string }) {
  const shares = useMemo(() => classShares(protein), [protein]);
  return (
    <div class="pv-strip-block">
      <div class="field-label">{t('proteins.strip.title')}</div>
      <div
        class="pv-strip"
        role="img"
        aria-label={RESIDUE_CLASSES.map((cls) => `${t(CLASS_LABELS[cls])} ${percent(shares[cls])}`).join(
          ', ',
        )}
      >
        {RESIDUE_CLASSES.map((cls) => (
          <span
            key={cls}
            class="pv-strip-seg"
            style={{ width: `${shares[cls] * 100}%`, background: RESIDUE_CLASS_COLOR[cls] }}
          />
        ))}
      </div>
      <ul class="pv-legend">
        {RESIDUE_CLASSES.map((cls) => (
          <li key={cls}>
            <span class="pv-swatch" style={{ background: RESIDUE_CLASS_COLOR[cls] }} aria-hidden="true" />
            {t(CLASS_LABELS[cls])} {percent(shares[cls])}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The translation, one color per residue class. A long chain shows its first `PREVIEW_RESIDUES` residues. */
export function Translation({ protein }: { readonly protein: string }) {
  const runs = useMemo(() => classRuns(protein.slice(0, PREVIEW_RESIDUES)), [protein]);
  return (
    <>
      <ScrollRegion label={t('proteins.translation')}>
        {runs.map((run, index) => (
          <span key={index} style={{ color: run.cls ? RESIDUE_CLASS_COLOR[run.cls] : 'var(--fg-muted)' }}>
            {run.text}
          </span>
        ))}
      </ScrollRegion>
      {protein.length > PREVIEW_RESIDUES && (
        <p class="pv-note">
          {t('proteins.translation.truncated', {
            shown: PREVIEW_RESIDUES.toLocaleString(),
            total: protein.length.toLocaleString(),
          })}
        </p>
      )}
    </>
  );
}

function Kpi({
  title,
  value,
  sub,
}: {
  readonly title: string;
  readonly value: string;
  readonly sub?: string;
}) {
  return (
    <div class="bracket-box pv-kpi">
      <div class="bracket-inner" />
      <div class="pv-kpi-title">{title}</div>
      <div class="pv-kpi-value">{value}</div>
      {sub && <div class="pv-kpi-sub">{sub}</div>}
    </div>
  );
}

function Properties({ p }: { readonly p: ProteinProperties }) {
  const unstable = p.instability > UNSTABLE_ABOVE;
  return (
    <div class="pv-kpi-grid">
      <Kpi title={t('proteins.prop.length')} value={`${p.residues.toLocaleString()} aa`} />
      <Kpi
        title={t('proteins.prop.weight')}
        value={`${(p.weight / 1000).toFixed(2)} kDa`}
        sub={`${Math.round(p.weight).toLocaleString()} Da`}
      />
      <Kpi title={t('proteins.prop.pI')} value={number(p.pI)} />
      <Kpi
        title={t('proteins.prop.charge')}
        value={`${p.charge > 0 ? '+' : ''}${number(p.charge)}`}
        sub={t('proteins.prop.chargeAt')}
      />
      <Kpi
        title={t('proteins.prop.extinction')}
        value={`${p.extinction.reduced.toLocaleString()}`}
        sub={t('proteins.prop.extinctionCystine', { value: p.extinction.cystine.toLocaleString() })}
      />
      <Kpi
        title={t('proteins.prop.instability')}
        value={number(p.instability)}
        sub={unstable ? t('proteins.prop.unstable') : t('proteins.prop.stable')}
      />
      <Kpi title={t('proteins.prop.gravy')} value={number(p.gravy, 3)} />
      <Kpi title={t('proteins.prop.aromaticity')} value={percent(p.aromaticity)} />
    </div>
  );
}

/** Kyte-Doolittle hydropathy profile of `protein`, or a note when the chain is shorter than the window. */
export function HydropathyBlock({
  protein,
  window,
  exportName,
}: {
  readonly protein: string;
  readonly window: number;
  readonly exportName: string;
}) {
  const series = useMemo(() => hydropathyProfile(protein, window), [protein, window]);
  if (series.values.length === 0) return <p class="pv-note">{t('proteins.hydropathy.short', { window })}</p>;
  return (
    <HydropathyChart
      series={series}
      seqLength={protein.length}
      exportName={`${exportName}-hydropathy`}
      height={200}
    />
  );
}

interface ProteinInspectorProps {
  /** Heading: the ORF's id, or the record's name. */
  readonly title: string;
  /** What the heading refers to, e.g. its frame and coordinates. */
  readonly subtitle: string;
  readonly protein: string;
  /** Name that identifies the protein for a UniProt or AlphaFold search; absent for an ORF. */
  readonly searchName?: string;
  readonly exportName: string;
}

/**
 * The inspector of one chain: copy and FASTA export, the residue-class strip, the properties of spec 4.8, the
 * amino-acid composition and links out to outside tools.
 */
export function ProteinInspector({
  title,
  subtitle,
  protein,
  searchName,
  exportName,
}: ProteinInspectorProps) {
  const properties = useMemo(() => proteinProperties(protein), [protein]);
  const links = externalLinks(protein, searchName);
  const tooLong = links.some((link) => link.id === 'blastp' && !link.carriesSequence);

  const copy = async () => reportCopy(await copyText(protein));
  const save = async () =>
    reportSave(await downloadSequence(proteinRecord(title, subtitle, protein), 'fasta'));

  return (
    <div class="pv-inspector">
      <div class="pv-detail-head">
        <div>
          <h3 class="pv-detail-title">{title}</h3>
          <p class="pv-detail-sub">{subtitle}</p>
        </div>
        <div class="pv-actions">
          <button type="button" class="chip-btn" onClick={() => void copy()}>
            {t('proteins.copyPeptide')}
          </button>
          <button type="button" class="chip-btn" onClick={() => void save()}>
            {t('proteins.exportFasta')}
          </button>
        </div>
      </div>
      <ClassStrip protein={protein} />
      <Properties p={properties} />
      <AminoAcidCompositionChart
        counts={properties.composition}
        exportName={`${exportName}-composition`}
        height={200}
      />
      <div class="pv-links">
        <span class="field-label">{t('proteins.links.title')}</span>
        <div class="pv-link-row">
          {links.map((link) => (
            <a
              key={link.id}
              class="chip-btn pv-link"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(LINK_LABELS[link.id])}
            </a>
          ))}
        </div>
        <p class="pv-note">{tooLong ? t('proteins.links.tooLong') : t('proteins.links.privacy')}</p>
      </div>
    </div>
  );
}
