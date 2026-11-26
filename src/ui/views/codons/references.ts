import tableData from '../../../data/codon-tables.json';

/** A reference organism's codon counts, as published by the Codon Usage Database (Kazusa). */
export interface ReferenceTable {
  readonly id: string;
  /** Species name as the database lists it. */
  readonly name: string;
  /** The expression host this table stands for, as a user names it. */
  readonly host: string;
  readonly source: string;
  /** Page the counts were read from. */
  readonly url: string;
  /** Number of coding sequences behind the counts. A small number means a noisy table. */
  readonly cds: number;
  /** Codons counted. */
  readonly codons: number;
  /** Raw count of each of the 64 codons, keyed by DNA codon. */
  readonly counts: Readonly<Record<string, number>>;
}

/** Where the reference tables came from, for display. */
export const REFERENCE_SOURCE = {
  citation: tableData.citation,
  retrieved: tableData.retrieved,
  geneticCode: tableData.geneticCode,
} as const;

/** Reference tables for the common expression hosts, all under the standard genetic code. */
export const REFERENCE_TABLES: readonly ReferenceTable[] = tableData.tables;

/** Tables with fewer coding sequences than this are flagged as small samples. */
export const SMALL_SAMPLE_CDS = 500;
