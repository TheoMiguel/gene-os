import type { Feature, Topology } from '../engine/types';
import { keyOf, nameFromQualifiers, qualifiersToWrite, typeForKey } from './feature-keys';
import { formatInsdcLocation, parseInsdcLocation, toLocation } from './insdc-location';
import { FormatError, type Warnings, wrap } from './internal';

/**
 * The INSDC feature table, shared by GenBank and EMBL. Both put the feature key in columns 6-21 and the
 * location and qualifiers from column 22; only the two-character line prefix differs (spaces or `FT`).
 */

const DATA_COLUMN = 21;
const DATA_WIDTH = 58;

/** Qualifiers whose values INSDC writes without quotes. */
const UNQUOTED = new Set([
  'anticodon',
  'citation',
  'codon_start',
  'compare',
  'direction',
  'estimated_length',
  'mod_base',
  'number',
  'rpt_type',
  'rpt_unit_range',
  'tag_peptide',
  'transl_except',
  'transl_table',
]);

export interface FeatureTableContext {
  readonly length: number;
  readonly topology: Topology;
  readonly warnings: Warnings;
}

/**
 * Parses feature table lines into features with origin `file`. `firstLine` is the 1-based file line of
 * `lines[0]`, for warnings. A feature whose location cannot be used is dropped with a warning.
 */
export function parseFeatureTable(
  lines: readonly string[],
  firstLine: number,
  context: FeatureTableContext,
): Feature[] {
  const features: Feature[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.slice(2, DATA_COLUMN).trim() === '') {
      i++;
      continue;
    }
    const start = i;
    const key = line.slice(5, DATA_COLUMN).trim();
    const body = [line.slice(DATA_COLUMN)];
    i++;
    while (i < lines.length && (lines[i] as string).slice(2, DATA_COLUMN).trim() === '') {
      body.push((lines[i] as string).slice(DATA_COLUMN).trim());
      i++;
    }
    const feature = parseFeature(key, body, features.length, firstLine + start, context);
    if (feature) features.push(feature);
  }
  return features;
}

function parseFeature(
  key: string,
  body: readonly string[],
  index: number,
  lineNumber: number,
  context: FeatureTableContext,
): Feature | undefined {
  const lines = body.filter((l) => l !== '');
  let next = 0;
  let locationText = (lines[next++] ?? '').trim();
  const unbalanced = () => count(locationText, '(') > count(locationText, ')');
  while ((locationText.endsWith(',') || unbalanced()) && next < lines.length && !isQualifier(lines[next])) {
    locationText += (lines[next++] as string).trim();
  }
  if (lines[next]?.startsWith(')')) locationText += (lines[next++] as string).trim();

  const qualifiers = parseQualifiers(lines.slice(next));
  let location: Feature['location'] | undefined;
  try {
    location = toLocation(
      parseInsdcLocation(locationText),
      context.length,
      context.topology,
      context.warnings,
      lineNumber,
    );
  } catch (error) {
    if (!(error instanceof FormatError)) throw error;
    context.warnings.add('location_dropped', `${key} feature dropped: ${error.message}`, lineNumber);
    return undefined;
  }
  if (location === undefined) return undefined;
  return {
    id: `f${index + 1}`,
    ...typeForKey(key, qualifiers),
    name: nameFromQualifiers(key, qualifiers),
    location,
    origin: 'file',
    qualifiers,
  };
}

function isQualifier(line: string | undefined): boolean {
  return line?.startsWith('/') ?? false;
}

function count(text: string, c: string): number {
  let n = 0;
  for (const ch of text) if (ch === c) n++;
  return n;
}

/**
 * Qualifier lines to values, with Biopython's rules: continuation lines join with one space (none for
 * `/translation`), enclosing quotes go, `""` becomes `"`, and a valueless qualifier (`/pseudo`) reads as ''.
 */
function parseQualifiers(lines: readonly string[]): Record<string, string[]> {
  const raw: [string, string[] | null][] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++] as string;
    if (!line.startsWith('/')) {
      const last = raw[raw.length - 1];
      if (last?.[1]) last[1].push(line);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      raw.push([line.slice(1), null]);
      continue;
    }
    const value = line.slice(eq + 1).trimStart();
    const parts = [value];
    if (value.length > 1 && value.startsWith('"')) {
      while (!(parts[parts.length - 1] as string).endsWith('"') && i < lines.length)
        parts.push(lines[i++] as string);
    }
    raw.push([line.slice(1, eq), parts]);
  }

  const qualifiers: Record<string, string[]> = {};
  for (const [key, parts] of raw) {
    qualifiers[key] ??= [];
    const values = qualifiers[key];
    if (parts === null) {
      if (values.length === 0) values.push('');
      continue;
    }
    let value = parts.join(' ');
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    value = value.replaceAll('""', '"');
    if (key === 'translation') value = value.replace(/\s+/g, '');
    values.push(value);
  }
  return qualifiers;
}

/** Line prefixes of a feature table: GenBank indents with spaces, EMBL starts every line with `FT`. */
export interface FeatureTableStyle {
  readonly lead: string;
}

/** Formats features as feature table lines (without the table header). */
export function formatFeatureTable(features: readonly Feature[], style: FeatureTableStyle): string[] {
  const indent = style.lead.padEnd(DATA_COLUMN);
  const out: string[] = [];
  for (const feature of features) {
    const locationLines = wrap(formatInsdcLocation(feature.location), DATA_WIDTH, ',');
    out.push(`${style.lead.padEnd(5)}${keyOf(feature).padEnd(16)}${locationLines[0]}`);
    for (const l of locationLines.slice(1)) out.push(indent + l);
    for (const [key, values] of Object.entries(qualifiersToWrite(feature))) {
      for (const value of values) {
        for (const l of wrap(formatQualifier(key, value), DATA_WIDTH)) out.push(indent + l);
      }
    }
  }
  return out;
}

function formatQualifier(key: string, value: string): string {
  if (value === '') return `/${key}`;
  if (UNQUOTED.has(key) && !/[\s"]/.test(value)) return `/${key}=${value}`;
  return `/${key}="${value.replaceAll('"', '""')}"`;
}
