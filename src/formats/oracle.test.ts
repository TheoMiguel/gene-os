import type { Feature, SeqRecord } from '../engine/types';
import { keyOf } from './feature-keys';
import { readSequenceFile } from './index';
import { fixture, type GoldenFeature, type GoldenRecord, goldens, sha256 } from './test-support';

// Reference: Biopython 1.88 Bio.SeqIO.parse on the same files (scripts/oracle/format_goldens.py).
// Biopython placeholders such as "<unknown id>" mean the file has no value; GENE_OS uses the file name.

const FORMAT = {
  genbank: 'genbank',
  embl: 'embl',
  snapgene: 'snapgene',
  abi: 'ab1',
  fasta: 'fasta',
} as const;

function isPlaceholder(value: string): boolean {
  return value.startsWith('<unknown ');
}

/**
 * The parts GENE_OS keeps: remote parts (on other accessions) are dropped, and so is the site between the
 * last and the first base (`315^1`), which has no two flanking bases on the sequence.
 */
function keptParts(golden: GoldenFeature, length: number) {
  return golden.parts.filter((p) => p.ref === null && !(p.start === p.end && p.end === length));
}

/**
 * What GENE_OS keeps of a Biopython feature: `<`/`>` ends as partial flags, inexact positions as plain
 * numbers, a missing strand (protein records) as +1, and `join` as the default operator. Biopython stores a
 * between-bases site (`12^13`) as the empty slice 12:12; GENE_OS stores the two flanking bases 11:13 with
 * `betweenBases`.
 */
function expectedFeature(golden: GoldenFeature, length: number) {
  const parts = keptParts(golden, length);
  return {
    key: golden.type,
    strand: parts[0]?.strand ?? 1,
    operator: parts.length > 1 && golden.operator !== 'join' ? golden.operator : undefined,
    segments: parts.map((p) => {
      const between = p.start === p.end;
      return {
        start: between ? p.start - 1 : p.start,
        end: between ? p.end + 1 : p.end,
        partialStart: p.startFuzzy === '<' || p.startFuzzy === '>',
        partialEnd: p.endFuzzy === '<' || p.endFuzzy === '>',
        betweenBases: between,
      };
    }),
    qualifiers: golden.qualifiers,
  };
}

function actualFeature(feature: Feature) {
  return {
    key: keyOf(feature),
    strand: feature.location.strand,
    operator: feature.location.operator,
    segments: feature.location.segments.map((s) => ({
      start: s.start,
      end: s.end,
      partialStart: s.partialStart === true,
      partialEnd: s.partialEnd === true,
      betweenBases: s.betweenBases === true,
    })),
    qualifiers: feature.qualifiers ?? {},
  };
}

async function expectRecordMatches(actual: SeqRecord, golden: GoldenRecord) {
  for (const field of ['id', 'name', 'description'] as const) {
    if (!isPlaceholder(golden[field])) expect(actual[field], field).toBe(golden[field]);
  }
  expect(actual.topology).toBe(golden.topology ?? 'linear');
  expect(actual.alphabet).toBe(golden.alphabet);
  expect(actual.seq.length).toBe(golden.length);
  if (golden.seq !== undefined) expect(actual.seq).toBe(golden.seq);
  expect(await sha256(actual.seq)).toBe(golden.sha256);

  const expected = golden.features
    .filter((f) => keptParts(f, golden.length).length > 0)
    .map((f) => expectedFeature(f, golden.length));
  expect(actual.features.map(actualFeature)).toEqual(expected);
  for (const f of actual.features) expect(f.origin).toBe('file');

  if (golden.trace) {
    const trace = actual.trace;
    expect(trace).toBeDefined();
    if (!trace) return;
    expect(trace.peakPositions).toEqual(golden.trace.peakPositions);
    expect(trace.quality ?? null).toEqual(golden.trace.quality);
    for (const [base, channel] of Object.entries(golden.trace.channels)) {
      const values = trace.channels[base as 'A' | 'C' | 'G' | 'T'];
      expect(values.length, `channel ${base}`).toBe(channel.length);
      expect(values.reduce((a, b) => a + b, 0)).toBe(channel.sum);
      expect(await sha256(values.join(','))).toBe(channel.sha256);
    }
  }
}

describe('readers agree with Biopython Bio.SeqIO on every fixture', () => {
  test.each(goldens.map((g) => [g.file, g] as const))('%s', async (file, golden) => {
    const result = readSequenceFile(fixture(file), file);

    if (golden.error !== null) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('malformed');
      return;
    }
    if (golden.records.every((r) => r.undefinedSequence)) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('no_sequence');
      return;
    }
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe(FORMAT[golden.format]);
    expect(result.records).toHaveLength(golden.records.length);
    for (const [i, record] of result.records.entries()) {
      await expectRecordMatches(record, golden.records[i] as GoldenRecord);
    }
  });
});
