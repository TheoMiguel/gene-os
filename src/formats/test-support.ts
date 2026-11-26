/** Test helpers: fixture files and Biopython goldens. */

import * as fs from 'node:fs';

export { fs };

export const FIXTURES = new URL('../../tests/fixtures/formats/', import.meta.url);

/** The bytes of a fixture in tests/fixtures/formats/. */
export function fixture(name: string): Uint8Array {
  return fs.readFileSync(new URL(name, FIXTURES));
}

export interface GoldenPart {
  readonly start: number;
  readonly end: number;
  readonly strand: 1 | -1 | null;
  readonly ref: string | null;
  readonly startFuzzy: '<' | '>' | 'other' | null;
  readonly endFuzzy: '<' | '>' | 'other' | null;
}

export interface GoldenFeature {
  readonly type: string;
  readonly operator: 'join' | 'order' | 'bond' | null;
  readonly parts: readonly GoldenPart[];
  readonly qualifiers: Readonly<Record<string, readonly string[]>>;
}

export interface GoldenChannel {
  readonly length: number;
  readonly sum: number;
  readonly sha256: string;
}

export interface GoldenRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly topology: 'linear' | 'circular' | null;
  readonly moleculeType: string | null;
  readonly alphabet: 'dna' | 'rna' | 'protein';
  readonly length: number;
  readonly sha256: string;
  readonly seq?: string;
  readonly features: readonly GoldenFeature[];
  readonly undefinedSequence?: true;
  readonly trace?: {
    readonly baseOrder: string;
    readonly channels: Readonly<Record<string, GoldenChannel>>;
    readonly peakPositions: readonly number[];
    readonly quality: readonly number[] | null;
  };
}

export interface GoldenFixture {
  readonly file: string;
  readonly format: 'genbank' | 'embl' | 'snapgene' | 'abi' | 'fasta';
  readonly error: string | null;
  readonly warnings: readonly string[];
  readonly records: readonly GoldenRecord[];
}

/** Bio.SeqIO results for every fixture, written by scripts/oracle/format_goldens.py. */
export const goldens: readonly GoldenFixture[] = JSON.parse(
  new TextDecoder().decode(fs.readFileSync(new URL('../../tests/oracle/formats.json', import.meta.url))),
).fixtures;

/** Hex SHA-256 of an ASCII string, as the golden script computes it. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
