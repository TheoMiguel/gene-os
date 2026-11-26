import { alphafoldLink, blastpLink, externalLinks, MAX_LINK_RESIDUES, uniprotLink } from './externalLinks';

describe('links out', () => {
  it('puts the peptide in the BLASTp query and nowhere else', () => {
    const [blastp, uniprot, alphafold] = externalLinks('MKTAYIAKQR');
    const url = new URL((blastp as { href: string }).href);
    expect(url.origin).toBe('https://blast.ncbi.nlm.nih.gov');
    expect(url.searchParams.get('PROGRAM')).toBe('blastp');
    expect(url.searchParams.get('QUERY')).toBe('MKTAYIAKQR');
    expect((blastp as { carriesSequence: boolean }).carriesSequence).toBe(true);
    expect((uniprot as { href: string }).href).not.toContain('MKTAYIAKQR');
    expect((alphafold as { href: string }).href).not.toContain('MKTAYIAKQR');
  });

  it('opens the empty BLASTp form for a peptide too long for an address', () => {
    const link = blastpLink('M'.repeat(MAX_LINK_RESIDUES + 1));
    expect(link.carriesSequence).toBe(false);
    expect(link.href).not.toContain('QUERY');
  });

  it('searches UniProt and AlphaFold by name only when it is given, encoded', () => {
    expect(new URL(uniprotLink('P69905').href).searchParams.get('query')).toBe('P69905');
    expect(alphafoldLink('hemoglobin α/β').href).toBe(
      `https://alphafold.ebi.ac.uk/search/text/${encodeURIComponent('hemoglobin α/β')}`,
    );
    expect(uniprotLink().href).toBe('https://www.uniprot.org/blast');
    expect(alphafoldLink().href).toBe('https://alphafold.ebi.ac.uk/');
  });
});
