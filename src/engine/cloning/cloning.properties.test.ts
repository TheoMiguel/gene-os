import { SCENARIOS } from '../../../tests/fixtures/cloning/scenarios';
import { reverseComplement } from '../alphabet';
import { extractLocation } from '../location';
import { simulatePcr } from '../pcr';
import { digest, scanSites } from '../restriction';
import { findEnzyme } from './enzymes';
import { designCloning } from './index';
import type { CloningDesign } from './model';

function design(index: number): CloningDesign {
  const scenario = SCENARIOS[index];
  if (!scenario) throw new Error('no scenario');
  const result = designCloning(scenario.request);
  if (!result.ok) throw new Error(`design failed: ${JSON.stringify(result.problems)}`);
  return result.design;
}

function occurrences(circle: string, needle: string): number {
  const doubled = circle + circle.slice(0, needle.length - 1);
  let count = 0;
  for (
    let at = doubled.indexOf(needle);
    at !== -1 && at < circle.length;
    at = doubled.indexOf(needle, at + 1)
  )
    count++;
  return count;
}

describe.each(SCENARIOS.map((s, i) => [s.label, i] as const))('every method: %s', (_label, index) => {
  const scenario = SCENARIOS[index];
  const built = design(index);

  it('contains each insert exactly once, in either orientation of the insert', () => {
    for (const construct of built.constructs) {
      for (const insert of scenario?.insertSeqs ?? []) {
        const hits =
          occurrences(construct.record.seq, insert) +
          occurrences(construct.record.seq, reverseComplement(insert));
        expect(hits).toBe(1);
      }
    }
  });

  it('keeps every feature inside the construct, and every whole feature reads like its source', () => {
    for (const construct of built.constructs) {
      const { seq, features } = construct.record;
      for (const feature of features) {
        for (const s of feature.location.segments) {
          expect(s.start).toBeGreaterThanOrEqual(0);
          expect(s.end).toBeLessThanOrEqual(seq.length);
          expect(s.end).toBeGreaterThan(s.start);
        }
        const [prefix, ...rest] = feature.id.split(':');
        const source = scenario?.sources.get(prefix ?? '');
        const original = source?.features.find((f) => f.id === rest.join(':').replace(/~\d+$/, ''));
        const partial = feature.location.segments.some((s) => s.partialStart || s.partialEnd);
        if (!source || !original || partial) continue;
        expect(extractLocation(seq, feature.location)).toBe(extractLocation(source.seq, original.location));
      }
    }
  });

  it('marks one junction feature per junction', () => {
    for (const construct of built.constructs) {
      expect(construct.junctions.length).toBeGreaterThanOrEqual(2);
      const marked = construct.record.features.filter((f) => f.id.startsWith('junction:'));
      expect(marked).toHaveLength(construct.junctions.length);
    }
  });

  it('marks the annealing part of every primer, and it reads as the primer', () => {
    const construct = built.constructs[0];
    if (!construct) throw new Error('no construct');
    for (const primer of built.primers) {
      const feature = construct.record.features.find(
        (f) => f.type === 'primer_bind' && f.name === primer.name,
      );
      expect(feature).toBeDefined();
      if (!feature) continue;
      const annealing = primer.seq.slice(primer.tailLength);
      expect(extractLocation(construct.record.seq, feature.location)).toBe(annealing);
    }
  });

  it('round trip: the engine PCR on the template gives the fragment the strategy expects', () => {
    for (const fragment of built.fragments.filter((f) => f.kind === 'pcr')) {
      const template = [...(scenario?.sources.values() ?? [])].find((r) => r.id === fragment.templateId);
      if (!template) throw new Error(`no template ${fragment.templateId}`);
      const primers = built.primers.filter((p) => fragment.primerIds.includes(p.id));
      const products = simulatePcr(primers, template.seq, template.topology, {
        maxProductLength: 200_000,
      }).map((a) => a.seq);
      expect(products.some((p) => p === fragment.product || p === reverseComplement(fragment.product))).toBe(
        true,
      );
    }
  });
});

describe('length rules', () => {
  it('Gibson and In-Fusion: sum of the fragments minus the overlaps', () => {
    SCENARIOS.forEach((scenario, index) => {
      if (!scenario.homology) return;
      const built = design(index);
      const total = built.fragments.reduce((sum, f) => sum + f.product.length, 0);
      const junctions = built.fragments.length;
      expect(built.constructs[0]?.record.seq.length).toBe(total - junctions * scenario.homology.overlap);
    });
  });

  it('restriction and ligation: backbone plus insert fragment', () => {
    SCENARIOS.forEach((scenario, index) => {
      if (!scenario.restriction) return;
      for (const construct of design(index).constructs) {
        expect(construct.record.seq.length).toBe(
          scenario.restriction.backboneLength + scenario.restriction.insertLength,
        );
      }
    });
  });

  it('Golden Gate with scars: vector and parts plus one overhang per junction', () => {
    SCENARIOS.forEach((scenario, index) => {
      if (!scenario.goldenGate?.scar || scenario.request.method !== 'golden_gate') return;
      const parts = scenario.request.parts.reduce((sum, p) => sum + p.record.seq.length, 0);
      const { overhangLength, vectorLength } = scenario.goldenGate;
      const built = design(index);
      const vectorCore =
        scenario.request.vectorMode === 'pcr' ? vectorLength : (built.constructs[0]?.record.seq.length ?? 0);
      if (scenario.request.vectorMode === 'pcr') {
        expect(built.constructs[0]?.record.seq.length).toBe(
          vectorCore + parts + (scenario.request.parts.length + 1) * overhangLength,
        );
      }
    });
  });
});

describe('re-digesting a restriction and ligation product', () => {
  it('returns the vector backbone and the insert fragment with the same enzymes', () => {
    SCENARIOS.forEach((scenario, index) => {
      if (!scenario.restriction) return;
      const enzymes = scenario.restriction.enzymes.map((name) => {
        const found = findEnzyme(name);
        if (!found) throw new Error(name);
        return found;
      });
      for (const construct of design(index).constructs) {
        const { seq } = construct.record;
        const fragments = digest(seq, 'circular', scanSites(seq, 'circular', enzymes).sites);
        expect(fragments.map((f) => f.length).sort((a, b) => a - b)).toEqual(
          [scenario.restriction.insertLength, scenario.restriction.backboneLength].sort((a, b) => a - b),
        );
      }
    });
  });
});
