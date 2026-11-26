"""Write tests/oracle/primers.json: primer3-py and Biopython results for the primer module.

Run: .venv/bin/python -I scripts/oracle/primer_goldens.py

- `tm`: primer3 `calc_tm` (default conditions and one non-default set), Biopython `Tm_NN` (defaults, and with
  Mg/dNTPs), `Tm_Wallace` and `Tm_GC` (defaults) on seeded random oligos, self-complementary oligos and one
  70-mer (primer3 switches to its long-sequence formula above 60 nt).
- `endStability`: primer3 3' end stability (`PRIMER_LEFT_0_END_STABILITY` from a `check_primers` run).
- `structures`: primer3 `calc_hairpin`, `calc_homodimer`, `calc_heterodimer` deltaG (kcal/mol, 37 C,
  default salt) on random oligos and on oligos built to fold or pair.
- `design`: primer3 `design_primers` on a pUC19 region with the constraints the TypeScript design uses.
"""

import json
import random
from pathlib import Path

import primer3
from Bio.SeqUtils import MeltingTemp

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "restriction" / "pUC19_L09137.fasta"
GOLDEN = ROOT / "tests" / "oracle" / "primers.json"

COMPLEMENT = str.maketrans("ACGT", "TGCA")


def rc(seq: str) -> str:
    return seq.translate(COMPLEMENT)[::-1]


def main() -> None:
    rng = random.Random(4242)

    def rand(n: int) -> str:
        return "".join(rng.choice("ACGT") for _ in range(n))

    oligos = [rand(rng.randint(15, 35)) for _ in range(120)]
    oligos += [(half := rand(rng.randint(5, 12))) + rc(half) for _ in range(10)]  # self-complementary
    oligos += ["".join(rng.choice("GC") for _ in range(20)), "".join(rng.choice("AT") for _ in range(24)), rand(70)]

    custom = {"mv_conc": 20.0, "dv_conc": 3.0, "dntp_conc": 0.8, "dna_conc": 250.0}
    tm = [
        {
            "seq": s,
            "primer3": primer3.calc_tm(s),
            "primer3Custom": primer3.calc_tm(s, **custom),
            "biopythonNN": MeltingTemp.Tm_NN(s),
            "biopythonNNMg": MeltingTemp.Tm_NN(s, Na=50, Mg=1.5, dNTPs=0.6),
            "wallace": MeltingTemp.Tm_Wallace(s),
            "gc": MeltingTemp.Tm_GC(s),
        }
        for s in oligos
    ]

    end_stability = []
    for s in oligos[:40]:
        result = primer3.design_primers(
            {"SEQUENCE_ID": "check", "SEQUENCE_PRIMER": s},
            {"PRIMER_TASK": "check_primers", "PRIMER_PICK_LEFT_PRIMER": 1, "PRIMER_PICK_RIGHT_PRIMER": 0,
             "PRIMER_MIN_SIZE": 10, "PRIMER_MAX_SIZE": 36, "PRIMER_MIN_TM": 0, "PRIMER_MAX_TM": 100,
             "PRIMER_MIN_GC": 0, "PRIMER_MAX_GC": 100, "PRIMER_MAX_POLY_X": 100, "PRIMER_MAX_SELF_ANY_TH": 100,
             "PRIMER_MAX_SELF_END_TH": 100, "PRIMER_MAX_HAIRPIN_TH": 100, "PRIMER_MAX_NS_ACCEPTED": 5,
             "PRIMER_PICK_ANYWAY": 1},
        )
        if "PRIMER_LEFT_0_END_STABILITY" in result:
            end_stability.append({"seq": s, "primer3": result["PRIMER_LEFT_0_END_STABILITY"]})

    folding = [rand(rng.randint(3, 8)) + (stem := rand(rng.randint(4, 8))) + rand(rng.randint(3, 8)) + rc(stem)
               + rand(rng.randint(0, 4)) for _ in range(60)]
    self_pairing = [(core := rand(rng.randint(6, 10))) + rand(rng.randint(2, 6)) + rc(core) for _ in range(40)]
    singles = [rand(rng.randint(18, 28)) for _ in range(150)] + folding + self_pairing
    pairs = [(rand(rng.randint(18, 28)), rand(rng.randint(18, 28))) for _ in range(150)]
    pairs += [(rand(rng.randint(6, 12)) + (tail := rand(rng.randint(5, 10))), rc(tail) + rand(rng.randint(8, 16)))
              for _ in range(50)]
    structures = {
        "hairpin": [{"seq": s, "dg": primer3.calc_hairpin(s).dg / 1000} for s in singles],
        "homodimer": [{"seq": s, "dg": primer3.calc_homodimer(s).dg / 1000} for s in singles],
        "heterodimer": [{"a": a, "b": b, "dg": primer3.calc_heterodimer(a, b).dg / 1000} for a, b in pairs],
    }

    template = "".join(l.strip() for l in FIXTURE.read_text().splitlines() if not l.startswith(">")).upper()
    target = {"start": 1200, "length": 300}
    settings = {
        "PRIMER_OPT_SIZE": 20, "PRIMER_MIN_SIZE": 18, "PRIMER_MAX_SIZE": 25,
        "PRIMER_OPT_TM": 60.0, "PRIMER_MIN_TM": 57.0, "PRIMER_MAX_TM": 63.0,
        "PRIMER_MIN_GC": 40.0, "PRIMER_MAX_GC": 60.0, "PRIMER_PAIR_MAX_DIFF_TM": 3.0,
        "PRIMER_PRODUCT_SIZE_RANGE": [[350, 600]], "PRIMER_NUM_RETURN": 5,
    }
    design = primer3.design_primers(
        {"SEQUENCE_ID": "pUC19", "SEQUENCE_TEMPLATE": template,
         "SEQUENCE_TARGET": [target["start"], target["length"]]},
        settings,
    )
    pairs_out = []
    for i in range(design["PRIMER_PAIR_NUM_RETURNED"]):
        pairs_out.append({
            "left": design[f"PRIMER_LEFT_{i}_SEQUENCE"],
            "right": design[f"PRIMER_RIGHT_{i}_SEQUENCE"],
            "leftTm": design[f"PRIMER_LEFT_{i}_TM"],
            "rightTm": design[f"PRIMER_RIGHT_{i}_TM"],
            "productSize": design[f"PRIMER_PAIR_{i}_PRODUCT_SIZE"],
            "penalty": design[f"PRIMER_PAIR_{i}_PENALTY"],
        })

    golden = {
        "source": f"primer3-py {primer3.__version__}, Biopython Bio.SeqUtils.MeltingTemp",
        "customConditions": custom,
        "tm": tm,
        "endStability": end_stability,
        "structures": structures,
        "design": {"target": target, "settings": settings, "pairs": pairs_out},
    }
    GOLDEN.write_text(json.dumps(golden, indent=None, separators=(",", ":")) + "\n")
    print(f"wrote {GOLDEN.relative_to(ROOT)}: {len(tm)} Tm cases, {len(end_stability)} end stabilities, "
          f"{len(singles)} hairpin/homodimer and {len(pairs)} heterodimer cases, {len(pairs_out)} designed pairs")


if __name__ == "__main__":
    main()
