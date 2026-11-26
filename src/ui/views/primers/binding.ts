import { iupacMatches, reverseComplement } from '../../../engine/alphabet';
import { circularLocation, linearLocation, sliceCircular } from '../../../engine/location';
import type { Feature, PrimerBinding, Span, Strand, Topology } from '../../../engine/types';

/** Top-strand pieces of a binding: one, or two when it runs across the origin of a circular template. */
export function bindingPieces(binding: PrimerBinding, length: number): Span[] {
  const { start, end } = binding.span;
  if (end <= length) return [{ start, end }];
  return [
    { start, end: length },
    { start: 0, end: end - length },
  ];
}

/** The binding with its span cut at the origin, one binding per piece, for the sequence renderer. */
export function splitAtOrigin(bindings: readonly PrimerBinding[], length: number): PrimerBinding[] {
  return bindings.flatMap((binding) => bindingPieces(binding, length).map((span) => ({ ...binding, span })));
}

/** The part of the primer that anneals, as it reads 5'→3', and the template strand it matches, both 5'→3'. */
export interface BindingAlignment {
  readonly primer: string;
  readonly marks: string;
  readonly template: string;
  readonly mismatches: number;
  /** Bases of the primer's 5' end that do not anneal. */
  readonly tail: number;
}

/**
 * Lines up the annealed 3' part of a primer with the template strand it copies: the top strand for a forward
 * binding, the bottom strand for a reverse one. A `|` marks identical bases and a space a mismatch.
 */
export function bindingAlignment(
  primerSeq: string,
  binding: PrimerBinding,
  template: string,
  topology: Topology,
): BindingAlignment {
  const length = binding.span.end - binding.span.start;
  const primer = primerSeq.toUpperCase().slice(primerSeq.length - length);
  const top =
    topology === 'circular'
      ? sliceCircular(template, binding.span.start, length)
      : template.slice(binding.span.start, binding.span.end);
  const matched = binding.strand === 1 ? top : reverseComplement(top);
  let marks = '';
  let mismatches = 0;
  for (let i = 0; i < length; i++) {
    const same = iupacMatches(primer[i] ?? 'N', matched[i] ?? 'N');
    marks += same ? '|' : ' ';
    if (!same) mismatches++;
  }
  return { primer, marks, template: matched, mismatches, tail: primerSeq.length - length };
}

/** A primer the document could carry: its name and sequence. */
export interface NamedPrimer {
  readonly name: string;
  readonly seq: string;
}

const slug = (name: string) => name.replace(/[^A-Za-z0-9_.-]+/g, '_');

/** The feature a primer binding becomes: a `primer_bind` the plasmid map and the sequence viewer draw. */
export function bindingFeature(
  primer: NamedPrimer,
  binding: PrimerBinding,
  length: number,
  topology: Topology,
): Feature {
  const span = binding.span;
  const size = span.end - span.start;
  const location =
    topology === 'circular'
      ? circularLocation(span.start, size, length, binding.strand)
      : linearLocation(span.start, span.end, binding.strand);
  const tail = primer.seq.length - size;
  return {
    id: `primer:${slug(primer.name)}:${span.start}:${binding.strand}`,
    type: 'primer_bind',
    name: primer.name,
    location,
    origin: 'user',
    qualifiers: {
      note: [
        `primer ${primer.seq.toUpperCase()} 5'→3'${tail > 0 ? `, ${tail} nt 5' tail does not bind` : ''}${binding.mismatches > 0 ? `, ${binding.mismatches} mismatch(es)` : ''}`,
      ],
    },
  };
}

/** The strongest bindings of a primer: those with the fewest mismatches. */
export function bestBindings(bindings: readonly PrimerBinding[]): PrimerBinding[] {
  const fewest = Math.min(...bindings.map((b) => b.mismatches));
  return bindings.filter((b) => b.mismatches === fewest);
}

/** The binding a designed primer has by construction: its span on its strand, no mismatches. */
export function exactBinding(id: string, strand: Strand, span: Span, length: number): PrimerBinding {
  return {
    primerId: id,
    strand,
    span: {
      start: ((span.start % length) + length) % length,
      end: span.end - span.start + (((span.start % length) + length) % length),
    },
    mismatches: 0,
  };
}
