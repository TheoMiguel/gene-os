import { useRef } from 'preact/hooks';
import { type GuideTree, toNewick } from '../../../engine/align';
import { copyText, downloadText, ImageExportButtons, reportCopy, reportSave } from '../../export';
import { t } from '../../i18n';
import { layoutTree, uniqueNames } from './model';

/** The guide tree of a multiple alignment as a dendrogram, with its Newick text to copy or save. */
export function GuideTreeView(props: { readonly tree: GuideTree; readonly labels: readonly string[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const names = uniqueNames(props.labels);
  const longest = Math.max(...names.map((n) => n.length));
  const layout = layoutTree(props.tree, 280, longest);
  const newick = toNewick(props.tree, names);

  return (
    <section class="aln-section" aria-labelledby="aln-tree-title">
      <h3 id="aln-tree-title" class="field-label">
        {t('align.tree.title')}
      </h3>
      <p class="aln-hint">{t('align.tree.hint')}</p>
      <div class="aln-tree-box">
        <svg
          ref={svgRef}
          class="aln-tree"
          role="img"
          aria-label={t('align.tree.title')}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
        >
          {layout.paths.map((d) => (
            <path key={d} d={d} class="aln-tree-line" />
          ))}
          {layout.leaves.map((leaf) => (
            <text key={leaf.index} x={leaf.x + 6} y={leaf.y + 4} class="aln-tree-label">
              {names[leaf.index]}
            </text>
          ))}
        </svg>
      </div>
      <div class="aln-actions">
        <ImageExportButtons name="guide-tree" getSvg={() => svgRef.current} />
        <button type="button" class="export-button" onClick={async () => reportCopy(await copyText(newick))}>
          {t('align.tree.copyNewick')}
        </button>
        <button
          type="button"
          class="export-button"
          onClick={async () => reportSave(await downloadText(`${newick}\n`, 'guide-tree.nwk'))}
        >
          {t('align.tree.saveNewick')}
        </button>
      </div>
      <pre class="aln-newick">{newick}</pre>
    </section>
  );
}
