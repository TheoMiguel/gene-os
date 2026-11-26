"""Write tests/oracle/restriction.json: Bio.Restriction results for every catalog enzyme.

Run: .venv/bin/python -I scripts/oracle/restriction_goldens.py

Sequences: pUC19 (GenBank L09137, fetched once from NCBI and committed as a fixture) and seeded random
sequences, each as linear and circular. Values:
- `search`: Bio.Restriction `search` cut positions, converted to 0-based top-strand cut indices.
- `catalyse`: Bio.Restriction `catalyse` fragment lengths (top strand) on pUC19. Biopython 1.88 does not
  re-sort cut positions after wrapping them on a circular molecule, so for enzymes with a cut near the origin
  its circular fragments do not add up to the molecule length. Those entries are left out and printed; the
  `search` positions still cover the enzymes.
- `digests`: multi-enzyme digests; Biopython has no batch `catalyse`, so the fragment lengths come from the
  union of each enzyme's `search` positions.
"""

import json
import random
import urllib.request
from pathlib import Path

from Bio import Restriction
from Bio.Seq import Seq

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "restriction" / "pUC19_L09137.fasta"
GOLDEN = ROOT / "tests" / "oracle" / "restriction.json"
EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=L09137&rettype=fasta&retmode=text"

DIGESTS = [
    ["EcoRI", "HindIII"],
    ["BamHI", "PstI"],
    ["BsaI", "EcoRI"],
    ["AatII", "NdeI", "SspI"],
    ["MspI", "HaeIII"],
    ["EcoRI", "MluCI", "BsmBI"],
]


def puc19() -> str:
    if not FIXTURE.exists():
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(EFETCH, timeout=30) as response:
            FIXTURE.write_text(response.read().decode())
    lines = FIXTURE.read_text().splitlines()
    return "".join(line.strip() for line in lines if not line.startswith(">")).upper()


def random_sequences() -> dict[str, str]:
    rng = random.Random(20261125)
    seqs = {
        "random_3000": "".join(rng.choice("ACGT") for _ in range(3000)),
        "random_gc_1200": "".join(rng.choice("GGCCAT") for _ in range(1200)),
        "random_60": "".join(rng.choice("ACGT") for _ in range(60)),
    }
    with_n = list("".join(rng.choice("ACGT") for _ in range(2000)))
    for i in rng.sample(range(2000), 40):
        with_n[i] = "N"
    seqs["random_n_2000"] = "".join(with_n)
    return seqs


def search(enzyme, seq: str, linear: bool) -> list[int]:
    return sorted(position - 1 for position in enzyme.search(Seq(seq), linear=linear))


def fragment_lengths(cuts: list[int], length: int, linear: bool) -> list[int]:
    cuts = sorted(set(cuts))
    if not cuts:
        return [length]
    if linear:
        bounds = [0, *cuts, length]
        sizes = [b - a for a, b in zip(bounds, bounds[1:])]
    else:
        sizes = [b - a for a, b in zip(cuts, cuts[1:])] + [length - cuts[-1] + cuts[0]]
    return sorted(sizes)


def main() -> None:
    names = [e["name"] for e in json.loads((ROOT / "src" / "data" / "enzymes.json").read_text())]
    enzymes = [getattr(Restriction, name) for name in names]
    sequences = {"pUC19": puc19(), **random_sequences()}

    search_results = {}
    for seq_name, seq in sequences.items():
        for topology, linear in (("linear", True), ("circular", False)):
            search_results[f"{seq_name}/{topology}"] = {
                str(e): cuts for e in enzymes if (cuts := search(e, seq, linear))
            }

    catalyse = {}
    for topology, linear in (("linear", True), ("circular", False)):
        catalyse[topology] = {}
        for e in enzymes:
            lengths = sorted(len(f) for f in e.catalyse(Seq(sequences["pUC19"]), linear=linear))
            if sum(lengths) == len(sequences["pUC19"]) and 0 not in lengths:
                catalyse[topology][str(e)] = lengths
            else:
                print(f"  skipped catalyse {e} on {topology} pUC19: Biopython fragments {lengths[:6]}... are inconsistent")

    digests = []
    for combo in DIGESTS:
        for topology, linear in (("linear", True), ("circular", False)):
            cuts = [c for name in combo for c in search(getattr(Restriction, name), sequences["pUC19"], linear)]
            digests.append(
                {
                    "enzymes": combo,
                    "topology": topology,
                    "lengths": fragment_lengths(cuts, len(sequences["pUC19"]), linear),
                }
            )

    golden = {
        "source": "Biopython 1.88 Bio.Restriction",
        "sequences": {name: seq for name, seq in sequences.items() if name != "pUC19"},
        "search": search_results,
        "catalyse": catalyse,
        "digests": digests,
    }
    GOLDEN.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN.write_text(json.dumps(golden, separators=(",", ":")) + "\n")
    print(f"wrote {GOLDEN.relative_to(ROOT)}: {len(enzymes)} enzymes x {len(search_results)} sequence views")


if __name__ == "__main__":
    main()
