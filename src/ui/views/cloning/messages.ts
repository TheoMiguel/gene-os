import type { CloningProblem, CloningWarning, EndDescription } from '../../../engine/cloning';
import { t } from '../../i18n';
import type { PartError, RequestError } from './model';

const endText = (end: EndDescription): string =>
  end.type === 'blunt'
    ? t('clone.end.blunt', { source: end.source })
    : t(end.type === 'five_prime' ? 'clone.end.five' : 'clone.end.three', {
        overhang: end.overhang,
        source: end.source,
      });

/** A problem that stopped the design, as a sentence that says what to change. */
export function problemText(problem: CloningProblem): string {
  switch (problem.code) {
    case 'no_parts':
      return t('clone.problem.no_parts');
    case 'region_out_of_range':
      return t('clone.problem.region_out_of_range', { part: problem.part });
    case 'enzyme_unknown':
      return t('clone.problem.enzyme_unknown', { enzyme: problem.enzyme });
    case 'enzyme_not_suitable':
      return t(`clone.problem.enzyme_not_suitable.${problem.reason}`, { enzyme: problem.enzyme });
    case 'enzyme_no_site':
      return t('clone.problem.enzyme_no_site', { enzyme: problem.enzyme, part: problem.part });
    case 'enzyme_cuts_insert':
      return t('clone.problem.enzyme_cuts_insert', {
        enzyme: problem.enzyme,
        part: problem.part,
        cuts: problem.cuts,
      });
    case 'enzyme_cuts_vector_repeatedly':
      return t('clone.problem.enzyme_cuts_vector_repeatedly', { enzyme: problem.enzyme, cuts: problem.cuts });
    case 'no_enzyme_pair':
      return t('clone.problem.no_enzyme_pair');
    case 'incompatible_ends':
      return t('clone.problem.incompatible_ends', {
        junction: problem.junction,
        left: endText(problem.left),
        right: endText(problem.right),
      });
    case 'duplicate_overhang':
      return t('clone.problem.duplicate_overhang', {
        overhang: problem.overhang,
        junctions: problem.junctions.map((j) => j + 1).join(', '),
      });
    case 'palindromic_overhang':
      return t('clone.problem.palindromic_overhang', {
        overhang: problem.overhang,
        junction: problem.junction + 1,
      });
    case 'overhang_invalid':
      return t('clone.problem.overhang_invalid', {
        overhang: problem.overhang,
        junction: problem.junction + 1,
      });
    case 'primer_design_failed':
      return t(`clone.problem.primer_design_failed.${problem.end}`, { part: problem.part });
    case 'overlap_out_of_range':
      return t('clone.problem.overlap_out_of_range', {
        min: problem.min,
        max: problem.max,
        value: problem.value,
      });
    case 'topo_missing_cacc':
      return t('clone.problem.topo_missing_cacc', { part: problem.part });
    case 'topo_site_out_of_range':
      return t('clone.problem.topo_site_out_of_range');
    case 'att_site_unknown':
      return t('clone.problem.att_site_unknown', { variant: problem.variant });
    case 'att_site_not_found':
      return t('clone.problem.att_site_not_found', { part: problem.part, count: problem.count });
    case 'att_no_route':
      return t(`clone.problem.att_no_route.${problem.detail}`);
    case 'lic_overhang_mismatch':
      return t('clone.problem.lic_overhang_mismatch', {
        junction: problem.junction,
        expected: problem.expected,
        actual: problem.actual,
      });
    case 'lic_no_stop_nucleotide':
      return t('clone.problem.lic_no_stop_nucleotide', { part: problem.part });
    case 'junction_mismatch':
      return t('clone.problem.junction_mismatch', { junction: problem.junction });
  }
}

/** A warning: the design worked, but something deserves a check. */
export function warningText(warning: CloningWarning): string {
  switch (warning.code) {
    case 'vector_self_ligation':
      return t(
        warning.dephosphorylate
          ? 'clone.warning.vector_self_ligation.treated'
          : 'clone.warning.vector_self_ligation.open',
      );
    case 'blunt_ligation':
      return t('clone.warning.blunt_ligation');
    case 'dephosphorylated_vector_unphosphorylated_insert':
      return t('clone.warning.dephosphorylated_vector_unphosphorylated_insert');
    case 'vector_stub_comigrates':
      return t('clone.warning.vector_stub_comigrates', {
        stubLength: warning.stubLength.toLocaleString(),
        backboneLength: warning.backboneLength.toLocaleString(),
      });
    case 'both_orientations_possible':
      return t('clone.warning.both_orientations_possible');
    case 'internal_site':
      return t('clone.warning.internal_site', {
        enzyme: warning.enzyme,
        part: warning.part,
        cuts: warning.cuts,
      });
    case 'three_prime_overhang_end':
      return t('clone.warning.three_prime_overhang_end', { enzyme: warning.enzyme, part: warning.part });
    case 'primer_tm_low':
      return t('clone.warning.primer_tm_low', { primer: warning.primer, tm: warning.tm.toFixed(1) });
    case 'primer_long':
      return t('clone.warning.primer_long', { primer: warning.primer, length: warning.length });
    case 'overlap_gc_extreme':
      return t('clone.warning.overlap_gc_extreme', {
        junction: warning.junction,
        gc: Math.round(warning.gc),
      });
    case 'overlap_repeat':
      return t('clone.warning.overlap_repeat', { junction: warning.junction });
    case 'topo_site_without_t':
      return t('clone.warning.topo_site_without_t');
    case 'topo_directional_needs_blunt':
      return t('clone.warning.topo_directional_needs_blunt');
    case 'topo_a_overhang_lost':
      return t('clone.warning.topo_a_overhang_lost');
    case 'no_counterselection':
      return t('clone.warning.no_counterselection', { part: warning.part });
    case 'counterselection_kept':
      return t('clone.warning.counterselection_kept', { part: warning.part });
    case 'insert_arc_guessed':
      return t('clone.warning.insert_arc_guessed', { part: warning.part });
    case 'lic_overhang_short':
      return t('clone.warning.lic_overhang_short', { junction: warning.junction, length: warning.length });
  }
}

const PART_ERRORS = {
  closed: 'clone.err.closed',
  no_selection: 'clone.err.no_selection',
  empty_paste: 'clone.err.empty_paste',
  protein: 'clone.err.protein',
  vector_linear: 'clone.err.vector_linear',
} as const;

/** A form problem found before the engine ran. */
export function requestErrorText(error: RequestError): string {
  if (error.kind === 'field') return t(`clone.field.${error.field}`);
  const part: PartError = error.error;
  const role =
    part.role === 'vector' ? t('clone.role.vector') : t('clone.role.insert', { index: part.index });
  return t(PART_ERRORS[part.code], { role });
}
