import type { CloningProblem, CloningWarning, EndDescription } from '../../../engine/cloning';
import { LANGUAGES, updateSettings } from '../../../state/settings';
import { problemText, requestErrorText, warningText } from './messages';

const sticky: EndDescription = { type: 'five_prime', overhang: 'AATT', source: 'EcoRI' };
const blunt: EndDescription = { type: 'blunt', overhang: '', source: 'pcr' };

/** One example of every problem code, so a new engine code without a sentence fails to compile. */
const PROBLEMS: { [C in CloningProblem['code']]: readonly Extract<CloningProblem, { code: C }>[] } = {
  no_parts: [{ code: 'no_parts' }],
  region_out_of_range: [{ code: 'region_out_of_range', part: 'p' }],
  enzyme_unknown: [{ code: 'enzyme_unknown', enzyme: 'Xyz' }],
  enzyme_not_suitable: (['type_iis', 'degenerate_site', 'not_type_iis'] as const).map((reason) => ({
    code: 'enzyme_not_suitable' as const,
    enzyme: 'BsaI',
    reason,
  })),
  enzyme_no_site: [{ code: 'enzyme_no_site', enzyme: 'EcoRI', part: 'p' }],
  enzyme_cuts_insert: [{ code: 'enzyme_cuts_insert', enzyme: 'EcoRI', part: 'p', cuts: 2 }],
  enzyme_cuts_vector_repeatedly: [{ code: 'enzyme_cuts_vector_repeatedly', enzyme: 'EcoRI', cuts: 3 }],
  no_enzyme_pair: [{ code: 'no_enzyme_pair' }],
  incompatible_ends: [{ code: 'incompatible_ends', junction: 'EcoRI/BamHI', left: sticky, right: blunt }],
  duplicate_overhang: [{ code: 'duplicate_overhang', overhang: 'AATG', junctions: [0, 2] }],
  palindromic_overhang: [{ code: 'palindromic_overhang', overhang: 'GATC', junction: 1 }],
  overhang_invalid: [{ code: 'overhang_invalid', junction: 0, overhang: 'AA' }],
  primer_design_failed: [
    { code: 'primer_design_failed', part: 'p', end: 'forward' },
    { code: 'primer_design_failed', part: 'p', end: 'reverse' },
  ],
  overlap_out_of_range: [{ code: 'overlap_out_of_range', min: 15, max: 80, value: 5 }],
  topo_missing_cacc: [{ code: 'topo_missing_cacc', part: 'p' }],
  topo_site_out_of_range: [{ code: 'topo_site_out_of_range' }],
  att_site_unknown: [{ code: 'att_site_unknown', variant: 9 }],
  att_site_not_found: [{ code: 'att_site_not_found', part: 'v', count: 1 }],
  att_no_route: (['no_chain', 'ambiguous_chain', 'unused_parts'] as const).map((detail) => ({
    code: 'att_no_route' as const,
    detail,
  })),
  lic_overhang_mismatch: [{ code: 'lic_overhang_mismatch', junction: 'j', expected: 'AAAA', actual: 'TTTT' }],
  lic_no_stop_nucleotide: [{ code: 'lic_no_stop_nucleotide', part: 'p' }],
  junction_mismatch: [{ code: 'junction_mismatch', junction: 'j' }],
};

const WARNINGS: { [C in CloningWarning['code']]: readonly Extract<CloningWarning, { code: C }>[] } = {
  vector_self_ligation: [
    { code: 'vector_self_ligation', dephosphorylate: true },
    { code: 'vector_self_ligation', dephosphorylate: false },
  ],
  blunt_ligation: [{ code: 'blunt_ligation', orientationUnknown: true }],
  dephosphorylated_vector_unphosphorylated_insert: [
    { code: 'dephosphorylated_vector_unphosphorylated_insert' },
  ],
  vector_stub_comigrates: [{ code: 'vector_stub_comigrates', stubLength: 2000, backboneLength: 2100 }],
  both_orientations_possible: [{ code: 'both_orientations_possible' }],
  internal_site: [{ code: 'internal_site', enzyme: 'EcoRI', part: 'p', cuts: 1 }],
  three_prime_overhang_end: [{ code: 'three_prime_overhang_end', part: 'p', enzyme: 'KpnI' }],
  primer_tm_low: [{ code: 'primer_tm_low', primer: 'p-F', tm: 51.234 }],
  primer_long: [{ code: 'primer_long', primer: 'p-F', length: 70 }],
  overlap_gc_extreme: [{ code: 'overlap_gc_extreme', junction: 'j', gc: 71.4 }],
  overlap_repeat: [{ code: 'overlap_repeat', junction: 'j' }],
  topo_site_without_t: [{ code: 'topo_site_without_t' }],
  topo_directional_needs_blunt: [{ code: 'topo_directional_needs_blunt' }],
  topo_a_overhang_lost: [{ code: 'topo_a_overhang_lost' }],
  no_counterselection: [{ code: 'no_counterselection', part: 'v' }],
  counterselection_kept: [{ code: 'counterselection_kept', part: 'v' }],
  insert_arc_guessed: [{ code: 'insert_arc_guessed', part: 'p' }],
  lic_overhang_short: [{ code: 'lic_overhang_short', junction: 'j', length: 8 }],
};

describe.each(LANGUAGES)('cloning messages in %s', (language) => {
  beforeEach(() => updateSettings({ language }));

  it('writes a finished sentence for every problem the engine can report', () => {
    for (const problem of Object.values(PROBLEMS).flat()) {
      const text = problemText(problem);
      expect(text, problem.code).toMatch(/[.]$/);
      expect(text, problem.code).not.toMatch(/[{}]|undefined|NaN/);
    }
  });

  it('writes a finished sentence for every warning the engine can report', () => {
    for (const warning of Object.values(WARNINGS).flat()) {
      const text = warningText(warning);
      expect(text, warning.code).toMatch(/[.]$/);
      expect(text, warning.code).not.toMatch(/[{}]|undefined|NaN/);
    }
  });

  it('writes a sentence for every form problem', () => {
    const fields = ['opening', 'region', 'overlap', 'topoSite', 'tm', 'anneal'] as const;
    for (const field of fields) expect(requestErrorText({ kind: 'field', field })).toMatch(/[.]$/);
    for (const code of ['closed', 'no_selection', 'empty_paste', 'protein', 'vector_linear'] as const) {
      const text = requestErrorText({ kind: 'part', error: { code, role: 'insert', index: 2 } });
      expect(text, code).toMatch(/[.]$/);
      expect(text, code).not.toMatch(/[{}]/);
    }
  });
});

describe('problem details a student acts on', () => {
  beforeEach(() => updateSettings({ language: 'en' }));

  it('names the junctions, the overhang and what to change for a duplicate Golden Gate overhang', () => {
    expect(problemText({ code: 'duplicate_overhang', overhang: 'AATG', junctions: [0, 2] })).toBe(
      'Golden Gate junctions 1, 3 use the same overhang AATG, so parts could join in the wrong order. Give each junction a different overhang.',
    );
  });

  it('says what the incompatible ends are', () => {
    expect(
      problemText({ code: 'incompatible_ends', junction: 'EcoRI/BamHI', left: sticky, right: blunt }),
    ).toContain('a 5′ overhang AATT (EcoRI) meets a blunt end (pcr)');
  });
});
