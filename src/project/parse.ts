import type { SearchMode } from '../engine/search';
import { ALL_FRAMES } from '../engine/translate';
import {
  type Alphabet,
  FEATURE_TYPES,
  type Feature,
  type FeatureOrigin,
  type FeatureType,
  type SeqMetadata,
  type SeqRecord,
  type SequenceFormat,
  type Span,
  type Strand,
  type Topology,
} from '../engine/types';
import { ANALYSIS_TABS, type AnalysisTab } from '../state/documents';
import { DEFAULT_LINE_LENGTH, OVERLAY_KINDS, type OverlayKind } from '../state/view';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type ProjectData,
  type ProjectDocument,
  type ProjectParse,
  type ViewConfig,
} from './types';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => Number.isInteger(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.find((option) => option === value);

const SEARCH_MODES: readonly SearchMode[] = ['text', 'motif', 'regex'];
const ALPHABETS: readonly Alphabet[] = ['dna', 'rna', 'protein'];
const TOPOLOGIES: readonly Topology[] = ['linear', 'circular'];
const ORIGINS: readonly FeatureOrigin[] = ['file', 'user', 'detected'];
const FORMATS: readonly SequenceFormat[] = ['fasta', 'genbank', 'embl', 'snapgene', 'ab1', 'raw'];
const SEQUENCE_TEXT = /^[A-Za-z*.-]*$/;

function parseSpan(raw: unknown, length: number): Span | null {
  if (!isObject(raw) || !isInt(raw.start) || !isInt(raw.end)) return null;
  const { start, end } = raw;
  if (start < 0 || start >= end || end > length) return null;
  return {
    start,
    end,
    ...(raw.partialStart === true ? { partialStart: true as const } : {}),
    ...(raw.partialEnd === true ? { partialEnd: true as const } : {}),
    ...(raw.betweenBases === true ? { betweenBases: true as const } : {}),
  };
}

function parseQualifiers(raw: unknown): Record<string, readonly string[]> | null {
  if (!isObject(raw)) return null;
  const out: Record<string, readonly string[]> = {};
  for (const [key, values] of Object.entries(raw))
    if (Array.isArray(values) && values.every(isText)) out[key] = values;
  return out;
}

/** A feature whose type, origin and every segment fit the sequence, else null. */
function parseFeature(raw: unknown, length: number): Feature | null {
  if (!isObject(raw) || !isText(raw.id) || !isText(raw.name) || !isObject(raw.location)) return null;
  const type = oneOf<FeatureType>(FEATURE_TYPES, raw.type);
  const origin = oneOf(ORIGINS, raw.origin);
  const strand: Strand | null =
    raw.location.strand === 1 || raw.location.strand === -1 ? raw.location.strand : null;
  const segments = Array.isArray(raw.location.segments)
    ? raw.location.segments.map((segment) => parseSpan(segment, length))
    : [];
  if (!type || !origin || !strand || segments.length === 0 || segments.some((s) => s === null)) return null;
  const operator = oneOf(['order', 'bond'] as const, raw.location.operator);
  const qualifiers = parseQualifiers(raw.qualifiers);
  return {
    id: raw.id,
    type,
    name: raw.name,
    origin,
    location: {
      segments: segments as Span[],
      strand,
      ...(operator ? { operator } : {}),
    },
    ...(isText(raw.sourceKey) ? { sourceKey: raw.sourceKey } : {}),
    ...(isText(raw.color) ? { color: raw.color } : {}),
    ...(isText(raw.description) ? { description: raw.description } : {}),
    ...(qualifiers ? { qualifiers } : {}),
  };
}

function parseMetadata(raw: unknown): SeqMetadata {
  if (!isObject(raw)) return {};
  const sourceFormat = oneOf(FORMATS, raw.sourceFormat);
  return {
    ...(isText(raw.accession) ? { accession: raw.accession } : {}),
    ...(isText(raw.organism) ? { organism: raw.organism } : {}),
    ...(isText(raw.molType) ? { molType: raw.molType } : {}),
    ...(isText(raw.date) ? { date: raw.date } : {}),
    ...(sourceFormat ? { sourceFormat } : {}),
  };
}

const CHANNELS = ['A', 'C', 'G', 'T'] as const;
const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number');

function parseTrace(raw: unknown, length: number): SeqRecord['trace'] | null {
  if (!isObject(raw) || !isObject(raw.channels) || !isNumberArray(raw.peakPositions)) return null;
  if (raw.peakPositions.length !== length) return null;
  const channels = raw.channels;
  if (!CHANNELS.every((base) => isNumberArray(channels[base]))) return null;
  return {
    channels: Object.fromEntries(CHANNELS.map((base) => [base, channels[base] as number[]])) as Record<
      (typeof CHANNELS)[number],
      number[]
    >,
    peakPositions: raw.peakPositions,
    ...(isNumberArray(raw.quality) ? { quality: raw.quality } : {}),
  };
}

/** A record with every field checked, a damaged feature dropped, or null when the record itself is damaged. */
export function parseRecord(raw: unknown): SeqRecord | null {
  if (!isObject(raw) || !isText(raw.seq) || !isText(raw.id) || !isText(raw.name)) return null;
  const alphabet = oneOf(ALPHABETS, raw.alphabet);
  const topology = oneOf(TOPOLOGIES, raw.topology);
  if (!alphabet || !topology || !SEQUENCE_TEXT.test(raw.seq)) return null;
  const length = raw.seq.length;
  const features = (Array.isArray(raw.features) ? raw.features : [])
    .map((feature) => parseFeature(feature, length))
    .filter((feature): feature is Feature => feature !== null);
  const trace = raw.trace === undefined ? null : parseTrace(raw.trace, length);
  return {
    id: raw.id,
    name: raw.name,
    description: isText(raw.description) ? raw.description : '',
    alphabet,
    topology,
    seq: raw.seq,
    features,
    metadata: parseMetadata(raw.metadata),
    ...(trace ? { trace } : {}),
  };
}

const clamp = (value: unknown, max: number, fallback: number) =>
  isInt(value) ? Math.min(Math.max(value, 0), max) : fallback;

/** A view configuration with every field checked against the sequence length; a bad field takes its default. */
export function parseViewConfig(raw: unknown, length: number): ViewConfig {
  const view = isObject(raw) ? raw : {};
  const selection = isObject(view.selection) ? view.selection : null;
  const start = selection ? clamp(selection.start, length, -1) : -1;
  const end = selection ? clamp(selection.end, length, -1) : -1;
  const search = isObject(view.search) ? view.search : {};
  const overlays = isObject(view.overlays) ? view.overlays : {};
  const frames = Array.isArray(view.frames) ? view.frames : [];
  return {
    selection:
      selection && start >= 0 && end > start
        ? { start, end, strand: selection.strand === -1 ? -1 : 1 }
        : null,
    caret: clamp(view.caret, length, 0),
    search: {
      query: isText(search.query) ? search.query : '',
      mode: oneOf(SEARCH_MODES, search.mode) ?? 'text',
    },
    overlays: Object.fromEntries(
      OVERLAY_KINDS.map((kind: OverlayKind) => [kind, overlays[kind] !== false]),
    ) as Record<OverlayKind, boolean>,
    lineLength:
      isInt(view.lineLength) && view.lineLength >= 10 && view.lineLength <= 400
        ? view.lineLength
        : DEFAULT_LINE_LENGTH,
    frames: ALL_FRAMES.filter((frame) => frames.includes(frame)),
  };
}

/** One document of a project, or null when its record is damaged. */
export function parseDocument(raw: unknown): ProjectDocument | null {
  if (!isObject(raw)) return null;
  const record = parseRecord(raw.record);
  if (!record) return null;
  const activeTab: AnalysisTab = oneOf(ANALYSIS_TABS, raw.activeTab) ?? 'summary';
  return {
    record,
    activeTab,
    view: parseViewConfig(raw.view, record.seq.length),
    sections: isObject(raw.sections) ? { ...raw.sections } : {},
  };
}

/**
 * Migrations from an older project version to the next, keyed by the version they read. There is none yet,
 * because version 1 is the first. A version without a migration is refused as unsupported.
 */
const MIGRATIONS: Readonly<Record<number, (data: Json) => Json>> = {};

/**
 * Reads a project from parsed JSON. Refuses what is not a GENE_OS project and a version newer than this app
 * knows, with a reason the interface can tell the user. A damaged document is skipped and counted, never fatal.
 */
export function parseProject(input: unknown): ProjectParse {
  if (!isObject(input) || input.format !== PROJECT_FORMAT) return { ok: false, reason: 'notProject' };
  const version = input.version;
  if (!isInt(version) || version < 1) return { ok: false, reason: 'unsupportedVersion' };
  if (version > PROJECT_VERSION) return { ok: false, reason: 'newerVersion', version };

  let data: Json = input;
  for (let from = version; from < PROJECT_VERSION; from++) {
    const migrate = MIGRATIONS[from];
    if (!migrate) return { ok: false, reason: 'unsupportedVersion', version };
    data = migrate(data);
  }

  const raw = Array.isArray(data.documents) ? data.documents : [];
  const parsed = raw.map(parseDocument);
  const documents = parsed.filter((doc): doc is ProjectDocument => doc !== null);
  if (documents.length === 0 && raw.length > 0) return { ok: false, reason: 'damaged' };

  const index = isInt(data.activeIndex) ? data.activeIndex : null;
  const activeIndex =
    index !== null && parsed[index] ? documents.indexOf(parsed[index] as ProjectDocument) : -1;
  const project: ProjectData = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    app: 'GENE_OS',
    name: isText(data.name) ? data.name : '',
    savedAt: isText(data.savedAt) ? data.savedAt : '',
    activeIndex: activeIndex >= 0 ? activeIndex : null,
    documents,
  };
  return { ok: true, data: project, skipped: raw.length - documents.length };
}

/** Parses project file text. Text that is not JSON is refused as `notJson`. */
export function parseProjectText(text: string): ProjectParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'notJson' };
  }
  return parseProject(json);
}
