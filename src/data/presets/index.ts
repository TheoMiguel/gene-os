import type { SeqRecord } from '../../engine/types';
import { readSequenceFile } from '../../formats';
import manifest from './manifest.json';

/** One example sequence and where its record came from (written by `scripts/oracle/fetch_presets.py`). */
export interface PresetInfo {
  readonly id: string;
  readonly name: string;
  readonly format: 'genbank' | 'ab1';
  /** Name the reader sees, so its extension names the format. */
  readonly file: string;
  /** A binary record is stored as base64 text in this file, which every build and test setup can import. */
  readonly encoded?: string;
  /** Accession and version of the public record, absent for a trace file. */
  readonly accession: string | null;
  /** `start..stop` of the part of the record that was fetched, 1-based, or null for the whole record. */
  readonly region: string | null;
  readonly source: string;
  readonly url: string;
  readonly retrieved: string;
  readonly length: number;
  readonly topology: string;
  readonly features: number;
  readonly description: string;
}

/** The shipped example sequences, in the order the new-sequence view lists them. */
export const PRESETS: readonly PresetInfo[] = manifest as readonly PresetInfo[];

type Loader = () => Promise<Uint8Array>;

const fromText =
  (load: () => Promise<{ default: string }>): Loader =>
  async () =>
    new TextEncoder().encode((await load()).default);

/** Each record is its own chunk, so the app downloads an example only when the user opens it. */
const LOADERS: Readonly<Record<string, Loader>> = {
  puc19: fromText(() => import('./puc19.gb?raw')),
  pbr322: fromText(() => import('./pbr322.gb?raw')),
  lambda: fromText(() => import('./lambda.gb?raw')),
  egfp: fromText(() => import('./egfp.gb?raw')),
  gfp: fromText(() => import('./gfp.gb?raw')),
  'pcdna3.1': fromText(() => import('./pcdna3.1.gb?raw')),
  'pgex-4t-1': fromText(() => import('./pgex-4t-1.gb?raw')),
  'petduet-1-gfp': fromText(() => import('./petduet-1-gfp.gb?raw')),
  'sanger-read': async () => {
    const { default: base64 } = await import('./sanger-16s-read.ab1.b64.txt?raw');
    return Uint8Array.from(atob(base64.trim()), (char) => char.charCodeAt(0));
  },
};

/** Reads an example through the format readers, so it carries the features of its record. Throws when unknown or unreadable. */
export async function loadPreset(id: string): Promise<SeqRecord> {
  const info = PRESETS.find((preset) => preset.id === id);
  const load = LOADERS[id];
  if (!info || !load) throw new RangeError(`unknown example sequence: ${id}`);
  const read = readSequenceFile(await load(), info.file);
  const record = read.ok ? read.records[0] : undefined;
  if (!record) throw new Error(`the example ${info.name} could not be read`);
  return { ...record, name: info.name };
}
