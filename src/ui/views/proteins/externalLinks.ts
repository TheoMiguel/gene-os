/** Longest peptide that goes into a BLAST link; longer ones would overflow what browsers and servers accept in a URL. */
export const MAX_LINK_RESIDUES = 2000;

/** A link the user clicks to open in a new tab. Nothing is requested until the click. */
export interface ExternalLink {
  readonly id: 'blastp' | 'uniprot' | 'alphafold';
  readonly href: string;
  /** True when the peptide is part of the address. */
  readonly carriesSequence: boolean;
}

/**
 * NCBI BLASTp page with the peptide filled in as the query. A peptide over `MAX_LINK_RESIDUES` opens the empty
 * form instead, and the user pastes the copied sequence.
 */
export function blastpLink(peptide: string): ExternalLink {
  const base =
    'https://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=blastp&PAGE_TYPE=BlastSearch&LINK_LOC=blasthome';
  const carriesSequence = peptide.length > 0 && peptide.length <= MAX_LINK_RESIDUES;
  return {
    id: 'blastp',
    href: carriesSequence ? `${base}&QUERY=${encodeURIComponent(peptide)}` : base,
    carriesSequence,
  };
}

/**
 * UniProt: a text search for `name` when the user's record has a name worth searching (a protein record), else
 * the UniProt BLAST page, where the user pastes the copied peptide.
 */
export function uniprotLink(name?: string): ExternalLink {
  return {
    id: 'uniprot',
    href: name
      ? `https://www.uniprot.org/uniprotkb?query=${encodeURIComponent(name)}`
      : 'https://www.uniprot.org/blast',
    carriesSequence: false,
  };
}

/** AlphaFold Protein Structure Database: a text search for `name`, or the database home page without one. */
export function alphafoldLink(name?: string): ExternalLink {
  return {
    id: 'alphafold',
    href: name
      ? `https://alphafold.ebi.ac.uk/search/text/${encodeURIComponent(name)}`
      : 'https://alphafold.ebi.ac.uk/',
    carriesSequence: false,
  };
}

/** The three links for one peptide. Pass `name` only for a record whose name identifies a protein. */
export function externalLinks(peptide: string, name?: string): readonly ExternalLink[] {
  return [blastpLink(peptide), uniprotLink(name), alphafoldLink(name)];
}
