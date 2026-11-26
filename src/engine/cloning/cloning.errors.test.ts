import {
  EGFP,
  makeRecord,
  PUC19_RECORD,
  randomDna,
  templateWith,
} from '../../../tests/fixtures/cloning/records';
import { reverseComplement } from '../alphabet';
import { ATT_SITES, checkOverhangs, designCloning, designOverhangs } from './index';
import type { CloningProblem, CloningResult, CloningWarning } from './model';

const vector = { id: 'pUC19', record: PUC19_RECORD };
const egfp = {
  id: 'egfp',
  record: templateWith('egfpT', EGFP, 'EGFP', 11),
  region: { start: 120, length: EGFP.length },
};

function problemsOf(result: CloningResult): CloningProblem[] {
  if (result.ok) throw new Error('expected a problem, got a design');
  return [...result.problems];
}

function warningsOf(result: CloningResult): CloningWarning[] {
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return [...result.design.warnings];
}

const codes = (list: readonly { code: string }[]) => list.map((x) => x.code);

describe('restriction and ligation problems come back as results', () => {
  it('ends that cannot anneal', () => {
    // The vector is cut with EcoRI and HindIII; the insert only has EcoRI sites, so its right end cannot meet HindIII.
    const insert = {
      id: 'insert',
      record: makeRecord(
        'insert',
        `GTAGTAGAATTC${randomDna(300, 3).replaceAll('AAGCTT', 'AAGCTA')}GAATTCGTAGTA`,
        'linear',
      ),
    };
    const result = designCloning({
      method: 'restriction',
      vector,
      insert,
      enzymes: ['EcoRI', 'HindIII'],
      insertMode: 'digest',
    });
    const [problem] = problemsOf(result);
    expect(problem?.code).toBe('incompatible_ends');
    if (problem?.code === 'incompatible_ends') {
      expect(problem.left.type).toBeDefined();
      expect(problem.left.source).not.toBe('');
    }
  });

  it('an enzyme that cuts inside the insert (amplify mode)', () => {
    const core = `${randomDna(200, 1)}GAATTC${randomDna(200, 2)}`;
    const insert = {
      id: 'insert',
      record: makeRecord('insert', core, 'linear'),
      region: { start: 0, length: core.length },
    };
    const [problem] = problemsOf(
      designCloning({ method: 'restriction', vector, insert, enzymes: ['EcoRI', 'BamHI'] }),
    );
    expect(problem).toMatchObject({ code: 'enzyme_cuts_insert', enzyme: 'EcoRI', cuts: 1 });
  });

  it('an enzyme that cuts inside the insert (digest mode)', () => {
    const seq = `GTAGTAGAATTC${randomDna(200, 1)}GGATCC${randomDna(100, 2)}GGATCCGTAGTA`;
    const insert = {
      id: 'insert',
      record: makeRecord('insert', seq, 'linear'),
      region: { start: 12, length: seq.length - 24 },
    };
    const [problem] = problemsOf(
      designCloning({
        method: 'restriction',
        vector,
        insert,
        enzymes: ['EcoRI', 'BamHI'],
        insertMode: 'digest',
      }),
    );
    expect(problem?.code).toBe('enzyme_cuts_insert');
  });

  it('an enzyme with no site, a repeated cutter, an unknown name and a Type IIS enzyme', () => {
    const base = { method: 'restriction', vector, insert: egfp } as const;
    expect(problemsOf(designCloning({ ...base, enzymes: ['NotI'] }))[0]).toMatchObject({
      code: 'enzyme_no_site',
      enzyme: 'NotI',
    });
    expect(problemsOf(designCloning({ ...base, enzymes: ['NoSuchI'] }))[0]).toMatchObject({
      code: 'enzyme_unknown',
    });
    expect(problemsOf(designCloning({ ...base, enzymes: ['BsaI'] }))[0]).toMatchObject({
      code: 'enzyme_not_suitable',
      reason: 'type_iis',
    });
    expect(problemsOf(designCloning({ ...base, enzymes: ['AciI'] }))[0]?.code).toBe(
      'enzyme_cuts_vector_repeatedly',
    );
  });

  it('a region outside the insert record', () => {
    const insert = { ...egfp, region: { start: 0, length: 99_999 } };
    expect(
      problemsOf(designCloning({ method: 'restriction', vector, insert, enzymes: ['EcoRI', 'BamHI'] }))[0],
    ).toEqual({
      code: 'region_out_of_range',
      part: 'egfp',
    });
  });

  it('picks an enzyme pair itself when none is given, and the pair works', () => {
    const result = designCloning({ method: 'restriction', vector, insert: egfp });
    expect(result.ok).toBe(true);
  });
});

describe('restriction and ligation warnings', () => {
  const warn = (enzymes: string[], extra = {}, insertSeq?: string) => {
    const seq =
      insertSeq ??
      `GTAGTA${enzymes[0] === 'HindIII' ? 'AAGCTT' : 'CCCGGG'}${randomDna(200, 4)}${enzymes[0] === 'HindIII' ? 'AAGCTT' : 'CCCGGG'}GTAGTA`;
    const insert = { id: 'insert', record: makeRecord('insert', seq, 'linear') };
    return warningsOf(
      designCloning({ method: 'restriction', vector, insert, enzymes, insertMode: 'digest', ...extra }),
    );
  };

  it('a single enzyme leaves self-ligating vector ends and two orientations', () => {
    const found = warn(['HindIII']);
    expect(found).toContainEqual({ code: 'vector_self_ligation', dephosphorylate: false });
    expect(codes(found)).toContain('both_orientations_possible');
    expect(warn(['HindIII'], { dephosphorylateVector: true })).toContainEqual({
      code: 'vector_self_ligation',
      dephosphorylate: true,
    });
  });

  it('blunt ligation has no orientation control', () => {
    expect(warn(['SmaI'])).toContainEqual({ code: 'blunt_ligation', orientationUnknown: true });
  });

  it('a dephosphorylated vector with a PCR insert is nicked, not covalently closed', () => {
    const result = designCloning({
      method: 'restriction',
      vector,
      insert: egfp,
      enzymes: ['EcoRI', 'BamHI'],
      dephosphorylateVector: true,
    });
    expect(warningsOf(result)).toContainEqual({ code: 'dephosphorylated_vector_unphosphorylated_insert' });
  });

  it('two fragments of a similar size cannot be separated on a gel', () => {
    const half = makeRecord('half', randomDna(1200, 8), 'circular');
    const sites = `${half.seq.slice(0, 600)}GAATTC${half.seq.slice(600, 1199)}GGATCC${half.seq.slice(1199)}`;
    const twin = { id: 'twin', record: makeRecord('twin', sites, 'circular') };
    const insert = {
      id: 'insert',
      record: makeRecord('insert', `GTAGTAGAATTC${randomDna(100, 5)}GGATCCGTAGTA`, 'linear'),
    };
    const found = warningsOf(
      designCloning({
        method: 'restriction',
        vector: twin,
        insert,
        enzymes: ['EcoRI', 'BamHI'],
        insertMode: 'digest',
      }),
    );
    expect(codes(found)).toContain('vector_stub_comigrates');
  });
});

describe('Golden Gate overhang checks', () => {
  const base = {
    method: 'golden_gate',
    enzyme: 'BsaI',
    vector: { id: 'v', record: makeRecord('v', randomDna(800, 21), 'circular') },
    vectorMode: 'pcr',
    parts: [
      { id: 'a', record: makeRecord('a', randomDna(300, 22), 'linear') },
      { id: 'b', record: makeRecord('b', randomDna(300, 23), 'linear') },
    ],
  } as const;

  it('duplicate overhangs, also as a reverse complement', () => {
    const same = problemsOf(designCloning({ ...base, overhangs: ['AATG', 'GCTT', 'AATG'] }));
    expect(same).toContainEqual({ code: 'duplicate_overhang', overhang: 'AATG', junctions: [0, 2] });
    const reverse = problemsOf(designCloning({ ...base, overhangs: ['AATG', 'CATT', 'GCTT'] }));
    expect(codes(reverse)).toContain('duplicate_overhang');
  });

  it('a palindromic overhang cannot tell its orientation', () => {
    const found = problemsOf(designCloning({ ...base, overhangs: ['AATG', 'AGCT', 'GCTT'] }));
    expect(found).toContainEqual({ code: 'palindromic_overhang', overhang: 'AGCT', junction: 1 });
  });

  it('an overhang of the wrong length', () => {
    expect(problemsOf(designCloning({ ...base, overhangs: ['AATG', 'GCT', 'CGAC'] }))[0]).toMatchObject({
      code: 'overhang_invalid',
      junction: 1,
    });
  });

  it('a part with an internal site of the enzyme is a warning, not a failure', () => {
    const cut = {
      id: 'c',
      record: makeRecord('c', `${randomDna(150, 31)}GGTCTC${randomDna(150, 32)}`, 'linear'),
    };
    const result = designCloning({
      ...base,
      parts: [cut, base.parts[1]],
      overhangs: ['AATG', 'GCTT', 'CGAC'],
    });
    expect(warningsOf(result)).toContainEqual({ code: 'internal_site', enzyme: 'BsaI', part: 'c', cuts: 1 });
  });

  it('rejects an enzyme outside the supported Type IIS set', () => {
    expect(problemsOf(designCloning({ ...base, enzyme: 'EcoRI' }))[0]).toMatchObject({
      code: 'enzyme_unknown',
    });
  });

  it('designed overhangs are unique, non-palindromic and pairwise distinct', () => {
    const designed = designOverhangs(12, 4);
    expect(designed).toHaveLength(12);
    expect(checkOverhangs(designed, 4)).toEqual([]);
    for (const [i, a] of designed.entries()) {
      expect(a).not.toBe(reverseComplement(a));
      for (const b of designed.slice(i + 1)) {
        expect(b).not.toBe(a);
        expect(b).not.toBe(reverseComplement(a));
      }
    }
  });

  it('designs its own overhangs when none are given, and the construct closes', () => {
    const result = designCloning({ ...base });
    expect(result.ok).toBe(true);
  });

  it('SapI makes 3 bp overhangs', () => {
    const result = designCloning({ ...base, enzyme: 'SapI' });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.design.constructs[0]?.junctions.every((j) => j.length === 3)).toBe(true);
  });
});

describe('Gateway problems', () => {
  const att = (variant: number) => ATT_SITES.get(variant)?.attB ?? '';

  it('a vector without att sites', () => {
    const plain = { id: 'plain', record: makeRecord('plain', randomDna(1000, 41), 'circular') };
    const insert = {
      part: { id: 'g', record: makeRecord('g', randomDna(300, 42), 'linear') },
      attB: { left: 1, right: 2 },
    };
    expect(
      problemsOf(designCloning({ method: 'gateway', reaction: 'BP', vector: plain, inserts: [insert] }))[0],
    ).toMatchObject({ code: 'att_site_not_found', part: 'plain', count: 0 });
  });

  it('an unknown att variant', () => {
    const donor = { id: 'd', record: makeRecord('d', randomDna(200, 43), 'circular') };
    const insert = {
      part: { id: 'g', record: makeRecord('g', randomDna(300, 44), 'linear') },
      attB: { left: 9, right: 2 },
    };
    const found = problemsOf(
      designCloning({ method: 'gateway', reaction: 'BP', vector: donor, inserts: [insert] }),
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it('inserts whose sites do not chain to the vector sites', () => {
    const arm = (n: number) => randomDna(30, n);
    const ccdb = makeRecord('x', '', 'circular');
    const vectorSeq = `${randomDna(500, 50)}${arm(1)}${att(1).slice(9, 18)}${arm(2)}${randomDna(100, 51)}${arm(3)}${reverseComplement(att(2).slice(9, 18))}${arm(4)}${randomDna(500, 52)}`;
    const donor = {
      id: 'd',
      record: makeRecord('d', vectorSeq, 'circular', [
        {
          id: 'c',
          type: 'CDS',
          name: 'ccdB',
          location: { segments: [{ start: 560, end: 700 }], strand: 1 },
          origin: 'user',
        },
      ]),
    };
    void ccdb;
    const insert = {
      part: { id: 'g', record: makeRecord('g', randomDna(300, 53), 'linear') },
      attB: { left: 3, right: 4 },
    };
    expect(
      problemsOf(designCloning({ method: 'gateway', reaction: 'BP', vector: donor, inserts: [insert] }))[0],
    ).toMatchObject({ code: 'att_no_route' });
  });
});

describe('TOPO problems and warnings', () => {
  const insertRecord = makeRecord('product', `CACC${EGFP}`, 'linear');

  it('directional TOPO needs CACC at the 5 prime end of a finished product', () => {
    const noCacc = { id: 'product', record: makeRecord('product', EGFP, 'linear') };
    expect(
      problemsOf(
        designCloning({
          method: 'topo',
          vector,
          site: 400,
          insert: noCacc,
          directional: true,
          amplify: false,
        }),
      )[0],
    ).toEqual({ code: 'topo_missing_cacc', part: 'product' });
    const ok = designCloning({
      method: 'topo',
      vector,
      site: 400,
      insert: { id: 'product', record: insertRecord },
      directional: true,
      amplify: false,
    });
    expect(ok.ok).toBe(true);
  });

  it('adds CACC to the forward primer when the product is made by PCR', () => {
    const result = designCloning({ method: 'topo', vector, site: 400, insert: egfp, directional: true });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    expect(result.design.primers[0]?.seq.startsWith('CACC')).toBe(true);
  });

  it('warns about a Taq product for directional TOPO and a proofreading product for TA', () => {
    expect(
      codes(
        warningsOf(
          designCloning({
            method: 'topo',
            vector,
            site: 400,
            insert: egfp,
            directional: true,
            polymerase: 'taq',
          }),
        ),
      ),
    ).toContain('topo_directional_needs_blunt');
    expect(
      codes(
        warningsOf(
          designCloning({
            method: 'topo',
            vector,
            site: 400,
            insert: egfp,
            directional: false,
            polymerase: 'proofreading',
          }),
        ),
      ),
    ).toContain('topo_a_overhang_lost');
  });

  it('a site that does not follow a T, and a site outside the vector', () => {
    const noT = PUC19_RECORD.seq[399] === 'T' ? 401 : 400;
    expect(
      codes(
        warningsOf(designCloning({ method: 'topo', vector, site: noT, insert: egfp, directional: false })),
      ),
    ).toContain('topo_site_without_t');
    expect(
      problemsOf(
        designCloning({ method: 'topo', vector, site: 99_999, insert: egfp, directional: false }),
      )[0],
    ).toEqual({ code: 'topo_site_out_of_range' });
  });
});

describe('Gibson and In-Fusion problems', () => {
  it('an overlap outside the allowed range', () => {
    const request = {
      method: 'gibson',
      vector,
      opening: { enzymes: ['EcoRI', 'BamHI'] },
      inserts: [egfp],
    } as const;
    expect(problemsOf(designCloning({ ...request, overlap: 5 }))[0]).toMatchObject({
      code: 'overlap_out_of_range',
      value: 5,
    });
    expect(problemsOf(designCloning({ ...request, method: 'in_fusion', overlap: 60 }))[0]).toMatchObject({
      code: 'overlap_out_of_range',
      max: 40,
    });
  });

  it('no inserts', () => {
    expect(
      problemsOf(designCloning({ method: 'gibson', vector, opening: { enzymes: ['EcoRI'] }, inserts: [] })),
    ).toEqual([{ code: 'no_parts' }]);
  });

  it('warns about a 3 prime overhang vector end', () => {
    const found = warningsOf(
      designCloning({ method: 'in_fusion', vector, opening: { enzymes: ['KpnI'] }, inserts: [egfp] }),
    );
    expect(codes(found)).toContain('three_prime_overhang_end');
  });

  it('warns about extreme overlap GC', () => {
    const polyA = makeRecord('at', `${'AT'.repeat(60)}${EGFP}`, 'linear');
    const found = warningsOf(
      designCloning({
        method: 'gibson',
        vector,
        opening: { remove: { start: 100, length: 0 } },
        inserts: [{ id: 'at', record: polyA, region: { start: 0, length: polyA.seq.length } }],
        overlap: 30,
      }),
    );
    expect(found.some((w) => w.code === 'overlap_repeat' || w.code === 'overlap_gc_extreme')).toBe(true);
  });
});

describe('LIC problems', () => {
  it('a vector with no stop nucleotide cannot be chewed back', () => {
    const polyA = { id: 'polyA', record: makeRecord('polyA', 'A'.repeat(600), 'circular') };
    expect(
      problemsOf(
        designCloning({
          method: 'lic',
          vector: polyA,
          opening: { remove: { start: 0, length: 0 } },
          insert: egfp,
        }),
      )[0],
    ).toMatchObject({ code: 'lic_no_stop_nucleotide' });
  });
});
