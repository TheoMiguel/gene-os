"""Write src/data/matrices.json: the protein substitution matrices the aligner offers, read from Biopython.

Run: .venv/bin/python -I scripts/oracle/build_matrices.py

Each matrix keeps Biopython's full alphabet (20 amino acids, B, Z, X and the stop `*`), so the TypeScript
aligner scores ambiguous residues exactly as `Bio.Align.PairwiseAligner` does with the same matrix.
"""

import json
from pathlib import Path

import Bio
from Bio.Align import substitution_matrices

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "matrices.json"
NAMES = ["BLOSUM62", "BLOSUM45", "BLOSUM80", "PAM250"]


def main() -> None:
    matrices = {}
    for name in NAMES:
        m = substitution_matrices.load(name)
        letters = "".join(m.alphabet)
        values = [[m[a, b] for b in letters] for a in letters]
        assert all(float(v).is_integer() for row in values for v in row), name
        matrices[name] = {"letters": letters, "values": [[int(v) for v in row] for row in values]}
    OUT.write_text(json.dumps({"biopython": Bio.__version__, "matrices": matrices}, separators=(",", ":")) + "\n")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
