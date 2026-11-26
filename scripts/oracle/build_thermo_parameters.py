"""Write src/data/thermo-parameters.json: the nearest-neighbor tables used for hairpin and dimer energies.

Run: .venv/bin/python -I scripts/oracle/build_thermo_parameters.py

The values are the SantaLucia & Hicks (2004) DNA parameter set (Watson-Crick stacks, single mismatches, terminal
mismatches, dangling ends, loop entropies), read from the `primer3_config` folder
that primer3-py ships for its `thal` module. Enthalpy is cal/mol, entropy cal/(K mol); `null` marks a
combination that cannot form.

Table layout: four-base tables are flat arrays of 256 values indexed `((a * 4 + b) * 4 + c) * 4 + d` with bases
A=0, C=1, G=2, T=3, where `a b` is one strand 5'->3' and `c d` the facing bases of the other strand read 3'->5'.
`dangle3` and `dangle5` are 64-value arrays indexed `(a * 4 + b) * 4 + c` exactly as thal.c addresses them.
"""

import json
from pathlib import Path

import primer3

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(primer3.__file__).parent / "src" / "libprimer3" / "primer3_config"
OUT = ROOT / "src" / "data" / "thermo-parameters.json"


def values(name: str) -> list[float | None]:
    out = []
    for line in (CONFIG / name).read_text().split():
        out.append(None if line == "inf" else float(line))
    return out


def pair(dh: str, ds: str) -> dict:
    return {"dh": values(dh), "ds": values(ds)}


def dangles(name: str) -> tuple[list, list]:
    raw = values(name)
    d3 = [None] * 64
    d5 = [None] * 64
    for i in range(4):
        for j in range(4):
            for k in range(4):
                d3[(i * 4 + k) * 4 + j] = raw[(i * 4 + j) * 4 + k]
                d5[(i * 4 + j) * 4 + k] = raw[64 + (i * 4 + j) * 4 + k]
    return d3, d5


def loops(name: str) -> dict:
    rows = [line.split() for line in (CONFIG / name).read_text().splitlines() if line.strip()]
    parse = lambda v: None if v == "inf" else float(v)  # noqa: E731
    return {
        "interior": [parse(r[1]) for r in rows],
        "bulge": [parse(r[2]) for r in rows],
        "hairpin": [parse(r[3]) for r in rows],
    }


def main() -> None:
    d3h, d5h = dangles("dangle.dh")
    d3s, d5s = dangles("dangle.ds")
    params = {
        "source": "SantaLucia & Hicks (2004) Annu Rev Biophys Biomol Struct 33:415-440, via primer3-py "
        + primer3.__version__
        + " primer3_config",
        "stack": pair("stack.dh", "stack.ds"),
        "stackMismatch": pair("stackmm.dh", "stackmm.ds"),
        "terminalMismatch": pair("tstack.dh", "tstack_tm_inf.ds"),
        "hairpinMismatch": pair("tstack2.dh", "tstack2.ds"),
        "dangle3": {"dh": d3h, "ds": d3s},
        "dangle5": {"dh": d5h, "ds": d5s},
        "loopsDh": loops("loops.dh"),
        "loopsDs": loops("loops.ds"),
    }
    assert params["stack"]["dh"][15] == -7900.0  # AA/TT
    OUT.write_text(json.dumps(params, separators=(",", ":")) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
