# Sequence file fixtures

Real test files from the Biopython repository, used to check the GENE_OS readers and writers against
`Bio.SeqIO` (see `scripts/oracle/format_goldens.py` and `tests/oracle/formats.json`).

Source: <https://github.com/biopython/biopython>, folder `Tests/`, commit
`86e9ea56dbd67f51565fc9566e4f87a888f94454` (2026-11-24). Files are copied unchanged. One FASTA file got an
extension so that the oracle knows its format: `f002` became `f002.fasta`.

| File                                       | Origin in `Tests/`                                 | What it covers                                                             |
| ------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------- |
| `NC_005816.gb`                             | `GenBank/NC_005816.gb`                             | Circular plasmid pPCP1, `order(...)`, partial ends `<` and `>`, complement |
| `pBAD30.gb`                                | `GenBank/pBAD30.gb`                                | Circular cloning vector, no ACCESSION line                                 |
| `addgene-plasmid-39296-sequence-49545.gbk` | `GenBank/addgene-plasmid-39296-sequence-49545.gbk` | Addgene plasmid, `ds-DNA`, origin-wrapping features written as `3922..2`   |
| `arab1.gb`                                 | `GenBank/arab1.gb`                                 | 86 kb genomic record, many `join(...)` and `complement(join(...))`         |
| `cor6_6.gb`                                | `GenBank/cor6_6.gb`                                | Six records in one file, joins, partial ends                               |
| `protein_refseq2.gb`                       | `GenBank/protein_refseq2.gb`                       | Protein GenBank (GenPept) record                                           |
| `1MRR_A.gp`                                | `GenBank/1MRR_A.gp`                                | Protein record with `bond(...)` and `order(...)` locations                 |
| `one_of.gb`                                | `GenBank/one_of.gb`                                | `one-of(...)` positions and parts on remote accessions                     |
| `bad_origin_wrap.gb`                       | `GenBank/bad_origin_wrap.gb`                       | Circular record without sequence data (CON-like)                           |
| `bad_origin_wrap_CDS.gb`                   | `GenBank/bad_origin_wrap_CDS.gb`                   | Circular record, CDS across the origin written as `238..50`                |
| `iro.gb`                                   | `GenBank/iro.gb`                                   | mRNA record                                                                |
| `KF527485.gbk`                             | `GenBank/KF527485.gbk`                             | cRNA virus segment with partial ends                                       |
| `gbvrl1_start.seq`                         | `GenBank/gbvrl1_start.seq`                         | GenBank release file: a file header before the first LOCUS, three records  |
| `AE017046.embl`                            | `EMBL/AE017046.embl`                               | Circular plasmid pPCP1 in EMBL                                             |
| `TRBG361.embl`                             | `EMBL/TRBG361.embl`                                | Current EMBL ID line, mRNA                                                 |
| `U87107.embl`                              | `EMBL/U87107.embl`                                 | Old EMBL ID line, synthetic vector                                         |
| `SC10H5.embl`                              | `EMBL/SC10H5.embl`                                 | Old EMBL ID line, partial ends, complement                                 |
| `location_wrap.embl`                       | `EMBL/location_wrap.embl`                          | Location that wraps onto the next line without a comma                     |
| `epo_prt_selection.embl`                   | `EMBL/epo_prt_selection.embl`                      | Nine protein records                                                       |
| `DD231055_edited.embl`                     | `EMBL/DD231055_edited.embl`                        | Patent record                                                              |
| `AAA03323.embl`                            | `EMBL/AAA03323.embl`                               | Unassigned DNA                                                             |
| `sample-d.dna`                             | `SnapGene/sample-d.dna`                            | Linear SnapGene file with notes                                            |
| `sample-e.dna`                             | `SnapGene/sample-e.dna`                            | Circular SnapGene file, reverse-strand feature                             |
| `pFA-KanMX4.dna`                           | `SnapGene/pFA-KanMX4.dna`                          | Real plasmid map, no notes packet                                          |
| `looped_feature_origin.dna`                | `SnapGene/looped_feature_origin.dna`               | Feature that crosses the origin                                            |
| `linebreak_in_qualifier_text.dna`          | `SnapGene/linebreak_in_qualifier_text.dna`         | Qualifier text with line breaks and HTML                                   |
| `sample-hybridization-params.dna`          | `SnapGene/sample-hybridization-params.dna`         | Primers packet with hybridization parameters                               |
| `310.ab1`                                  | `Abi/310.ab1`                                      | ABI 310 Sanger trace                                                       |
| `3100.ab1`                                 | `Abi/3100.ab1`                                     | ABI 3100 Sanger trace                                                      |
| `3730.ab1`                                 | `Abi/3730.ab1`                                     | ABI 3730 Sanger trace                                                      |
| `no_smpl1.ab1`                             | `Abi/no_smpl1.ab1`                                 | Trace without a sample name tag                                            |
| `fake.ab1`                                 | `Abi/fake.ab1`                                     | Text file with an `.ab1` extension (must be refused)                       |
| `f002.fasta`                               | `Fasta/f002`                                       | Three nucleotide records                                                   |
| `elderberry.nu`                            | `Fasta/elderberry.nu`                              | One nucleotide record                                                      |
| `aster.pro`                                | `Fasta/aster.pro`                                  | One protein record                                                         |
| `dups.fasta`                               | `Fasta/dups.fasta`                                 | Records with duplicate identifiers                                         |

## License

These files are part of the Biopython distribution. Biopython is released under the "Biopython License
Agreement" and, for most files, also the "BSD 3-Clause License" (the user's choice). Both licenses allow
redistribution with the copyright notice. The full text is in
<https://github.com/biopython/biopython/blob/master/LICENSE.rst>. The sequence data themselves come from public
databases (GenBank, EMBL, RefSeq) or were contributed to Biopython as test data.

## Checks

- `src/formats/oracle.test.ts` compares every reader result with `tests/oracle/formats.json`, which
  `.venv/bin/python -I scripts/oracle/format_goldens.py` writes from `Bio.SeqIO`.
- The writers are checked by Biopython too, locally (CI has no Python):

  ```bash
  FORMATS_EXPORT_DIR=/tmp/gene-os-writes pnpm vitest run src/formats/writer-export.test.ts
  .venv/bin/python -I scripts/oracle/format_goldens.py --check-writes /tmp/gene-os-writes
  ```
