import { sameCircle } from '../../../tests/fixtures/cloning/golden';
import { SCENARIOS } from '../../../tests/fixtures/cloning/scenarios';
import { reverseComplement } from '../alphabet';
import { designCloning } from './index';

describe('cloning constructs match the reference tools', () => {
  // Reference: Bio.Restriction digests joined by hand (restriction, Golden Gate), string surgery (the rest),
  // see scripts/oracle/cloning_goldens.py.
  for (const scenario of SCENARIOS) {
    it(scenario.label, () => {
      const result = designCloning(scenario.request);
      if (!result.ok) throw new Error(`design failed: ${JSON.stringify(result.problems)}`);
      const built = result.design.constructs;
      for (const [orientation, expected] of Object.entries(scenario.expected)) {
        const found = built.find((c) => c.orientation === orientation);
        if (expected === null) expect(found).toBeUndefined();
        else expect(found && sameCircle(found.record.seq, expected)).toBe(true);
      }
    });
  }
});

describe('homology primers carry the neighbour ends', () => {
  for (const scenario of SCENARIOS.filter((s) => s.homology)) {
    it(scenario.label, () => {
      const result = designCloning(scenario.request);
      if (!result.ok || !scenario.homology) throw new Error('design failed');
      const { overlap } = scenario.homology;
      const vectorEnd =
        scenario.request.method === 'gibson' || scenario.request.method === 'in_fusion'
          ? (result.design.fragments[0]?.product ?? '')
          : '';
      const first = result.design.primers[0];
      const last = result.design.primers[result.design.primers.length - 1];
      expect(first?.seq.startsWith(vectorEnd.slice(-overlap))).toBe(true);
      expect(last?.seq.startsWith(reverseComplement(vectorEnd.slice(0, overlap)))).toBe(true);
    });
  }
});
