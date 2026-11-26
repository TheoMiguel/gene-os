"""Write tests/oracle/cloning.json: expected cloning constructs built outside the TypeScript engine.

Run: .venv/bin/python -I scripts/oracle/cloning_goldens.py

Restriction and ligation, Golden Gate: every digest is a Bio.Restriction `catalyse` call (Biopython 1.88) and the
join is manual in Python (top strands of the fragments, matched by overhang). Gibson, In-Fusion, Gateway and TOPO:
the expected product is assembled by string surgery from the same inputs. Sequences are seeded random, plus pUC19
(GenBank L09137, a committed fixture) as the vector. Each case stores its inputs, so the TypeScript test runs the
same inputs through the engine and compares the sequences (as circular molecules, up to rotation).
"""

import json
import random
from pathlib import Path

from Bio import Restriction
from Bio.Seq import Seq

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "restriction" / "pUC19_L09137.fasta"
GOLDEN = ROOT / "tests" / "oracle" / "cloning.json"
CLAMP = "GTAGTA"
rng = random.Random(20261126)


def rc(seq: str) -> str:
    return str(Seq(seq).reverse_complement())


def rand(n: int, avoid: tuple[str, ...] = ()) -> str:
    while True:
        s = "".join(rng.choice("ACGT") for _ in range(n))
        if not any(site in s or rc(site) in s for site in avoid):
            return s


def puc19() -> str:
    lines = FIXTURE.read_text().splitlines()
    return "".join(line.strip() for line in lines if not line.startswith(">")).upper()


def enzyme(name: str):
    return getattr(Restriction, name)


def site_avoid(names: list[str]) -> tuple[str, ...]:
    return tuple(str(enzyme(n).site) for n in names)


def digest(seq: str, names: list[str], circular: bool) -> list[str]:
    """Sequential Bio.Restriction digests; the first one may act on a circle."""
    fragments = [seq]
    for index, name in enumerate(names):
        nxt: list[str] = []
        for fragment in fragments:
            nxt += [str(f) for f in enzyme(name).catalyse(Seq(fragment), linear=not (circular and index == 0))]
        fragments = nxt
    return fragments


def top_cuts(seq: str, name: str) -> list[int]:
    return [p - 1 for p in enzyme(name).search(Seq(seq), linear=True)]


def bottom_shift(name: str) -> int:
    """Bottom-strand cut minus top-strand cut, in top-strand coordinates (+k for a 5' overhang)."""
    return -enzyme(name).ovhg


# ---------------------------------------------------------------------------
# Restriction and ligation
# ---------------------------------------------------------------------------

def restriction_cases(vector: str) -> list[dict]:
    cases = []
    layouts = [
        ("EcoRI+BamHI", ["EcoRI", "BamHI"]),
        ("HindIII", ["HindIII"]),
        ("SmaI blunt", ["SmaI"]),
        ("SacI+KpnI 3' overhang", ["SacI", "KpnI"]),
    ]
    for label, names in layouts:
        for mode in ("digest", "amplify"):
            payload = rand(rng.randint(400, 700), site_avoid(names))
            order = sorted(names, key=lambda n: top_cuts(vector, n)[0])
            left, right = order[0], order[-1]
            if mode == "digest":
                insert_seq = CLAMP + str(enzyme(left).site) + payload + str(enzyme(right).site) + CLAMP
                region = None
                product = insert_seq
            else:
                flank_l, flank_r = rand(90), rand(90)
                insert_seq = flank_l + payload + flank_r
                region = {"start": 90, "length": len(payload)}
                product = CLAMP + str(enzyme(left).site) + payload + rc(CLAMP + str(enzyme(right).site))
            vector_fragments = digest(vector, names, True)
            backbone = max(vector_fragments, key=len)
            insert_fragments = digest(product, order if len(order) > 1 else names * 2, False)
            if len(names) == 1:
                insert_fragments = digest(product, names, False)
            middle = insert_fragments[1]
            cuts = sorted(c for n in names for c in top_cuts(product, n))
            lo, hi = cuts[0], cuts[-1]
            shift_l = bottom_shift(left)
            shift_r = bottom_shift(right)
            flipped = rc(product[lo + shift_l : hi + shift_r])
            same_ends = len(names) == 1
            forward = backbone + middle
            assert middle == product[lo:hi]
            cases.append(
                {
                    "label": f"{label} ({mode})",
                    "enzymes": names,
                    "mode": mode,
                    "insertSeq": insert_seq,
                    "region": region,
                    "forward": forward,
                    "reverse": backbone + flipped if same_ends else None,
                    "backboneLength": len(backbone),
                    "insertLength": len(middle),
                }
            )
    return cases


# ---------------------------------------------------------------------------
# Gibson and In-Fusion
# ---------------------------------------------------------------------------

def homology_cases(vector: str) -> list[dict]:
    enzymes = ["EcoRI", "BamHI"]
    backbone = max(digest(vector, enzymes, True), key=len)
    cases = []

    specs = [
        ("gibson", 30, [("linear", 1, 500), ("linear", 1, 350)]),
        ("gibson", 25, [("linear", -1, 420)]),
        ("in_fusion", 15, [("linear", 1, 600)]),
        ("gibson", 40, [("circular_wrap", 1, 300), ("linear", 1, 280), ("linear", -1, 310)]),
    ]
    for method, overlap, inserts in specs:
        built = []
        expected = backbone
        for kind, strand, size in inserts:
            payload = rand(size)
            if kind == "linear":
                left, right = rand(100), rand(100)
                seq = left + payload + right
                region = {"start": 100, "length": size}
                topology = "linear"
            else:
                tail = size // 2
                seq = payload[tail:] + rand(1000 - size) + payload[:tail]
                region = {"start": 1000 - tail, "length": size}
                topology = "circular"
                assert (seq + seq)[region["start"] : region["start"] + size] == payload
            built.append({"seq": seq, "topology": topology, "region": region, "strand": strand})
            expected += payload if strand == 1 else rc(payload)
        cases.append(
            {
                "method": method,
                "overlap": overlap,
                "vectorEnzymes": enzymes,
                "inserts": built,
                "expected": expected,
                "backbone": backbone,
            }
        )
    # Vector opened by removing a region instead of an enzyme digest.
    payload = rand(450)
    seq = rand(100) + payload + rand(100)
    cut_a, cut_b = 1500, 1560
    cases.append(
        {
            "method": "gibson",
            "overlap": 30,
            "vectorRemove": {"start": cut_a, "length": cut_b - cut_a},
            "inserts": [{"seq": seq, "topology": "linear", "region": {"start": 100, "length": 450}, "strand": 1}],
            "expected": vector[cut_b:] + vector[:cut_a] + payload,
            "backbone": vector[cut_b:] + vector[:cut_a],
        }
    )
    return cases


# ---------------------------------------------------------------------------
# Golden Gate
# ---------------------------------------------------------------------------

GEOMETRY = {"BsaI": (1, 4), "BsmBI": (1, 4), "Esp3I": (1, 4), "BbsI": (2, 4), "SapI": (1, 3)}


def amplicon(name: str, region: str, o_in: str, o_out: str, add_in: bool) -> str:
    spacer, _ = GEOMETRY[name]
    site = str(enzyme(name).site)
    return CLAMP + site + "A" * spacer + (o_in if add_in else "") + region + o_out + rc(CLAMP + site + "A" * spacer)


def join_by_overhang(pieces: list[dict], k: int) -> str:
    """Join digest cores into a circle by matching right overhang to left overhang, starting from piece 0."""
    order = [pieces[0]]
    rest = pieces[1:]
    while rest:
        want = order[-1]["right"]
        match = [p for p in rest if p["left"] == want]
        assert len(match) == 1, "overhang order is not unique"
        order.append(match[0])
        rest.remove(match[0])
    assert order[-1]["right"] == order[0]["left"], "circle does not close"
    return "".join(p["top"] for p in order), [p["name"] for p in order]


def golden_gate_cases() -> list[dict]:
    cases = []
    layouts = [
        ("BsaI", "scar", "pcr", ["AATG", "GCTT", "CGAC"]),
        ("BsmBI", "scar", "pcr", ["TGCC", "ACTA", "CAGA"]),
        ("BbsI", "scar", "pcr", ["GGAG", "TACT", "AGGT"]),
        ("SapI", "scar", "pcr", ["ATG", "GCT", "CGT"]),
        ("Esp3I", "scar", "pcr", ["TTAC", "GACG", "AGCA"]),
        ("BsaI", "native", "pcr", None),
        ("BsaI", "scar", "digest", ["AATG", "GCTT", "CGAC"]),
        ("BbsI", "scar", "digest", ["GGAG", "TACT", "AGGT"]),
    ]
    for name, style, vector_mode, overhangs in layouts:
        site = str(enzyme(name).site)
        spacer, k = GEOMETRY[name]
        parts = [rand(rng.randint(250, 450), (site,)) for _ in range(2)]
        vector_region = rand(900, (site,))
        if style == "native":
            # junction j overhang = first k bases of the part after it: V->P1, P1->P2, P2->V
            nexts = [parts[0], parts[1], vector_region]
            overhangs = [s[:k] for s in nexts]
        if vector_mode == "digest":
            o_left, o_right = overhangs[0], overhangs[-1]
            # top: bb_left + O_L + spacer + rc(site) + filler + site + spacer + O_R + bb_right
            bb_left, bb_right = rand(500, (site,)), rand(500, (site,))
            filler = rand(300, (site,))
            vector_seq = (
                bb_left + o_left + "A" * spacer + rc(site) + filler + site + "A" * spacer + o_right + bb_right
            )
            fragments = [str(f) for f in enzyme(name).catalyse(Seq(vector_seq), linear=False)]
            assert len(fragments) == 2
            backbone = max(fragments, key=len)
            dropout = min(fragments, key=len)
            vec_piece = {"name": "vector", "top": backbone, "left": backbone[:k], "right": dropout[:k]}
        else:
            vector_seq = vector_region
            v_amp = amplicon(name, vector_region, overhangs[2], overhangs[0], style == "scar")
            f = [str(x) for x in enzyme(name).catalyse(Seq(v_amp), linear=True)]
            assert len(f) == 3
            vec_piece = {"name": "vector", "top": f[1], "left": f[1][:k], "right": f[2][:k]}
        pieces = [vec_piece]
        amps = []
        for i, part in enumerate(parts):
            o_in, o_out = overhangs[i], overhangs[i + 1]
            amp = amplicon(name, part, o_in, o_out, style == "scar")
            f = [str(x) for x in enzyme(name).catalyse(Seq(amp), linear=True)]
            assert len(f) == 3, (name, len(f))
            pieces.append({"name": f"part{i + 1}", "top": f[1], "left": f[1][:k], "right": f[2][:k]})
            amps.append(amp)
        expected, order = join_by_overhang(pieces, k)
        assert order == ["vector", "part1", "part2"], order
        cases.append(
            {
                "enzyme": name,
                "style": style,
                "vectorMode": vector_mode,
                "overhangs": None if style == "native" else overhangs,
                "vector": vector_seq,
                "vectorRegion": {"start": 0, "length": len(vector_seq)},
                "parts": parts,
                "expected": expected,
                "overhangLength": k,
            }
        )
    return cases


# ---------------------------------------------------------------------------
# Gateway
# ---------------------------------------------------------------------------

ATT = json.loads((ROOT / "src" / "data" / "cloning-att-sites.json").read_text())
WINDOW = {s["variant"]: s["attB"][ATT["crossover"]["start"] : ATT["crossover"]["start"] + ATT["crossover"]["length"]] for s in ATT["sites"]}
ATTB = {s["variant"]: s["attB"] for s in ATT["sites"]}


def att_form(variant: int, sign: int) -> str:
    """A synthetic att site: random arms around the real crossover window, read on the strand `sign`."""
    while True:
        form = rand(24) + WINDOW[variant] + rand(24)
        hits = sum(form.count(w) + form.count(rc(w)) for w in WINDOW.values())
        if hits == 1:
            return form if sign > 0 else rc(form)


def gateway_cases() -> list[dict]:
    cases = []
    windows = tuple(WINDOW.values())
    global rand
    plain_rand = rand

    def rand(n: int, avoid: tuple[str, ...] = ()) -> str:  # noqa: F811 - att windows never appear by chance
        return plain_rand(n, avoid + windows)

    ccdb = rand(400)
    # BP: attB1-gene-attB2 PCR product into a donor with attP1 ... ccdB ... attP2
    bb = rand(1200)
    p1, p2 = att_form(1, 1), att_form(2, -1)
    donor = bb[:600] + p1 + rand(30) + ccdb + rand(30) + p2 + bb[600:]
    p1_at = donor.index(p1)
    p2_at = donor.index(p2)
    ccdb_at = donor.index(ccdb)
    gene = rand(500)
    product = "GGGG" + ATTB[1] + gene + rc("GGGG" + ATTB[2])
    w1 = WINDOW[1]
    w2rc = rc(WINDOW[2])
    d1 = donor.index(w1)
    d2 = donor.index(w2rc)
    q1 = product.index(w1)
    q2 = product.index(w2rc)
    backbone_arc = donor[d2:] + donor[: d1 + 9]
    insert_arc = product[q1 : q2 + 9]
    expected = backbone_arc + insert_arc[9:-9]
    cases.append(
        {
            "reaction": "BP",
            "vector": {"seq": donor, "ccdb": {"start": ccdb_at, "end": ccdb_at + len(ccdb)}},
            "inserts": [{"seq": gene, "attB": [1, 2], "region": {"start": 0, "length": len(gene)}}],
            "expected": expected,
            "attL1Right": w1 + ATTB[1][18:] ,
            "geneStart": gene[:12],
        }
    )
    # LR, three entry clones into a destination, the MultiSite shape. Along the product the sites read
    # +4, +1, -2, -3 (sign = strand the site's window reads on), as the Pro user guide's expression clone shows.
    def entry(left_v, left_s, right_v, right_s, insert_len):
        insert = rand(insert_len)
        backbone = rand(900)
        seq = backbone[:300] + att_form(left_v, left_s) + insert + att_form(right_v, right_s) + backbone[300:]
        return seq

    def probe(variant, sign):
        return WINDOW[variant] if sign > 0 else rc(WINDOW[variant])

    e1 = entry(4, 1, 1, 1, 350)
    e2 = entry(1, 1, 2, -1, 420)
    e3 = entry(2, -1, 3, -1, 380)
    dbb = rand(1500)
    dest = dbb[:700] + att_form(4, 1) + rand(30) + ccdb + rand(30) + att_form(3, -1) + dbb[700:]
    d_ccdb = dest.index(ccdb)

    def arc(seq, left, right):
        a = seq.index(probe(*left))
        b = seq.index(probe(*right))
        return seq[a : b + 9]

    backbone_arc = dest[dest.index(probe(3, -1)) :] + dest[: dest.index(probe(4, 1)) + 9]
    chain = arc(e1, (4, 1), (1, 1))
    for seq, left, right in ((e2, (1, 1), (2, -1)), (e3, (2, -1), (3, -1))):
        chain = chain[:-9] + arc(seq, left, right)
    expected = backbone_arc + chain[9:-9]
    cases.append(
        {
            "reaction": "LR",
            "vector": {"seq": dest, "ccdb": {"start": d_ccdb, "end": d_ccdb + len(ccdb)}},
            "inserts": [{"seq": e3}, {"seq": e1}, {"seq": e2}],
            "expected": expected,
        }
    )
    rand = plain_rand  # noqa: F811
    return cases


# ---------------------------------------------------------------------------
# TOPO
# ---------------------------------------------------------------------------

def topo_cases(vector: str) -> list[dict]:
    site = 300
    payload = rand(600)
    seq = rand(80) + payload + rand(80)
    region = {"start": 80, "length": len(payload)}
    return [
        {
            "directional": False,
            "site": site,
            "insert": {"seq": seq, "region": region},
            "forward": vector[:site] + payload + "A" + vector[site:],
            "reverse": vector[:site] + rc(payload) + "A" + vector[site:],
        },
        {
            "directional": True,
            "site": site,
            "insert": {"seq": seq, "region": region},
            "forward": vector[:site] + "CACC" + payload + vector[site:],
            "reverse": None,
        },
    ]


def main() -> None:
    vector = puc19()
    golden = {
        "source": "Biopython 1.88 Bio.Restriction digests joined manually (restriction, Golden Gate); string surgery (Gibson, In-Fusion, Gateway, TOPO)",
        "clamp": CLAMP,
        "restriction": restriction_cases(vector),
        "homology": homology_cases(vector),
        "goldenGate": golden_gate_cases(),
        "gateway": gateway_cases(),
        "topo": topo_cases(vector),
    }
    GOLDEN.write_text(json.dumps(golden, separators=(",", ":")) + "\n")
    print(f"wrote {GOLDEN.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
