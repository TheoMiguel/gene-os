"""Golden values for the engine core, produced by Biopython (and, where Biopython has no function, a plain
re-implementation written independently of the TypeScript code).

Run from the repository root:  .venv/bin/python -I scripts/oracle/core_goldens.py
Writes tests/oracle/core.json. The TypeScript tests read that file; CI needs no Python.
"""

import json
import math
import random
import re
from pathlib import Path

import Bio
from Bio.Data import CodonTable, IUPACData
from Bio.Seq import Seq
from Bio.SeqFeature import CompoundLocation, FeatureLocation, SeqFeature
from Bio.SeqUtils import (
    GC_skew,
    MeltingTemp,
    gc_fraction,
    molecular_weight,
    nt_search,
)
from Bio.SeqUtils.ProtParam import ProteinAnalysis
from Bio.SeqUtils import ProtParamData

OUT = Path(__file__).resolve().parents[2] / "tests" / "oracle" / "core.json"
AMINO = "ACDEFGHIKLMNPQRSTVWY"
IUPAC_DNA = "ACGTRYSWKMBDHVN"
CODONS_TCAG = [a + b + c for a in "TCAG" for b in "TCAG" for c in "TCAG"]


def rnd_dna(rng, n, alphabet="ACGT"):
    return "".join(rng.choice(alphabet) for _ in range(n))


def rnd_protein(rng, n):
    return "".join(rng.choice(AMINO) for _ in range(n))


def rev_comp_str(seq):
    return str(Seq(seq).reverse_complement())


def genetic_codes():
    out = {}
    for table_id, table in CodonTable.unambiguous_dna_by_id.items():
        aa = "".join(table.forward_table.get(c, "*") for c in CODONS_TCAG)
        out[str(table_id)] = {"name": table.names[0], "aa": aa, "starts": list(table.start_codons)}
    return out


def alphabet_cases(rng):
    rc_dna, rc_rna, comp = [], [], []
    for _ in range(40):
        s = rnd_dna(rng, rng.randint(1, 80), IUPAC_DNA)
        rc_dna.append({"seq": s, "rc": rev_comp_str(s), "complement": str(Seq(s).complement())})
        r = s.replace("T", "U")
        rc_rna.append({"seq": r, "rc": str(Seq(r).reverse_complement_rna()), "complement": str(Seq(r).complement_rna())})
    return {"dna": rc_dna, "rna": rc_rna}


def translate_cases(rng):
    cases = []
    for table_id in CodonTable.unambiguous_dna_by_id:
        for _ in range(3):
            s = rnd_dna(rng, rng.randint(3, 120))
            cases.append({"table": table_id, "seq": s, "protein": str(Seq(s).translate(table=table_id))})
    for table_id in (1, 11):
        for _ in range(60):
            s = rnd_dna(rng, rng.randint(3, 60), IUPAC_DNA)
            cases.append({"table": table_id, "seq": s, "protein": str(Seq(s).translate(table=table_id))})
    to_stop = []
    for _ in range(30):
        s = rnd_dna(rng, rng.randint(30, 200))
        to_stop.append({"seq": s, "protein": str(Seq(s).translate(to_stop=True))})
    six = []
    for _ in range(12):
        s = rnd_dna(rng, rng.randint(20, 150))
        frames = {}
        for k in range(3):
            frames[str(k + 1)] = str(Seq(s[k:]).translate(table=11))
            frames[str(-(k + 1))] = str(Seq(rev_comp_str(s)[k:]).translate(table=11))
        six.append({"seq": s, "table": 11, "frames": frames})
    return {"cases": cases, "toStop": to_stop, "sixFrame": six}


def windows(seq, window, step, circular, partial, fn):
    n = len(seq)
    out = []
    if circular:
        w = min(window, n)
        text = seq + seq
        for i in range(0, n, step):
            out.append([i, fn(text[i : i + w])])
    else:
        last = n - 1 if partial else n - window
        for i in range(0, last + 1, step):
            out.append([i, fn(seq[i : i + window])])
    return out


def entropy(s):
    total = sum(s.count(b) for b in "ACGT")
    if total == 0:
        return 0.0
    return -sum((s.count(b) / total) * math.log2(s.count(b) / total) for b in "ACGT" if s.count(b))


def tm_window(s):
    if len(s) < 14:
        return MeltingTemp.Tm_Wallace(s)
    return MeltingTemp.Tm_GC(s, userset=(64.9, 0.41, 672.4, 0), saltcorr=0)


def skew_window(s):
    g, c = s.count("G"), s.count("C")
    return 0.0 if g + c == 0 else (g - c) / (g + c)


SERIES = {
    "gc": lambda s: gc_fraction(s),
    "at": lambda s: sum(s.count(b) for b in "AT") / sum(s.count(b) for b in "ACGT"),
    "gcSkew": skew_window,
    "purine": lambda s: sum(s.count(b) for b in "AG") / sum(s.count(b) for b in "ACGT"),
    "pyrimidine": lambda s: sum(s.count(b) for b in "CT") / sum(s.count(b) for b in "ACGT"),
    "complexity": entropy,
    "tm": tm_window,
}


def codon_usage_case(seq, table_id, frame):
    table = CodonTable.unambiguous_dna_by_id[table_id]
    counts = {c: 0 for c in CODONS_TCAG}
    total = 0
    for i in range(frame, len(seq) - 2, 3):
        codon = seq[i : i + 3]
        if codon in counts:
            counts[codon] += 1
            total += 1
    aa_of = {c: table.forward_table.get(c, "*") for c in CODONS_TCAG}
    families = {}
    for c in CODONS_TCAG:
        families.setdefault(aa_of[c], []).append(c)
    rscu = {}
    for aa, members in families.items():
        s = sum(counts[c] for c in members)
        for c in members:
            rscu[c] = 0.0 if s == 0 else counts[c] / (s / len(members))
    return {"seq": seq, "table": table_id, "frame": frame, "total": total, "counts": counts, "rscu": rscu}


def composition_cases(rng):
    gc = []
    for _ in range(50):
        s = rnd_dna(rng, rng.randint(1, 120), IUPAC_DNA)
        gc.append({
            "seq": s,
            "remove": gc_fraction(s, "remove"),
            "ignore": gc_fraction(s, "ignore"),
            "weighted": gc_fraction(s, "weighted"),
        })
    rna_gc = []
    for _ in range(10):
        s = rnd_dna(rng, rng.randint(5, 60), "ACGU")
        rna_gc.append({"seq": s, "remove": gc_fraction(s, "remove")})

    skew_whole = []
    for _ in range(20):
        s = rnd_dna(rng, rng.randint(10, 300))
        skew_whole.append({"seq": s, "skew": GC_skew(s, window=len(s))[0]})

    mw = []
    for _ in range(40):
        s = rnd_dna(rng, rng.randint(1, 200))
        entry = {"seq": s}
        for seq_type, text in (("DNA", s), ("RNA", s.replace("T", "U"))):
            for ds in (False, True):
                for circ in (False, True):
                    key = f"{seq_type.lower()}_{'ds' if ds else 'ss'}_{'circ' if circ else 'lin'}"
                    entry[key] = molecular_weight(text, seq_type, double_stranded=ds, circular=circ)
        mw.append(entry)
    single_base = {b: molecular_weight(b, "DNA") for b in "ACGT"}
    single_base_rna = {b: molecular_weight(b, "RNA") for b in "ACGU"}
    protein_mw = [{"seq": a, "mw": molecular_weight(a, "protein")} for a in AMINO + "OU"]
    for _ in range(40):
        p = rnd_protein(rng, rng.randint(2, 400))
        protein_mw.append({"seq": p, "mw": ProteinAnalysis(p).molecular_weight()})

    series = []
    for kind, fn in SERIES.items():
        for _ in range(3):
            s = rnd_dna(rng, rng.randint(40, 160))
            window = rng.choice([5, 10, 14, 20, 31])
            step = rng.choice([1, 3, 7])
            for circular in (False, True):
                series.append({
                    "kind": kind, "seq": s, "window": window, "step": step, "circular": circular,
                    "partial": False,
                    "points": windows(s, window, step, circular, False, fn),
                })
    partial_skew = []
    for _ in range(6):
        s = rnd_dna(rng, rng.randint(50, 250))
        w = rng.choice([30, 50, 100])
        skews = GC_skew(s, window=w)
        cumulative, run = [], 0.0
        for v in skews:
            run += v
            cumulative.append(run)
        partial_skew.append({"seq": s, "window": w, "skew": skews, "cumulative": cumulative})

    usage = []
    for table_id in (1, 11, 2):
        for frame in (0, 1, 2):
            s = rnd_dna(rng, rng.randint(150, 400), "ACGTACGTACGTN")
            usage.append(codon_usage_case(s, table_id, frame))
    return {
        "gc": gc, "rnaGc": rna_gc, "skewWhole": skew_whole, "mw": mw, "singleBase": single_base,
        "singleBaseRna": single_base_rna, "proteinMw": protein_mw, "series": series,
        "partialSkew": partial_skew, "codonUsage": usage,
    }


def protein_cases(rng):
    cases = []
    for _ in range(60):
        p = rnd_protein(rng, rng.randint(2, 500))
        pa = ProteinAnalysis(p)
        red, cys = pa.molar_extinction_coefficient()
        cases.append({
            "seq": p, "pi": pa.isoelectric_point(), "charge74": pa.charge_at_pH(7.4),
            "charge5": pa.charge_at_pH(5.0), "charge10": pa.charge_at_pH(10.0),
            "reduced": red, "cystine": cys, "instability": pa.instability_index(),
            "gravy": pa.gravy(), "aromaticity": pa.aromaticity(),
        })
    termini = []
    for first in "AMSPTVEDKRHCGLIFWYNQ":
        for last in "DEKRAL":
            p = first + "GSKLDEACYRHW" + last
            pa = ProteinAnalysis(p)
            termini.append({"seq": p, "pi": pa.isoelectric_point(), "charge74": pa.charge_at_pH(7.4)})
    dipeptides = []
    for a in AMINO:
        for b in AMINO:
            dipeptides.append({"seq": a + b, "instability": ProteinAnalysis(a + b).instability_index()})
    residues = [{"seq": a, "gravy": ProteinAnalysis(a).gravy()} for a in AMINO]
    profiles = []
    for _ in range(8):
        p = rnd_protein(rng, rng.randint(30, 200))
        for window in (5, 9, 11, 19):
            profiles.append({
                "seq": p, "window": window,
                "values": ProteinAnalysis(p).protein_scale(ProtParamData.kd, window, 1.0),
            })
    return {"cases": cases, "termini": termini, "dipeptides": dipeptides, "residues": residues, "profiles": profiles}


def plant_orfs(rng, n, count):
    """Random sequence with a few planted ORFs on both strands so scans have hits."""
    seq = list(rnd_dna(rng, n))
    for _ in range(count):
        codons = rng.randint(25, 70)
        body = [rng.choice([c for c in CODONS_TCAG if c not in ("TAA", "TAG", "TGA")]) for _ in range(codons)]
        orf = "ATG" + "".join(body) + rng.choice(["TAA", "TAG", "TGA"])
        if rng.random() < 0.5:
            orf = rev_comp_str(orf)
        pos = rng.randrange(0, max(1, n - len(orf)))
        seq[pos : pos + len(orf)] = list(orf)
    return "".join(seq)[:n]


def naive_orfs(seq, circular, min_codons, starts, table_id, all_starts):
    """Per-start walk, written without any shared logic with the TypeScript scanner."""
    table = CodonTable.unambiguous_dna_by_id[table_id]
    stops = {c for c in table.stop_codons if c not in table.forward_table}
    n = len(seq)
    result = []
    for strand, s in ((1, seq), (-1, rev_comp_str(seq))):
        found = {}
        for a in range(n):
            if not circular and a + 3 > n:
                break
            first = s[a : a + 3] if a + 3 <= n else (s + s)[a : a + 3]
            if first not in starts:
                continue
            c = 0
            while True:
                if circular:
                    if 3 * (c + 1) > n:
                        break
                    codon = (s + s)[a + 3 * c : a + 3 * c + 3]
                else:
                    if a + 3 * (c + 1) > n:
                        break
                    codon = s[a + 3 * c : a + 3 * c + 3]
                if codon in stops:
                    length = 3 * (c + 1)
                    stop_at = (a + 3 * c) % n
                    found.setdefault(stop_at, []).append((a, length, c))
                    break
                c += 1
        for stop_at, entries in found.items():
            chosen = entries if all_starts else [min(entries, key=lambda e: (e[1] * -1))]
            for a, length, codons in chosen:
                if codons < min_codons:
                    continue
                body = ((s + s)[a : a + length]) if circular else s[a : a + length]
                protein = str(Seq(body).translate(table=table_id, cds=True, to_stop=False))
                top_start = a if strand == 1 else (n - a - length) % n
                frame = (a % 3 + 1) * strand
                result.append({
                    "strand": strand, "frame": frame, "start": top_start, "length": length,
                    "aa": codons, "protein": protein, "startCodon": body[:3], "stopCodon": body[-3:],
                })
    result.sort(key=lambda r: (r["start"], -r["strand"], r["length"]))
    return result


def orf_cases(rng):
    cases = []
    configs = [
        (1, ["ATG"], False), (1, ["ATG"], True), (11, ["ATG", "GTG", "TTG"], False),
        (11, ["ATG", "GTG", "TTG"], True), (11, list(CodonTable.unambiguous_dna_by_id[11].start_codons), False),
        (1, list(CodonTable.unambiguous_dna_by_id[1].start_codons), True),
    ]
    for table_id, starts, circular in configs:
        for _ in range(4):
            n = rng.randint(300, 900)
            seq = plant_orfs(rng, n, 4)
            if circular:
                shift = rng.randrange(n)
                seq = seq[shift:] + seq[:shift]
            for all_starts in (False, True):
                min_codons = 30
                cases.append({
                    "seq": seq, "circular": circular, "table": table_id, "starts": starts, "minCodons": min_codons,
                    "allStarts": all_starts,
                    "orfs": naive_orfs(seq, circular, min_codons, set(starts), table_id, all_starts),
                })
    return cases


def search_cases(rng):
    cases = []
    patterns = ["GAATTC", "GRCGYC", "NNNN", "ATG", "RYRY", "GGTCTC", "WSW", "CCWGG", "AAAA", "TTTTT"]
    for _ in range(14):
        n = rng.randint(60, 400)
        seq = rnd_dna(rng, n, "ACGT" if rng.random() < 0.8 else "ACGTN")
        for pattern in rng.sample(patterns, 4):
            for circular in (False, True):
                m = len(pattern)

                def find(pat):
                    text = seq + seq[: m - 1] if circular else seq
                    return [p for p in nt_search(text, pat)[1:] if p < n]

                fwd = find(pattern)
                rev_pat = rev_comp_str(pattern)
                rev = [] if rev_pat == pattern else find(rev_pat)
                cases.append({"seq": seq, "pattern": pattern, "circular": circular, "forward": fwd, "reverse": rev})
    regexes = []
    for _ in range(10):
        n = rng.randint(60, 300)
        seq = rnd_dna(rng, n)
        for expr in ["A+C", "G[AT]{2}C", "(?:TA){2,}", "ATG.{6}TAA", "C+G"]:
            regexes.append({"seq": seq, "regex": expr, "matches": [[m.start(), m.end() - m.start()] for m in re.finditer(expr, seq) if m.end() > m.start()]})
    protein = []
    for _ in range(8):
        p = rnd_protein(rng, rng.randint(80, 300))
        for expr in ["K[RK]", "GXG", "[ILV][ILV]P", "C", "{P}A"]:
            rx = expr.replace("X", ".").replace("{P}", "[^P]")
            protein.append({
                "seq": p, "motif": expr,
                "starts": [m.start() for m in re.finditer(f"(?=({rx}))", p)],
                "length": len(re.sub(r"\[[^\]]*\]|\{[^}]*\}", "x", expr)),
            })
    return {"motif": cases, "regex": regexes, "protein": protein}


def location_cases(rng):
    cases = []
    for _ in range(40):
        n = rng.randint(20, 120)
        seq = rnd_dna(rng, n)
        strand = rng.choice([1, -1])
        start = rng.randrange(n)
        length = rng.randint(1, n)
        end = start + length
        if end <= n:
            segments = [[start, end]]
            parts = [FeatureLocation(start, end, strand)]
        else:
            head, tail = [start, n], [0, end - n]
            segments = [head, tail] if strand == 1 else [tail, head]
            parts = [FeatureLocation(a, b, strand) for a, b in segments]
        loc = parts[0] if len(parts) == 1 else CompoundLocation(parts)
        feature = SeqFeature(loc)
        cases.append({
            "seq": seq, "start": start, "length": length, "strand": strand, "segments": segments,
            "extracted": str(feature.extract(Seq(seq))),
        })
    return cases


def main():
    rng = random.Random(20261125)
    data = {
        "biopython": Bio.__version__,
        "geneticCodes": genetic_codes(),
        "alphabet": alphabet_cases(rng),
        "translate": translate_cases(rng),
        "composition": composition_cases(rng),
        "protein": protein_cases(rng),
        "orf": orf_cases(rng),
        "search": search_cases(rng),
        "location": location_cases(rng),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()
