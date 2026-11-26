import type { Feature, FeatureType } from '../../engine/types';
import type { OverlayKind } from '../../state/view';

/** Theme colors for chart series, in the order a chart assigns them. */
export const SERIES_COLORS = [
  'var(--accent)',
  'var(--cyan)',
  'var(--warn)',
  'var(--purple)',
  'var(--danger)',
] as const;

/** Default color of each sequence overlay kind. */
export const OVERLAY_COLORS: Readonly<Record<OverlayKind, string>> = {
  feature: 'var(--cyan)',
  restriction: 'var(--warn)',
  search: 'var(--accent)',
  primer: 'var(--purple)',
};

/** Fixed colors by feature type, readable on the dark, dusk and light themes. The plasmid map shares them. */
export const FEATURE_COLORS: Readonly<Record<FeatureType, string>> = {
  gene: '#5aa9e6',
  CDS: '#4cc3a4',
  promoter: '#e6b84f',
  terminator: '#e07a7a',
  RBS: '#c58ae6',
  rep_origin: '#9aa7b5',
  resistance: '#e69a4f',
  tag: '#7fd36a',
  primer_bind: '#a99dd6',
  protein_bind: '#d6a0b8',
  enhancer: '#d4d36a',
  polyA_signal: '#b08968',
  regulatory: '#6fb7c9',
  misc_feature: '#8ea8ba',
  custom: '#b4a9df',
};

/** The feature's own color, else the color of its type. */
export function featureColor(feature: Pick<Feature, 'type' | 'color'>): string {
  return feature.color ?? FEATURE_COLORS[feature.type];
}
