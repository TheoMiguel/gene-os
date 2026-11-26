"""Write tests/oracle/codon.json: expected codon adaptation indexes from Biopython.

Run: .venv/bin/python -I scripts/oracle/codon_goldens.py

Each case holds a table of reference codon counts (some of them zero), a coding sequence without stop codons,
the relative adaptiveness of every codon and the index, all from `Bio.SeqUtils.CodonAdaptationIndex` (Biopython
1.88). The reference "genes" given to Biopython are each codon repeated as often as its count says, so Biopython's
own counting gives back the table. Biopython also counts a stop codon when the sequence has one; the app leaves
stop codons out, so the cases hold none.
"""

import itertools
import json
import random
from pathlib import Path

from Bio.SeqUtils import CodonAdaptationIndex

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / "tests" / "oracle" / "codon.json"
rng = random.Random(20261126)

CODONS = ["".join(c) for c in itertools.product("ACGT", repeat=3)]
STOPS = {"TAA", "TAG", "TGA"}


def case(zero_share: float) -> dict:
    counts = {c: 0 if rng.random() < zero_share else rng.randint(1, 60) for c in CODONS}
    reference = "".join(codon * n for codon, n in counts.items())
    index = CodonAdaptationIndex([reference])
    sense = [c for c in CODONS if c not in STOPS]
    sequence = "".join(rng.choice(sense) for _ in range(rng.randint(30, 120)))
    return {
        "counts": counts,
        "sequence": sequence,
        "w": {codon: index[codon] for codon in CODONS},
        "cai": index.calculate(sequence),
    }


def main() -> None:
    cases = [case(0.0), case(0.0), case(0.15), case(0.3)]
    GOLDEN.write_text(json.dumps({"biopython": "1.88", "cases": cases}, indent=1) + "\n")


if __name__ == "__main__":
    main()
