"""Downloads the public GenBank records used as test fixtures for the engine core and writes them as FASTA.

Run from the repository root:  .venv/bin/python -I scripts/oracle/fetch_core_fixtures.py
Writes tests/fixtures/core/<name>.fasta. Needs network access to eutils.ncbi.nlm.nih.gov.
"""

import io
import time
import urllib.parse
import urllib.request
from pathlib import Path

from Bio import SeqIO

OUT = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "core"
EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

# name -> (accession, what it is)
FIXTURES = {
    "puc19": ("L09137", "pUC19 cloning vector, 2686 bp, circular"),
    "pbr322": ("J01749", "pBR322 cloning vector, 4361 bp, circular"),
    "pegfp-n1": ("U55762", "pEGFP-N1 mammalian expression vector, 4733 bp, circular"),
    "pgex-4t-1": ("U13853", "pGEX-4T-1 GST fusion vector, 4969 bp, circular"),
    "phix174": ("J02482", "Escherichia phage phiX174, 5386 bp, circular genome"),
    "hbb-region": ("U01317", "Human beta-globin region on chromosome 11, 73308 bp"),
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (accession, label) in FIXTURES.items():
        query = urllib.parse.urlencode(
            {"db": "nuccore", "id": accession, "rettype": "gb", "retmode": "text", "tool": "gene-os"}
        )
        time.sleep(0.4)
        text = urllib.request.urlopen(f"{EFETCH}?{query}", timeout=120).read().decode()
        record = SeqIO.read(io.StringIO(text), "genbank")
        sequence = str(record.seq).upper()
        lines = [f">{record.id} {label}"] + [sequence[i : i + 70] for i in range(0, len(sequence), 70)]
        (OUT / f"{name}.fasta").write_text("\n".join(lines) + "\n")
        print(f"{name}: {record.id} {len(sequence)} bp")


if __name__ == "__main__":
    main()
