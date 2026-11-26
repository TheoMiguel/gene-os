import { PUC19, randomDna } from '../../tests/fixtures/restriction/fixtures';
import { reverseComplement } from './dna-internal';
import { findBindingSites, simulatePcr } from './pcr';
import type { Primer } from './types';

const M13_FORWARD: Primer = { id: 'm13f', name: 'M13 forward (-20)', seq: 'GTAAAACGACGGCCAGT' };
const M13_REVERSE: Primer = { id: 'm13r', name: 'M13 reverse', seq: 'CAGGAAACAGCTATGAC' };
// M13 forward reads like the pUC19 top strand at 378; M13 reverse's complement sits at 464..481.
const M13_PRODUCT = PUC19.slice(378, 481);

describe('findBindingSites', () => {
  it('finds exact sites on both strands with their spans', () => {
    expect(findBindingSites(M13_FORWARD, PUC19, 'circular')).toEqual([
      { primerId: 'm13f', strand: 1, span: { start: 378, end: 395 }, mismatches: 0 },
    ]);
    expect(findBindingSites(M13_REVERSE, PUC19, 'circular')).toEqual([
      { primerId: 'm13r', strand: -1, span: { start: 464, end: 481 }, mismatches: 0 },
    ]);
  });

  it('counts internal mismatches but rejects a mismatch at the 3′ end', () => {
    const internal = { ...M13_FORWARD, seq: 'GTAAATCGACGGCCAGT' };
    expect(findBindingSites(internal, PUC19, 'linear', { maxMismatches: 1 })).toMatchObject([
      { strand: 1, span: { start: 378, end: 395 }, mismatches: 1 },
    ]);
    // Without mismatches only the 11 bases 3' of the mismatch anneal, below the 15-base minimum.
    expect(findBindingSites(internal, PUC19, 'linear', { maxMismatches: 0 })).toEqual([]);
    const threePrime = { ...M13_FORWARD, seq: 'GTAAAACGACGGCCAGA' };
    expect(findBindingSites(threePrime, PUC19, 'linear', { maxMismatches: 3 })).toEqual([]);
  });

  it('treats a 5′ tail as non-binding', () => {
    const tailed = { ...M13_FORWARD, seq: `GCGAATTC${M13_FORWARD.seq}` };
    const [site] = findBindingSites(tailed, PUC19, 'linear', { maxMismatches: 0 });
    expect(site?.span).toEqual({ start: 378, end: 395 });
  });

  it('finds a site across the origin of a circular template', () => {
    const rotated = PUC19.slice(385) + PUC19.slice(0, 385);
    const [site] = findBindingSites(M13_FORWARD, rotated, 'circular');
    expect(site?.span).toEqual({ start: rotated.length - 7, end: rotated.length + 10 });
    expect(findBindingSites(M13_FORWARD, rotated, 'linear')).toEqual([]);
  });
});

describe('simulatePcr', () => {
  it('amplifies the region between the primers of a linear template', () => {
    const [product, ...others] = simulatePcr([M13_FORWARD, M13_REVERSE], PUC19, 'linear');
    expect(others).toEqual([]);
    expect(product?.seq).toBe(M13_PRODUCT);
    expect(product?.length).toBe(103);
    expect(product?.wrapsOrigin).toBe(false);
  });

  it('includes 5′ tails in the product', () => {
    const forward = { ...M13_FORWARD, seq: `GCGAATTC${M13_FORWARD.seq}` };
    const reverse = { ...M13_REVERSE, seq: `GCAAGCTT${M13_REVERSE.seq}` };
    const [product] = simulatePcr([forward, reverse], PUC19, 'linear');
    expect(product?.seq).toBe(`GCGAATTC${M13_PRODUCT}AAGCTTGC`);
    expect(product?.length).toBe(103 + 16);
  });

  it('amplifies across the origin of a circular plasmid only', () => {
    const rotated = PUC19.slice(430) + PUC19.slice(0, 430);
    const [product] = simulatePcr([M13_FORWARD, M13_REVERSE], rotated, 'circular');
    expect(product?.seq).toBe(M13_PRODUCT);
    expect(product?.wrapsOrigin).toBe(true);
    expect(simulatePcr([M13_FORWARD, M13_REVERSE], rotated, 'linear')).toEqual([]);
  });

  it('runs colony PCR on a plasmid that carries an insert', () => {
    const insert = randomDna(500, 7);
    // Clone the insert into the EcoRI site of the pUC19 multiple cloning site (G^AATTC at 396).
    const plasmid = `${PUC19.slice(0, 397)}${insert}${PUC19.slice(397)}`;
    const [product] = simulatePcr([M13_FORWARD, M13_REVERSE], plasmid, 'circular');
    expect(product?.length).toBe(103 + 500);
    expect(product?.seq).toContain(insert);
    expect(product?.seq.startsWith(M13_FORWARD.seq)).toBe(true);
    expect(product?.seq.endsWith(reverseComplement(M13_REVERSE.seq))).toBe(true);
  });

  it('reports products of a single primer that binds both ways and respects the size limit', () => {
    const site = 'ACGTTGCATGCCTAGGTAC';
    const template = `${randomDna(300, 1)}${site}${randomDna(200, 2)}${reverseComplement(site)}${randomDna(300, 3)}`;
    const primer: Primer = { id: 'p', name: 'p', seq: site };
    const [product] = simulatePcr([primer], template, 'linear');
    expect(product?.length).toBe(site.length * 2 + 200);
    expect(simulatePcr([primer], template, 'linear', { maxProductLength: 100 })).toEqual([]);
  });

  it('scans a 5 Mb template in linear time', () => {
    const template = randomDna(5_000_000, 99);
    const forward: Primer = { id: 'f', name: 'f', seq: template.slice(2_000_000, 2_000_020) };
    const reverse: Primer = {
      id: 'r',
      name: 'r',
      seq: reverseComplement(template.slice(2_000_800, 2_000_820)),
    };
    const started = performance.now();
    const products = simulatePcr([forward, reverse], template, 'circular');
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(products.some((p) => p.length === 820 && p.seq === template.slice(2_000_000, 2_000_820))).toBe(
      true,
    );
  }, 60_000);
});
