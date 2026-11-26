import { PUC19 } from '../../../../tests/fixtures/restriction/fixtures';
import { findBindingSites } from '../../../engine/pcr';
import {
  bestBindings,
  bindingAlignment,
  bindingFeature,
  bindingPieces,
  exactBinding,
  splitAtOrigin,
} from './binding';

const M13F = { name: 'M13F(-47)', seq: 'CGCCAGGGTTTTCCCAGTCACGAC' };
const M13R = { name: 'M13R(-48)', seq: 'AGCGGATAACAATTTCACACAGGA' };
const sites = (primer: { name: string; seq: string }, maxMismatches = 3) =>
  findBindingSites({ id: primer.name, ...primer }, PUC19, 'circular', { maxMismatches });

describe('bindingAlignment', () => {
  it('lines a perfect forward binding up with the top strand', () => {
    const [site] = sites(M13F);
    if (!site) throw new Error('no site');
    const lines = bindingAlignment(M13F.seq, site, PUC19, 'circular');
    expect(lines.primer).toBe(M13F.seq);
    expect(lines.template).toBe(M13F.seq);
    expect(lines.marks).toBe('|'.repeat(M13F.seq.length));
    expect(lines.mismatches).toBe(0);
  });

  it('lines a reverse binding up with the bottom strand', () => {
    const [site] = sites(M13R);
    if (!site) throw new Error('no site');
    expect(site.strand).toBe(-1);
    const lines = bindingAlignment(M13R.seq, site, PUC19, 'circular');
    expect(lines.template).toBe(M13R.seq);
    expect(lines.mismatches).toBe(0);
  });

  it('marks a mismatch and reports the 5-prime tail that does not bind', () => {
    const tailed = { name: 'tailed', seq: `GGATCC${M13F.seq.slice(0, 10)}A${M13F.seq.slice(11)}` };
    const [site] = sites(tailed, 1);
    if (!site) throw new Error('no site');
    const lines = bindingAlignment(tailed.seq, site, PUC19, 'circular');
    expect(lines.mismatches).toBe(site.mismatches);
    expect(lines.mismatches).toBeGreaterThanOrEqual(1);
    expect(lines.marks).toContain(' ');
    expect(lines.marks.length + lines.tail).toBe(tailed.seq.length);
    expect(lines.tail).toBeGreaterThan(0);
  });
});

describe('pieces across the origin', () => {
  const wrapped = { primerId: 'p', strand: 1 as const, span: { start: 2680, end: 2700 }, mismatches: 0 };

  it('cuts a binding that ends past the sequence length at the origin', () => {
    expect(bindingPieces(wrapped, 2686)).toEqual([
      { start: 2680, end: 2686 },
      { start: 0, end: 14 },
    ]);
    expect(splitAtOrigin([wrapped], 2686).map((b) => b.span)).toEqual([
      { start: 2680, end: 2686 },
      { start: 0, end: 14 },
    ]);
  });

  it('leaves a binding inside the sequence whole', () => {
    expect(bindingPieces({ ...wrapped, span: { start: 10, end: 30 } }, 2686)).toEqual([
      { start: 10, end: 30 },
    ]);
  });
});

describe('bindingFeature', () => {
  it('makes a primer_bind feature of the annealed part, in the primer strand', () => {
    const [forward] = sites(M13F);
    const [reverse] = sites(M13R);
    if (!forward || !reverse) throw new Error('no site');
    const f = bindingFeature(M13F, forward, PUC19.length, 'circular');
    expect(f).toMatchObject({ type: 'primer_bind', name: M13F.name, origin: 'user' });
    expect(f.location).toEqual({ segments: [forward.span], strand: 1 });
    expect(bindingFeature(M13R, reverse, PUC19.length, 'circular').location.strand).toBe(-1);
  });

  it('splits a feature across the origin into two segments, 5-prime end first', () => {
    const wrapped = { primerId: 'p', strand: -1 as const, span: { start: 2680, end: 2700 }, mismatches: 0 };
    expect(bindingFeature(M13F, wrapped, 2686, 'circular').location.segments).toEqual([
      { start: 0, end: 14 },
      { start: 2680, end: 2686 },
    ]);
  });
});

describe('bestBindings and exactBinding', () => {
  it('keeps the bindings with the fewest mismatches', () => {
    const make = (mismatches: number) => ({
      primerId: 'p',
      strand: 1 as const,
      span: { start: 0, end: 20 },
      mismatches,
    });
    expect(bestBindings([make(2), make(0), make(1), make(0)]).map((b) => b.mismatches)).toEqual([0, 0]);
  });

  it('turns a designed span into a binding with no mismatches', () => {
    expect(exactBinding('f', 1, { start: 2680, end: 2700 }, 2686)).toEqual({
      primerId: 'f',
      strand: 1,
      span: { start: 2680, end: 2700 },
      mismatches: 0,
    });
    expect(exactBinding('f', -1, { start: 2690, end: 2710 }, 2686).span).toEqual({ start: 4, end: 24 });
  });
});
