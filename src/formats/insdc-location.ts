import type { Location, Span, Strand, Topology } from '../engine/types';
import { FormatError, type Warnings } from './internal';

type Fuzz = '<' | '>' | 'inexact';

/** One part of a parsed INSDC location, before it is checked against the sequence. 0-based half-open. */
interface RawPart {
  readonly start: number;
  readonly end: number;
  readonly strand: Strand;
  readonly ref?: string;
  readonly startFuzz?: Fuzz;
  readonly endFuzz?: Fuzz;
  /** A site between two bases (`12^13`); `start..end` covers the two flanking bases. */
  readonly between?: true;
}

interface RawLocation {
  readonly parts: readonly RawPart[];
  readonly operator?: 'join' | 'order' | 'bond';
}

interface Position {
  readonly value: number;
  readonly fuzz?: Fuzz;
}

/**
 * Recursive-descent parser for INSDC feature locations (GenBank and EMBL share the grammar).
 * Parts come out in biological order, as Biopython orders them: `complement(join(a,b))` gives `b, a`.
 */
class LocationParser {
  private pos = 0;
  operator: RawLocation['operator'];

  constructor(private readonly text: string) {}

  parse(): RawPart[] {
    const parts = this.location(1);
    if (this.pos !== this.text.length) this.fail();
    return parts;
  }

  private location(strand: Strand): RawPart[] {
    for (const op of ['complement', 'join', 'order', 'bond'] as const) {
      if (this.text.startsWith(`${op}(`, this.pos)) {
        this.pos += op.length + 1;
        const parts = op === 'complement' ? this.complement(strand) : this.list(op, strand);
        this.expect(')');
        return parts;
      }
    }
    return [this.span(strand)];
  }

  private complement(strand: Strand): RawPart[] {
    const flipped: Strand = strand === 1 ? -1 : 1;
    return this.location(flipped).reverse();
  }

  private list(op: 'join' | 'order' | 'bond', strand: Strand): RawPart[] {
    this.operator ??= op;
    const parts = this.location(strand);
    while (this.text[this.pos] === ',') {
      this.pos++;
      parts.push(...this.location(strand));
    }
    return parts;
  }

  private span(strand: Strand): RawPart {
    const colon = this.text.indexOf(':', this.pos);
    let ref: string | undefined;
    if (colon > this.pos && /^[A-Za-z][\w.]*$/.test(this.text.slice(this.pos, colon))) {
      ref = this.text.slice(this.pos, colon);
      this.pos = colon + 1;
    }
    const start = this.position(-1);
    let part: RawPart;
    if (this.text.startsWith('..', this.pos)) {
      this.pos += 2;
      const end = this.position(0);
      part = withFuzz({ start: start.value, end: end.value, strand }, start.fuzz, end.fuzz);
    } else if (this.text[this.pos] === '^') {
      this.pos++;
      part = { start: start.value, end: this.position(0).value, strand, between: true };
    } else {
      part = withFuzz({ start: start.value, end: start.value + 1, strand }, start.fuzz, start.fuzz);
    }
    return ref === undefined ? part : { ...part, ref };
  }

  /** A position; `offset` is -1 for a start (1-based inclusive to 0-based) and 0 for an end. */
  private position(offset: -1 | 0): Position {
    const c = this.text[this.pos];
    if (c === '<' || c === '>') {
      this.pos++;
      return { value: this.integer() + offset, fuzz: c };
    }
    if (c === '(') {
      this.pos++;
      const left = this.integer();
      this.expect('.');
      const right = this.integer();
      this.expect(')');
      return { value: (offset === -1 ? left : right) + offset, fuzz: 'inexact' };
    }
    if (this.text.startsWith('one-of(', this.pos)) {
      this.pos += 7;
      const choices = [this.integer()];
      while (this.text[this.pos] === ',') {
        this.pos++;
        choices.push(this.integer());
      }
      this.expect(')');
      return {
        value: (offset === -1 ? Math.min(...choices) : Math.max(...choices)) + offset,
        fuzz: 'inexact',
      };
    }
    return { value: this.integer() + offset };
  }

  private integer(): number {
    const begin = this.pos;
    while (
      this.pos < this.text.length &&
      this.text.charCodeAt(this.pos) >= 48 &&
      this.text.charCodeAt(this.pos) <= 57
    ) {
      this.pos++;
    }
    if (this.pos === begin) this.fail();
    return Number(this.text.slice(begin, this.pos));
  }

  private expect(c: string): void {
    if (this.text[this.pos] !== c) this.fail();
    this.pos++;
  }

  private fail(): never {
    throw new FormatError('malformed', `invalid feature location '${this.text}'`);
  }
}

function withFuzz(part: RawPart, startFuzz: Fuzz | undefined, endFuzz: Fuzz | undefined): RawPart {
  return {
    ...part,
    ...(startFuzz === undefined ? {} : { startFuzz }),
    ...(endFuzz === undefined ? {} : { endFuzz }),
  };
}

/** Parses an INSDC location string (`complement(join(<1..20,30..>40))`). Throws FormatError when invalid. */
export function parseInsdcLocation(text: string): RawLocation {
  const parser = new LocationParser(text.replace(/\s+/g, ''));
  const parts = parser.parse();
  return parser.operator === undefined ? { parts } : { parts, operator: parser.operator };
}

function toSpan(start: number, end: number, partialStart: boolean, partialEnd: boolean): Span {
  return {
    start,
    end,
    ...(partialStart ? { partialStart: true as const } : {}),
    ...(partialEnd ? { partialEnd: true as const } : {}),
  };
}

/** The segments a parsed part gives on the sequence, or a reason to drop it. */
function partSegments(part: RawPart, length: number, topology: Topology, warnings: Warnings, line?: number) {
  const where = `${part.start + 1}..${part.end}`;
  if (part.ref !== undefined) return `location part on another entry (${part.ref}) dropped`;
  if (part.between) {
    if (part.end === part.start + 2 && part.end <= length) {
      return [{ start: part.start, end: part.end, betweenBases: true as const }];
    }
    return `site between bases ${where} dropped`;
  }
  const partialStart = part.startFuzz === '<' || part.startFuzz === '>';
  const partialEnd = part.endFuzz === '<' || part.endFuzz === '>';
  if (part.start < part.end && part.end <= length)
    return [toSpan(part.start, part.end, partialStart, partialEnd)];
  if (topology === 'circular' && part.end <= part.start && part.start < length) {
    warnings.add('location_fixed', `location ${where} split across the origin`, line);
    const head = toSpan(part.start, length, partialStart, false);
    const tail = toSpan(0, part.end, false, partialEnd);
    return part.strand === 1 ? [head, tail] : [tail, head];
  }
  return `location ${where} is outside the sequence`;
}

/**
 * Turns a parsed location into a GENE_OS location on a sequence of `length` bases. Like Biopython it splits
 * a circular-sequence part written as `start > end` into two segments across the origin. Parts GENE_OS cannot
 * hold (remote accessions, out-of-range coordinates) are dropped with a warning, and
 * `undefined` is returned when nothing is left.
 */
export function toLocation(
  raw: RawLocation,
  length: number,
  topology: Topology,
  warnings: Warnings,
  line?: number,
): Location | undefined {
  const segments: Span[] = [];
  const strands = new Set<Strand>();
  for (const part of raw.parts) {
    const result = partSegments(part, length, topology, warnings, line);
    if (typeof result === 'string') {
      warnings.add('location_dropped', result, line);
      continue;
    }
    segments.push(...result);
    strands.add(part.strand);
  }
  const [strand] = strands;
  if (strand === undefined) return undefined;
  if (raw.parts.some((p) => p.startFuzz === 'inexact' || p.endFuzz === 'inexact')) {
    warnings.add('location_simplified', 'inexact position reduced to its outer bound', line);
  }
  if (strands.size > 1)
    warnings.add('location_simplified', 'feature on both strands kept on one strand', line);
  const operator =
    segments.length > 1 && (raw.operator === 'order' || raw.operator === 'bond') ? raw.operator : undefined;
  return operator === undefined ? { segments, strand } : { segments, strand, operator };
}

function formatSpan(span: Span): string {
  if (span.betweenBases) return `${span.start + 1}^${span.end}`;
  const start = `${span.partialStart ? '<' : ''}${span.start + 1}`;
  if (span.end === span.start + 1 && !span.partialStart && !span.partialEnd) return start;
  return `${start}..${span.partialEnd ? '>' : ''}${span.end}`;
}

/**
 * Formats a location as INSDC text. A reverse-strand location is written as `complement(join(...))` with the
 * segments in top-strand order, the GenBank convention.
 */
export function formatInsdcLocation(location: Location): string {
  const segments = location.strand === 1 ? location.segments : [...location.segments].reverse();
  const body = segments.map(formatSpan).join(',');
  const combined = segments.length > 1 ? `${location.operator ?? 'join'}(${body})` : body;
  return location.strand === 1 ? combined : `complement(${combined})`;
}
