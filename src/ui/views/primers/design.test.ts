import { PUC19 } from '../../../../tests/fixtures/restriction/fixtures';
import { reverseComplement } from '../../../engine/alphabet';
import { simulatePcr } from '../../../engine/pcr';
import { designPrimers } from '../../../engine/primers';
import { designForRegion, explainPair } from './design';

describe('designForRegion', () => {
  it('gives the same pairs as designPrimers on a linear template', () => {
    const target = { start: 1000, end: 1400 };
    const direct = designPrimers(PUC19, target);
    const wrapped = designForRegion(PUC19, 'linear', target);
    expect(wrapped.map((p) => [p.forward.seq, p.reverse.seq])).toEqual(
      direct.map((p) => [p.forward.seq, p.reverse.seq]),
    );
    expect(wrapped.map((p) => p.forward.span)).toEqual(direct.map((p) => p.forward.span));
  });

  it('puts every primer where it reads on the template, on a circular sequence', () => {
    const pairs = designForRegion(PUC19, 'circular', { start: 1000, end: 1400 });
    expect(pairs.length).toBeGreaterThan(0);
    for (const { forward, reverse } of pairs) {
      expect(PUC19.slice(forward.span.start, forward.span.end)).toBe(forward.seq);
      expect(reverseComplement(PUC19.slice(reverse.span.start, reverse.span.end))).toBe(reverse.seq);
    }
  });

  it('designs across the origin and the pair amplifies a product that wraps (virtual PCR as the check)', () => {
    const target = { start: PUC19.length - 100, end: 100 };
    const pairs = designForRegion(PUC19, 'circular', target, { productSize: { min: 200, max: 700 } });
    expect(pairs.length).toBeGreaterThan(0);
    const best = pairs[0];
    if (!best) throw new Error('no pair');
    const product = simulatePcr(
      [
        { id: 'f', name: 'f', seq: best.forward.seq },
        { id: 'r', name: 'r', seq: best.reverse.seq },
      ],
      PUC19,
      'circular',
    ).find((a) => a.length === best.productSize);
    expect(product).toBeDefined();
    expect(product?.wrapsOrigin).toBe(true);
    const wrapped = (span: { start: number; end: number }) => (PUC19 + PUC19).slice(span.start, span.end);
    expect(wrapped(best.forward.span)).toBe(best.forward.seq);
  });

  it('returns nothing for an empty or out-of-range target', () => {
    expect(designForRegion(PUC19, 'linear', { start: 500, end: 500 })).toEqual([]);
    expect(designForRegion(PUC19, 'linear', { start: 100, end: PUC19.length + 5 })).toEqual([]);
    expect(designForRegion(PUC19, 'linear', { start: 500, end: 100 })).toEqual([]);
  });
});

describe('explainPair', () => {
  it('adds up to the penalty the engine ranks by', () => {
    for (const pair of designPrimers(PUC19, { start: 1000, end: 1400 })) {
      const why = explainPair(pair);
      expect(why.total).toBeCloseTo(pair.penalty, 9);
      expect(why.forward.total + why.reverse.total + why.deltaTm + why.crossDimer).toBeCloseTo(
        pair.penalty,
        9,
      );
    }
  });

  it('follows the constraints the pair was designed with', () => {
    const constraints = { tm: { min: 55, opt: 58, max: 61 }, length: { min: 18, opt: 22, max: 26 } };
    for (const pair of designPrimers(PUC19, { start: 1000, end: 1400 }, constraints))
      expect(explainPair(pair, constraints).total).toBeCloseTo(pair.penalty, 9);
  });
});
