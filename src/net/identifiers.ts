import type { ServiceId } from './types';

/** What the services accept as an identifier: letters, digits, dot, underscore and hyphen. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/;

/** GenBank and RefSeq nucleotide accessions: `U55762`, `AB123456`, `NC_001416.1`, `NZ_CP012345.1`. */
const NCBI_NUCLEOTIDE =
  /^(?:[A-Z]{1,2}\d{5,6}|[A-Z]{4,6}\d{8,10}|(?:AC|NC|NG|NM|NR|NT|NW|NZ|XM|XR)_[A-Z0-9]+)(?:\.\d+)?$/i;

/** NCBI protein accessions: `NP_000537.3`, `AAA12345.1`. */
const NCBI_PROTEIN = /^(?:(?:AP|NP|WP|XP|YP)_\d+|[A-Z]{3}\d{5,7})(?:\.\d+)?$/i;

/** The official UniProtKB accession pattern (uniprot.org/help/accession_numbers). */
const UNIPROT = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

/** True when `text` can go into a request URL as an identifier. */
export function isSafeIdentifier(text: string): boolean {
  return SAFE_IDENTIFIER.test(text);
}

/** True when `text` has the shape of an accession of any supported service. */
export function looksLikeIdentifier(text: string): boolean {
  const id = text.trim();
  return NCBI_NUCLEOTIDE.test(id) || NCBI_PROTEIN.test(id) || UNIPROT.test(id);
}

/**
 * The service an identifier most likely belongs to. Some accessions fit both NCBI and UniProt (`P42212`), and
 * then NCBI wins; the database view lets the user pick UniProt.
 */
export function guessService(text: string): ServiceId {
  const id = text.trim();
  if (NCBI_NUCLEOTIDE.test(id) || NCBI_PROTEIN.test(id)) return 'ncbi';
  return UNIPROT.test(id) ? 'uniprot' : 'ncbi';
}

/** The NCBI database that holds an accession: protein accessions live in `protein`, the rest in `nuccore`. */
export function ncbiDatabaseOf(id: string): 'nuccore' | 'protein' {
  return NCBI_NUCLEOTIDE.test(id) ? 'nuccore' : NCBI_PROTEIN.test(id) ? 'protein' : 'nuccore';
}
