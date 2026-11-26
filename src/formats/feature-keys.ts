import type { Feature, FeatureType } from '../engine/types';

/** The INSDC feature key written for each feature type when the feature has no `sourceKey`. */
const KEY_FOR_TYPE: Readonly<Record<FeatureType, string>> = {
  gene: 'gene',
  CDS: 'CDS',
  promoter: 'promoter',
  terminator: 'terminator',
  RBS: 'RBS',
  rep_origin: 'rep_origin',
  resistance: 'CDS',
  tag: 'misc_feature',
  primer_bind: 'primer_bind',
  protein_bind: 'protein_bind',
  enhancer: 'enhancer',
  polyA_signal: 'polyA_signal',
  regulatory: 'regulatory',
  misc_feature: 'misc_feature',
  custom: 'misc_feature',
};

/** INSDC keys that name a GENE_OS feature type. Every other key reads as `custom`. */
const TYPE_FOR_KEY: ReadonlyMap<string, FeatureType> = new Map<string, FeatureType>([
  ['gene', 'gene'],
  ['CDS', 'CDS'],
  ['promoter', 'promoter'],
  ['terminator', 'terminator'],
  ['RBS', 'RBS'],
  ['rep_origin', 'rep_origin'],
  ['primer_bind', 'primer_bind'],
  ['protein_bind', 'protein_bind'],
  ['enhancer', 'enhancer'],
  ['polyA_signal', 'polyA_signal'],
  ['regulatory', 'regulatory'],
  ['misc_feature', 'misc_feature'],
]);

/** Values of `/regulatory_class` (INSDC 2014+) that replace the old promoter, terminator, ... keys. */
const TYPE_FOR_REGULATORY_CLASS: ReadonlyMap<string, FeatureType> = new Map<string, FeatureType>([
  ['promoter', 'promoter'],
  ['terminator', 'terminator'],
  ['ribosome_binding_site', 'RBS'],
  ['enhancer', 'enhancer'],
  ['polyA_signal_sequence', 'polyA_signal'],
]);

/** Qualifiers that carry a feature's display name, most specific first. */
const NAME_QUALIFIERS = ['label', 'gene', 'product', 'locus_tag', 'standard_name', 'protein_id', 'note'];

type Qualifiers = Readonly<Record<string, readonly string[]>>;

/**
 * Maps an INSDC feature key to a feature type. `sourceKey` is set exactly when writing the type back would
 * give a different key, so `keyOf` restores the original key.
 */
export function typeForKey(
  key: string,
  qualifiers: Qualifiers,
): { readonly type: FeatureType; readonly sourceKey?: string } {
  const regulatoryClass = key === 'regulatory' ? qualifiers.regulatory_class?.[0] : undefined;
  const type =
    (regulatoryClass && TYPE_FOR_REGULATORY_CLASS.get(regulatoryClass)) || TYPE_FOR_KEY.get(key) || 'custom';
  return KEY_FOR_TYPE[type] === key ? { type } : { type, sourceKey: key };
}

/** The INSDC key to write for a feature. */
export function keyOf(feature: Pick<Feature, 'type' | 'sourceKey'>): string {
  return feature.sourceKey ?? KEY_FOR_TYPE[feature.type];
}

/** The display name a feature gets from its qualifiers, or its key when no qualifier names it. */
export function nameFromQualifiers(key: string, qualifiers: Qualifiers): string {
  for (const q of NAME_QUALIFIERS) {
    const value = qualifiers[q]?.[0];
    if (value) return value;
  }
  return key;
}

/**
 * The qualifiers to write for a feature: its own, plus a `/label` when they would not give back its name
 * (a feature the user created or renamed).
 */
export function qualifiersToWrite(feature: Feature): Qualifiers {
  const qualifiers = feature.qualifiers ?? {};
  if (nameFromQualifiers(keyOf(feature), qualifiers) === feature.name) return qualifiers;
  return { ...qualifiers, label: [feature.name] };
}
