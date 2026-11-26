"""Build src/data/enzymes.json and src/data/suppliers.json from the REBASE data shipped with Biopython.

Run: .venv/bin/python -I scripts/oracle/build_enzyme_catalog.py

Every commercially available enzyme (Bio.Restriction.CommOnly) that cuts once per recognition site is kept.
Cut offsets follow the `Enzyme` convention in src/engine/types.ts: both offsets are top-strand positions
measured from the first base of the site, in the site's own orientation.

Biopython stores `fst5` (top-strand cut after the site start) and `fst3` (bottom-strand cut measured from the
end of the site), so `topCut = fst5` and `bottomCut = size + fst3`.
"""

import json
import sys
from pathlib import Path

from Bio import Restriction
from Bio.Restriction import Restriction_Dictionary

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "src" / "data"

COMPLEMENT = str.maketrans("ACGTRYSWKMBDHVN", "TGCAYRSWMKVHDBN")


def reverse_complement(site: str) -> str:
    return site.translate(COMPLEMENT)[::-1]


# Enzymes that cut only methylated or hydroxymethylated cytosine next to a short, highly degenerate site.
# On the unmodified DNA the app models they would "cut" every few bases. (DpnI and MalI also need methylated
# DNA but have a defined GATC site and are kept: users expect DpnI in site-directed mutagenesis.)
MODIFICATION_DEPENDENT = {"AbaSI", "FspEI", "LpnPI", "MspJI", "SgeI"}


def exclusion_reason(enzyme) -> str | None:
    if str(enzyme) in MODIFICATION_DEPENDENT:
        return f"modification-dependent (site {enzyme.site} on methylated or hydroxymethylated cytosine only)"
    if not enzyme.cut_once():
        return "two cuts per site"
    if not enzyme.is_defined() and enzyme.fst5 is None:
        return "unknown cut position"
    if enzyme.fst5 is None or enzyme.fst3 is None:
        return "unknown cut position"
    top, bottom = enzyme.fst5, enzyme.size + enzyme.fst3
    if reverse_complement(enzyme.site) == enzyme.site and top + bottom != enzyme.size:
        return "palindromic site with asymmetric cut offsets (cuts on both sides of the site)"
    return None


def to_enzyme(enzyme) -> dict:
    return {
        "name": str(enzyme),
        "site": enzyme.site,
        "topCut": enzyme.fst5,
        "bottomCut": enzyme.size + enzyme.fst3,
        "suppliers": sorted(enzyme.suppl),
    }


def assign_isoschizomer_groups(enzymes: list[dict]) -> None:
    """Members of a group share site and offsets; the key is the member sold by most suppliers."""
    groups: dict[tuple, list[dict]] = {}
    for e in enzymes:
        groups.setdefault((e["site"], e["topCut"], e["bottomCut"]), []).append(e)
    for members in groups.values():
        if len(members) < 2:
            continue
        key = min(members, key=lambda e: (-len(e["suppliers"]), e["name"]))["name"]
        for e in members:
            e["isoschizomerOf"] = key


def check_convention(by_name: dict[str, dict]) -> None:
    expected = {
        "EcoRI": ("GAATTC", 1, 5),  # G^AATTC, 5' overhang AATT
        "PstI": ("CTGCAG", 5, 1),  # CTGCA^G, 3' overhang TGCA
        "EcoRV": ("GATATC", 3, 3),  # GAT^ATC, blunt
        "BsaI": ("GGTCTC", 7, 11),  # GGTCTC(1/5), Type IIS, cuts outside the site
        "BbvCI": ("CCTCAGC", 2, 5),  # CC^TCAGC, asymmetric (non-palindromic) site
    }
    for name, (site, top, bottom) in expected.items():
        e = by_name[name]
        got = (e["site"], e["topCut"], e["bottomCut"])
        if got != (site, top, bottom):
            sys.exit(f"convention check failed for {name}: {got} != {(site, top, bottom)}")


def main() -> None:
    kept: list[dict] = []
    excluded: list[tuple[str, str]] = []
    for enzyme in sorted(Restriction.CommOnly, key=str):
        reason = exclusion_reason(enzyme)
        if reason:
            excluded.append((str(enzyme), reason))
        else:
            kept.append(to_enzyme(enzyme))

    assign_isoschizomer_groups(kept)
    check_convention({e["name"]: e for e in kept})

    used = {code for e in kept for code in e["suppliers"]}
    suppliers = {
        code: name for code, (name, _) in sorted(Restriction_Dictionary.suppliers.items()) if code in used
    }

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "enzymes.json").write_text("[\n" + ",\n".join(json.dumps(e) for e in kept) + "\n]\n")
    (DATA / "suppliers.json").write_text(json.dumps(suppliers, indent=1) + "\n")

    print(f"commercial enzymes: {len(Restriction.CommOnly)}; kept {len(kept)}; excluded {len(excluded)}")
    for name, reason in excluded:
        print(f"  excluded {name}: {reason}")


if __name__ == "__main__":
    main()
