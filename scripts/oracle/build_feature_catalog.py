"""Builds src/data/features.json, the catalog of common cloning-vector parts that the feature detector searches for.

Every entry is read from an annotated feature of a public GenBank record (NCBI E-utilities, db=nuccore). The
manifest below names the record, the annotated feature to take and the type, name and description to give it.
No sequence is typed by hand, and no GPL-licensed database is used. The output records each entry's source
accession in `source`; scripts/oracle/feature_catalog_provenance.tsv records the record, coordinates and strand.

Short protein tags (His, FLAG, HA, ...) are stored as the protein translated from the annotated coding feature and
are detected by six-frame translated search.

Run from the repository root:  .venv/bin/python -I scripts/oracle/build_feature_catalog.py
Needs network access to eutils.ncbi.nlm.nih.gov. Raw records are cached under the system temp directory.
"""

import io
import json
import re
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from Bio import SeqIO
from Bio.Seq import Seq

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "features.json"
PROVENANCE = Path(__file__).resolve().parent / "feature_catalog_provenance.tsv"
CACHE = Path(tempfile.gettempdir()) / "gene-os-genbank"
EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

# (name, type, accession, GenBank feature key, regex on label/note/product/gene, kind, description)
# kind: "dna" stores the nucleotide sequence in the feature's own orientation; "protein" stores its translation.
PARTS = [
    # Promoters
    ("T7 promoter", "promoter", "KP223705", "regulatory", r"^T7 promoter$", "dna", "Bacteriophage T7 RNA polymerase promoter"),
    ("T3 promoter", "promoter", "AF013597", "regulatory", r"^T3 promoter", "dna", "Bacteriophage T3 RNA polymerase promoter"),
    ("SP6 promoter", "promoter", "X65304", "regulatory", r"^SP6 promoter$", "dna", "Bacteriophage SP6 RNA polymerase promoter"),
    ("lac promoter", "promoter", "LT726927", "regulatory", r"^lac promoter$", "dna", "E. coli lac operon promoter"),
    ("lacUV5 promoter", "promoter", "LT727255", "regulatory", r"^lacUV5 promoter$", "dna", "Mutant lac promoter, active without CAP"),
    ("tac promoter", "promoter", "JX310866", "regulatory", r"^tac promoter$", "dna", "Hybrid trp/lac promoter, IPTG inducible"),
    ("trc promoter", "promoter", "M22744", "regulatory", r"trc promoter", "dna", "Hybrid trp/lac promoter region of pTrc99A"),
    ("pBAD promoter", "promoter", "OR829915", "regulatory", r"^pBAD$", "dna", "E. coli araBAD promoter, arabinose inducible"),
    ("AmpR promoter", "promoter", "PX673705", "regulatory", r"AmpR promoter", "dna", "Promoter of the beta-lactamase gene"),
    ("lacI promoter", "promoter", "OL989372", "regulatory", r"lacI promoter", "dna", "Promoter of the lac repressor gene"),
    ("CMV promoter", "promoter", "PX673705", "regulatory", r"^CMV promoter$", "dna", "Human cytomegalovirus immediate early promoter"),
    ("SV40 promoter", "promoter", "OL870462", "regulatory", r"^SV40 promoter$", "dna", "Simian virus 40 early promoter"),
    ("EF-1 alpha promoter", "promoter", "LT727211", "regulatory", r"^hEF1 promoter$", "dna", "Human elongation factor 1 alpha promoter"),
    ("PGK promoter", "promoter", "LT726944", "regulatory", r"^mPGK1 promoter$", "dna", "Mouse phosphoglycerate kinase 1 promoter"),
    ("Ubiquitin C promoter", "promoter", "OL870462", "regulatory", r"human ubiquitin C promoter", "dna", "Human ubiquitin C promoter"),
    ("Synapsin promoter", "promoter", "HQ416701", "regulatory", r"human synapsin promoter", "dna", "Human synapsin I promoter, neuron specific"),
    ("U6 promoter", "promoter", "PZ629150", "regulatory", r"human U6", "dna", "Human U6 RNA polymerase III promoter"),
    ("ADH1 promoter", "promoter", "LT726927", "regulatory", r"^ADH1 promoter$", "dna", "Yeast alcohol dehydrogenase 1 promoter"),
    ("GAL1 promoter", "promoter", "OR992667", "regulatory", r"GAL1_promoter", "dna", "Yeast GAL1 promoter, galactose inducible"),
    ("TEF promoter", "promoter", "MG680580", "regulatory", r"^TEF$#0", "dna", "Yeast translation elongation factor promoter"),
    # Enhancers
    ("CMV enhancer", "enhancer", "PX673705", "regulatory", r"^CMV enhancer$", "dna", "Human cytomegalovirus immediate early enhancer"),
    ("SV40 enhancer", "enhancer", "OL870462", "regulatory", r"^SV40 enhancer$", "dna", "Simian virus 40 enhancer"),
    # Ribosome binding sites and translation signals
    ("RBS (B0034)", "RBS", "OR829930", "regulatory", r"^BBa_B0034$", "dna", "Strong E. coli ribosome binding site, BioBrick B0034"),
    ("RBS (B0033)", "RBS", "OR829915", "regulatory", r"^BBa_B0033$", "dna", "Weak E. coli ribosome binding site, BioBrick B0033"),
    ("Kozak sequence", "regulatory", "PZ629150", "regulatory", r"kozak", "dna", "Eukaryotic translation initiation consensus"),
    # Operators and protein binding sites
    ("lac operator", "protein_bind", "X65304", "misc_feature", r"^lac operator$", "dna", "LacI repressor binding site"),
    # Terminators and polyA signals
    ("T7 terminator", "terminator", "OL989372", "regulatory", r"terminator for bacteriophage T7", "dna", "Bacteriophage T7 transcription terminator"),
    ("rrnB T1 terminator", "terminator", "JX310866", "regulatory", r"^rrnB_T1_terminator$", "dna", "E. coli rrnB T1 transcription terminator"),
    ("rrnB T2 terminator", "terminator", "JX310866", "regulatory", r"^rrnB_T2_terminator$", "dna", "E. coli rrnB T2 transcription terminator"),
    ("rrnB terminator", "terminator", "JX310866", "regulatory", r"^rrnB_terminator$", "dna", "E. coli rrnB T1 and T2 terminator region"),
    ("B0015 double terminator", "terminator", "KP223705", "regulatory", r"^B0015$", "dna", "BioBrick B0015, rrnB T1 and T7 Te double terminator"),
    ("his operon terminator", "terminator", "OR829915", "misc_feature", r"^his operon terminator$", "dna", "E. coli his operon attenuator terminator"),
    ("ADH1 terminator", "terminator", "LT726927", "regulatory", r"^ADH1 terminator$", "dna", "Yeast ADH1 transcription terminator"),
    ("CYC1 terminator", "terminator", "OR992667", "regulatory", r"CYC1 terminator", "dna", "Yeast CYC1 transcription terminator"),
    ("NOS terminator", "terminator", "LC943656", "regulatory", r"nos terminator", "dna", "Agrobacterium nopaline synthase terminator"),
    ("bGH polyA signal", "polyA_signal", "MZ220611", "regulatory", r"bGH PA terminator", "dna", "Bovine growth hormone polyadenylation signal"),
    ("SV40 polyA signal", "polyA_signal", "OL870462", "regulatory", r"SV40 polyA signal", "dna", "Simian virus 40 polyadenylation signal"),
    ("HSV TK polyA signal", "polyA_signal", "LT726825", "regulatory", r"HSV-TK polyA", "dna", "Herpes simplex virus thymidine kinase polyadenylation signal"),
    ("WPRE", "regulatory", "OL870462", "regulatory", r"^WPRE$", "dna", "Woodchuck hepatitis virus post-transcriptional regulatory element"),
    # Replication origins
    ("pUC origin", "rep_origin", "OL989372", "rep_origin", r"colE1/pMB1/pBR322/pUC", "dna", "High-copy ColE1/pMB1 origin of replication, pUC variant"),
    ("f1 origin", "rep_origin", "OL989372", "rep_origin", r"f1 bacteriophage origin", "dna", "Filamentous phage f1 origin of replication"),
    ("SV40 origin", "rep_origin", "LT726825", "rep_origin", r"^SV40 ori$", "dna", "Simian virus 40 origin of replication"),
    ("p15A origin", "rep_origin", "LC760188", "rep_origin", r"p15A_ori", "dna", "p15A origin of replication, medium copy"),
    ("2 micron origin", "rep_origin", "LT726927", "rep_origin", r"^2mu ori$", "dna", "Yeast 2 micron plasmid origin"),
    # Antibiotic resistance markers
    ("AmpR (bla)", "resistance", "PX673705", "CDS", r"ampicillin", "dna", "TEM-1 beta-lactamase, ampicillin resistance"),
    ("KanR (aph(3')-Ia)", "resistance", "OL989372", "CDS", r"kanamycin", "dna", "Aminoglycoside 3'-phosphotransferase, kanamycin resistance"),
    ("NeoR/KanR (nptII)", "resistance", "PX673705", "CDS", r"neomycin", "dna", "Tn5 neomycin phosphotransferase, neomycin and kanamycin resistance"),
    ("CmR (cat)", "resistance", "LC760188", "CDS", r"chloramphenicol", "dna", "Chloramphenicol acetyltransferase"),
    ("TetR (tet)", "resistance", "J01749", "CDS", r"tetracycline resistance", "dna", "Tetracycline efflux protein of pBR322"),
    ("SpecR (aadA)", "resistance", "JX310868", "CDS", r"spectinomycin", "dna", "Streptomycin 3''-adenylyltransferase, spectinomycin and streptomycin resistance"),
    ("ZeoR (Sh ble)", "resistance", "JF327850", "CDS", r"zeocin", "dna", "Streptoalloteichus hindustanus bleomycin resistance, zeocin"),
    ("PuroR (pac)", "resistance", "PV631265", "CDS", r"puromycin", "dna", "Puromycin N-acetyltransferase"),
    # Epitope, purification and protease-site tags, as protein
    ("6xHis tag", "tag", "JF327850", "misc_feature", r"^6xHis tag$", "protein", "Hexahistidine purification tag"),
    ("FLAG tag", "tag", "LT726944", "misc_feature", r"^FLAG epitope$", "protein", "FLAG epitope tag, DYKDDDDK"),
    ("HA tag", "tag", "LT727257", "misc_feature", r"^HA epitope$", "protein", "Influenza hemagglutinin epitope tag, YPYDVPDYA"),
    ("Myc tag", "tag", "LT726927", "misc_feature", r"^Myc epitope$", "protein", "c-Myc epitope tag, EQKLISEEDL"),
    ("V5 tag", "tag", "PQ260749", "misc_feature", r"^V5 epitope", "protein", "V5 epitope tag, GKPIPNPLLGLDST"),
    ("Thrombin site", "tag", "U13853", "misc_feature", r"thrombin recognition", "protein", "Thrombin cleavage site, LVPRGS"),
    ("TEV site", "tag", "JF327850", "misc_feature", r"^TEV recognition site$", "protein", "Tobacco etch virus protease cleavage site"),
    ("PreScission site", "tag", "U78874", "misc_feature", r"prescission protease", "protein", "PreScission (HRV 3C) protease cleavage site"),
    # Tags and reporters that are longer genes
    ("GST", "tag", "U13853", "CDS", r"^glutathione S-transferase$", "dna", "Schistosoma japonicum glutathione S-transferase fusion tag"),
    ("EGFP", "CDS", "LT726825", "CDS", r"egfp", "dna", "Enhanced green fluorescent protein"),
    ("mCherry", "CDS", "KP223706", "CDS", r"^mCherry$", "dna", "mCherry red fluorescent protein"),
    ("Firefly luciferase (luc+)", "CDS", "U47295", "CDS", r"luciferase", "dna", "Photinus pyralis luciferase, codon optimised"),
    ("lacZ alpha", "CDS", "JX310868", "CDS", r"contains MCS", "dna", "beta-galactosidase alpha peptide for blue-white screening"),
    ("lacI", "CDS", "U13853", "CDS", r"lac repressor", "dna", "Lac repressor, lacIq allele"),
    ("araC", "CDS", "LC760188", "CDS", r"arabinose regulatory protein", "dna", "L-arabinose regulatory protein AraC"),
    ("rop", "CDS", "J01749", "CDS", r"ROP protein", "dna", "Rop, ColE1 copy number control protein"),
    # Other elements
    ("loxP", "misc_feature", "LC943656", "misc_recomb", r"^loxP$#0", "dna", "Cre recombinase recognition site"),
    ("HIV-1 5' LTR", "misc_feature", "OL870462", "repeat_region", r"^HIV-1_5_LTR$", "dna", "HIV-1 5' long terminal repeat"),
    ("HIV-1 RRE", "regulatory", "OL870462", "regulatory", r"^RRE$", "dna", "HIV-1 Rev response element"),
    ("pUC/pGEM MCS", "misc_feature", "X65304", "misc_feature", r"^multiple cloning sites$", "dna", "Multiple cloning site shared by pUC and pGEM vectors, EcoRI to HindIII"),
    ("pGEX-4T-1 MCS", "misc_feature", "U13853", "misc_feature", r"Multiple Cloning Site", "dna", "Multiple cloning site of pGEX-4T-1"),
]


# Entries whose neighbours differ by a point mutation or two need a tighter threshold than their length gives.
IDENTITY_OVERRIDES = {"lacUV5 promoter": 0.98}


def min_identity(length):
    """Identity needed for a hit. Short elements must match exactly, long ones may carry a few variants."""
    if length < 20:
        return 1.0
    if length < 40:
        return 0.95
    if length < 100:
        return 0.92
    return 0.9


def fetch(accessions):
    CACHE.mkdir(exist_ok=True)
    records = {}
    for accession in sorted(set(accessions)):
        path = CACHE / f"{accession}.gb"
        if not path.exists():
            query = urllib.parse.urlencode(
                {"db": "nuccore", "id": accession, "rettype": "gb", "retmode": "text", "tool": "gene-os"}
            )
            time.sleep(0.4)
            path.write_text(urllib.request.urlopen(f"{EFETCH}?{query}", timeout=90).read().decode())
        record = SeqIO.read(io.StringIO(path.read_text()), "genbank")
        records[accession] = record
    return records


def label_of(feature):
    q = feature.qualifiers
    parts = []
    for key in ("label", "standard_name", "gene", "product", "note"):
        parts.extend(q.get(key, []))
    return " | ".join(parts)


def select(record, key, pattern):
    """The one feature of type `key` whose label matches `pattern`; `pattern#N` takes the Nth of several."""
    pattern, _, nth = pattern.partition("#")
    hits = [f for f in record.features if f.type == key and re.search(pattern, label_of(f), re.I)]
    if nth and len(hits) > int(nth):
        return hits[int(nth)]
    if len(hits) != 1:
        found = "; ".join(f"{int(f.location.start) + 1}..{int(f.location.end)} {label_of(f)[:40]}" for f in hits)
        raise ValueError(f"{record.id}: {len(hits)} features of type {key} match /{pattern}/ (need exactly 1): {found}")
    return hits[0]


def main():
    records = fetch(p[2] for p in PARTS)
    entries, provenance, seen, problems = [], [], {}, []
    for name, ftype, accession, key, pattern, kind, description in PARTS:
        record = records[accession]
        try:
            feature = select(record, key, pattern)
        except ValueError as error:
            problems.append(f"{name}: {error}")
            continue
        dna = str(feature.extract(record.seq)).upper()
        if not re.fullmatch(r"[ACGT]+", dna):
            raise SystemExit(f"{name}: sequence has characters other than ACGT")
        if kind == "protein":
            sequence = str(Seq(dna).translate(table=1))
            if "*" in sequence or len(dna) % 3:
                raise SystemExit(f"{name}: annotated tag does not translate cleanly: {sequence}")
            alphabet, identity = "protein", 1.0 if len(sequence) < 12 else 0.9
        else:
            sequence, alphabet = dna, "dna"
            identity = IDENTITY_OVERRIDES.get(name, min_identity(len(dna)))
        if (sequence, alphabet) in seen:
            raise SystemExit(f"{name}: same sequence as {seen[(sequence, alphabet)]}")
        seen[(sequence, alphabet)] = name
        entries.append({
            "name": name,
            "type": ftype,
            "seq": sequence,
            "seqAlphabet": alphabet,
            "minIdentity": identity,
            "description": description,
            "source": record.id,
        })
        strand = "+" if feature.location.strand != -1 else "-"
        provenance.append(
            f"{name}\t{record.id}\t{int(feature.location.start) + 1}..{int(feature.location.end)}\t{strand}\t{feature.type}\t{label_of(feature)[:80]}"
        )
    if problems:
        raise SystemExit("\n".join(problems))
    entries.sort(key=lambda e: (e["type"], e["name"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(entries, indent=2) + "\n")
    PROVENANCE.write_text("name\trecord\tposition\tstrand\tfeature\tlabel\n" + "\n".join(sorted(provenance)) + "\n")
    print(f"wrote {len(entries)} entries to {OUT}")


if __name__ == "__main__":
    main()
