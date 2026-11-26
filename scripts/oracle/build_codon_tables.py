"""Build src/data/codon-tables.json from the Codon Usage Database (Kazusa DNA Research Institute).

Run: python3 -I scripts/oracle/build_codon_tables.py

Source: https://www.kazusa.or.jp/codon/ (CUTG, "Codon Usage Tabulated from GenBank", GenBank Flat File
Release 160.0, 15 June 2007). Citation: Nakamura Y, Gojobori T, Ikemura T (2000) "Codon usage tabulated from
international DNA sequence databases: status for the year 2000", Nucleic Acids Res 28:292.

Each table stores the raw codon counts of the database entry, so every derived value (fraction, per thousand,
RSCU, relative adaptiveness) is computed in the app from the same numbers. Nothing here is estimated or
invented: a table whose page cannot be fetched or parsed stops the script.
"""

import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "codon-tables.json"

PAGE = "https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species={species}&aa=1&style=N"

# (id, display name, Kazusa species id, expression host it stands for)
ORGANISMS = [
    ("ecoli-k12", "Escherichia coli K-12 (W3110)", "316407", "E. coli K-12"),
    ("scerevisiae", "Saccharomyces cerevisiae", "4932", "S. cerevisiae"),
    ("human", "Homo sapiens", "9606", "Human"),
    ("cho", "Cricetulus griseus", "10029", "CHO"),
    ("ppastoris", "Pichia pastoris", "4922", "P. pastoris"),
    ("sfrugiperda", "Spodoptera frugiperda", "7108", "Insect (Sf9)"),
    ("dmelanogaster", "Drosophila melanogaster", "7227", "Insect (S2)"),
]

HEADER = re.compile(r"<STRONG><i>(?P<name>.+?)\s*</i>\s*\[(?P<division>\w+)\]:\s*(?P<cds>\d+) CDS's \((?P<codons>\d+) codons\)")
CELL = re.compile(r"\b([ACGU]{3}) ([A-Z*]) \d\.\d{2}\s+(\d+\.\d)\s+\(\s*(\d+)\)")


def fetch(species: str) -> str:
    request = urllib.request.Request(PAGE.format(species=species), headers={"User-Agent": "gene-os-codon-table-builder"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("iso-8859-1")


def parse(html: str) -> dict:
    header = HEADER.search(html)
    if not header:
        raise ValueError("header line not found")
    counts = {}
    printed = {}
    for triplet, _aa, per_thousand, count in CELL.findall(html):
        codon = triplet.replace("U", "T")
        counts[codon] = int(count)
        printed[codon] = float(per_thousand)
    if len(counts) != 64:
        raise ValueError(f"expected 64 codons, parsed {len(counts)}")
    total = sum(counts.values())
    if total != int(header["codons"]):
        raise ValueError(f"counts sum to {total}, header says {header['codons']}")
    for codon, count in counts.items():
        if abs(1000 * count / total - printed[codon]) > 0.06:
            raise ValueError(f"{codon}: count {count} gives {1000 * count / total:.2f} per thousand, page prints {printed[codon]}")
    return {
        "entry": header["name"],
        "division": header["division"],
        "cds": int(header["cds"]),
        "codons": total,
        "counts": dict(sorted(counts.items())),
    }


def main() -> int:
    tables = []
    for key, name, species, host in ORGANISMS:
        parsed = parse(fetch(species))
        tables.append(
            {
                "id": key,
                "name": name,
                "host": host,
                "source": "Codon Usage Database (CUTG), Kazusa DNA Research Institute, GenBank release 160.0",
                "url": PAGE.format(species=species),
                "speciesId": species,
                **parsed,
            }
        )
        print(f"{key}: {parsed['entry']} {parsed['cds']} CDS, {parsed['codons']} codons")
    document = {
        "citation": "Nakamura Y, Gojobori T, Ikemura T (2000) Nucleic Acids Res 28:292",
        "retrieved": date.today().isoformat(),
        "geneticCode": 1,
        "tables": tables,
    }
    OUT.write_text(json.dumps(document, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
