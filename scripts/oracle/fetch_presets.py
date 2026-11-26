"""Downloads the example sequences GENE_OS ships (spec 6.2) from public records and writes them to src/data/presets/.

Run from the repository root:  .venv/bin/python -I scripts/oracle/fetch_presets.py
Needs network access to eutils.ncbi.nlm.nih.gov and raw.githubusercontent.com.

Each NCBI record is written as GenBank text exactly as efetch returns it. A record that cannot be obtained
from a citable public source is not listed here: pET-28a(+) and pETDuet-1 have no vector record in INSDC
(only patent copies without annotation and derivative constructs), and Addgene sequence files need a login.
manifest.json records the accession, the source URL, the region and the size of every preset.
"""

import hashlib
import io
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

from Bio import SeqIO

OUT = Path(__file__).resolve().parents[2] / "src" / "data" / "presets"
EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
BIOPYTHON_COMMIT = "86e9ea56dbd67f51565fc9566e4f87a888f94454"
AB1_URL = f"https://raw.githubusercontent.com/biopython/biopython/{BIOPYTHON_COMMIT}/Tests/Abi/3100.ab1"

# id, display name, accession.version, optional (start, stop) region, description
NCBI_PRESETS = [
    ("puc19", "pUC19", "M77789.2", None, "High-copy cloning vector with the lacZ-alpha MCS and ampicillin resistance."),
    ("pbr322", "pBR322", "J01749.1", None, "Classic E. coli cloning vector with ampicillin and tetracycline resistance."),
    ("lambda", "Lambda phage", "NC_001416.1", None, "Enterobacteria phage lambda reference genome, 48.5 kb, linear."),
    ("egfp", "EGFP", "U55762.1", (679, 1398), "Enhanced GFP coding sequence, cut from the pEGFP-N1 record."),
    ("gfp", "GFP (A. victoria)", "M62653.1", None, "Wild-type Aequorea victoria green fluorescent protein mRNA."),
    ("pcdna3.1", "pcDNA3.1(+)", "MN996867.1", None, "Mammalian expression vector. The record annotates the resistance gene only."),
    ("pgex-4t-1", "pGEX-4T-1", "U13853.1", None, "GST fusion vector with a thrombin site, for E. coli."),
    ("petduet-1-gfp", "pETDuet-1-GFP", "PP098727.1", None, "pETDuet-1 two-gene expression vector carrying GFP in its first site."),
]


def fetch_genbank(accession, region):
    params = {"db": "nuccore", "id": accession, "rettype": "gb", "retmode": "text", "tool": "gene-os"}
    if region:
        params["seq_start"], params["seq_stop"] = region
    url = f"{EFETCH}?{urllib.parse.urlencode(params)}"
    time.sleep(0.5)
    return url, urllib.request.urlopen(url, timeout=120).read().decode()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    retrieved = time.strftime("%Y-%m-%d", time.gmtime())
    for preset_id, name, accession, region, description in NCBI_PRESETS:
        url, text = fetch_genbank(accession, region)
        record = SeqIO.read(io.StringIO(text), "genbank")
        (OUT / f"{preset_id}.gb").write_text(text)
        manifest.append(
            {
                "id": preset_id,
                "name": name,
                "format": "genbank",
                "file": f"{preset_id}.gb",
                "accession": accession,
                "region": f"{region[0]}..{region[1]}" if region else None,
                "source": "NCBI Nucleotide (efetch)",
                "url": url,
                "retrieved": retrieved,
                "length": len(record.seq),
                "topology": record.annotations.get("topology", "linear"),
                "features": len(record.features),
                "description": description,
            }
        )
        print(f"{preset_id}: {accession} {len(record.seq)} bp, {len(record.features)} features")

    ab1 = urllib.request.urlopen(AB1_URL, timeout=120).read()
    (OUT / "sanger-16s-read.ab1").write_bytes(ab1)
    trace = SeqIO.read(io.BytesIO(ab1), "abi")
    manifest.append(
        {
            "id": "sanger-read",
            "name": "Sanger read (16S rRNA)",
            "format": "ab1",
            "file": "sanger-16s-read.ab1",
            "accession": None,
            "region": None,
            "source": f"Biopython test suite, Tests/Abi/3100.ab1 at commit {BIOPYTHON_COMMIT}",
            "url": AB1_URL,
            "retrieved": retrieved,
            "length": len(trace.seq),
            "topology": "linear",
            "features": 0,
            "sha256": hashlib.sha256(ab1).hexdigest(),
            "description": "ABI 3100 trace of a 16S rRNA reverse read, 795 bases with the chromatogram.",
        }
    )
    print(f"sanger-read: {len(trace.seq)} bases")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
