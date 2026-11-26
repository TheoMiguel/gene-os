import type { ComponentType } from 'preact';
import type { AnalysisTab, SeqDocument } from '../../state/documents';
import { Panel as alignment } from './alignment';
import { Panel as cloning } from './cloning';
import { Panel as codons } from './codons';
import { Panel as digest } from './digest';
import { Panel as features } from './features';
import { Panel as libraries } from './libraries';
import { Panel as primers } from './primers';
import { Panel as proteins } from './proteins';
import { Panel as search } from './search';
import { Panel as sequence } from './sequence';
import { Panel as summary } from './summary';

export interface PanelProps {
  readonly doc: SeqDocument;
}

/**
 * The panel for each analysis tab. Each view owns one file in this folder, so views can be built
 * independently without any of them editing this registry.
 */
export const PANELS: Readonly<Record<AnalysisTab, ComponentType<PanelProps>>> = {
  summary,
  sequence,
  proteins,
  primers,
  digest,
  features,
  search,
  codons,
  alignment,
  cloning,
  libraries,
};
