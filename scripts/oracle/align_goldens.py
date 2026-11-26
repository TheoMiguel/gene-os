"""Write tests/oracle/align.json and the alignment fixtures: Biopython results for the alignment engine.

Run: .venv/bin/python -I scripts/oracle/align_goldens.py

- `cases`: `Bio.Align.PairwiseAligner` score and number of optimal alignments (null when it overflows) for global, local and overlap modes
  (overlap is `end_gap_score = 0` in global mode), on DNA and protein, with the scores the TypeScript call passes.
  A case with one optimal alignment also stores that alignment, so the test can demand the exact traceback.
- `globins.identity`: Biopython global-alignment identity of each pair of the globin fixture (BLOSUM62, 10 / 0.5).
- tests/fixtures/align/variants.json: seeded mutated copies of fixture sequences with the edits listed, so the
  difference list has known answers. Edits sit far apart and where an indel cannot slide, so the answer is unique.
- tests/fixtures/align/globins.fasta: six globins from UniProt (fetched once, kept in the repository).
"""

import io
import json
import random
import urllib.request
import warnings
from pathlib import Path

import Bio
from Bio import Align, SeqIO

warnings.simplefilter("ignore")

ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / "tests" / "fixtures" / "core"
FORMATS = ROOT / "tests" / "fixtures" / "formats"
OUT_FIXTURES = ROOT / "tests" / "fixtures" / "align"
GOLDEN = ROOT / "tests" / "oracle" / "align.json"
GLOBINS = OUT_FIXTURES / "globins.fasta"
UNIPROT = {
    "HBA_HUMAN": "P69905",
    "HBB_HUMAN": "P68871",
    "HBA_HORSE": "P01958",
    "HBB_HORSE": "P02062",
    "MYG_HUMAN": "P02144",
    "MYG_PHYMC": "P02185",
}
DNA_SCORES = [
    {"match": 2, "mismatch": -3, "gapOpen": 5, "gapExtend": 2},
    {"match": 1, "mismatch": -1, "gapOpen": 2, "gapExtend": 0.5},
    {"match": 1, "mismatch": -10, "gapOpen": 1, "gapExtend": 1},
    {"match": 5, "mismatch": -4, "gapOpen": 3, "gapExtend": 3},
]
PROTEIN_SCORES = [
    {"matrix": "BLOSUM62", "gapOpen": 10, "gapExtend": 0.5},
    {"matrix": "BLOSUM62", "gapOpen": 11, "gapExtend": 1},
    {"matrix": "BLOSUM45", "gapOpen": 15, "gapExtend": 2},
    {"matrix": "BLOSUM80", "gapOpen": 10, "gapExtend": 1},
    {"matrix": "PAM250", "gapOpen": 10, "gapExtend": 1},
]


def fetch_globins() -> None:
    if GLOBINS.exists():
        return
    OUT_FIXTURES.mkdir(parents=True, exist_ok=True)
    lines = []
    for name, accession in UNIPROT.items():
        text = urllib.request.urlopen(f"https://rest.uniprot.org/uniprotkb/{accession}.fasta", timeout=60).read().decode()
        record = SeqIO.read(io.StringIO(text), "fasta")
        seq = str(record.seq)
        lines += [f">{name} UniProt {accession}"] + [seq[i : i + 60] for i in range(0, len(seq), 60)]
    GLOBINS.write_text("\n".join(lines) + "\n")


def read_fasta(path: Path) -> dict[str, str]:
    return {r.id: str(r.seq).upper() for r in SeqIO.parse(path, "fasta")}


def make_aligner(mode: str, scores: dict, alphabet: str) -> Align.PairwiseAligner:
    aligner = Align.PairwiseAligner()
    aligner.mode = "local" if mode == "local" else "global"
    if alphabet == "protein":
        aligner.substitution_matrix = Align.substitution_matrices.load(scores["matrix"])
    else:
        aligner.match_score = scores["match"]
        aligner.mismatch_score = scores["mismatch"]
    aligner.open_gap_score = -scores["gapOpen"]
    aligner.extend_gap_score = -scores["gapExtend"]
    if mode == "overlap":
        aligner.end_gap_score = 0
    return aligner


def gapped_rows(alignment, a: str, b: str) -> tuple[str, str, list[int]]:
    """Gapped strings of a Biopython alignment and [startA, endA, startB, endB]."""
    ta, qa = alignment.coordinates[0], alignment.coordinates[1]
    row_a, row_b = [], []
    for k in range(len(ta) - 1):
        da, db = ta[k + 1] - ta[k], qa[k + 1] - qa[k]
        if da and db:
            row_a.append(a[ta[k] : ta[k + 1]])
            row_b.append(b[qa[k] : qa[k + 1]])
        elif da:
            row_a.append(a[ta[k] : ta[k + 1]])
            row_b.append("-" * da)
        else:
            row_a.append("-" * db)
            row_b.append(b[qa[k] : qa[k + 1]])
    return "".join(row_a), "".join(row_b), [int(ta[0]), int(ta[-1]), int(qa[0]), int(qa[-1])]


def mutate(rng: random.Random, seq: str, alphabet: str, sub_rate: float, indels: int) -> str:
    letters = "ACGT" if alphabet == "dna" else "ACDEFGHIKLMNPQRSTVWY"
    out = list(seq)
    for i in range(len(out)):
        if rng.random() < sub_rate:
            out[i] = rng.choice([c for c in letters if c != out[i]])
    for _ in range(indels):
        pos = rng.randrange(1, len(out) - 1)
        size = rng.randint(1, 6)
        if rng.random() < 0.5:
            del out[pos : pos + size]
        else:
            out[pos:pos] = [rng.choice(letters) for _ in range(size)]
    return "".join(out)


def build_cases(rng: random.Random) -> list[dict]:
    puc = read_fasta(CORE / "puc19.fasta")
    pbr = read_fasta(CORE / "pbr322.fasta")
    egfp_dna = read_fasta(CORE / "pegfp-n1.fasta")
    puc_seq, pbr_seq, peg_seq = (next(iter(d.values())) for d in (puc, pbr, egfp_dna))
    from Bio.Seq import Seq

    egfp_protein = str(Seq(peg_seq[678:1398]).translate())
    globins = read_fasta(GLOBINS)
    mrr = str(next(SeqIO.parse(FORMATS / "1MRR_A.gp", "genbank")).seq).upper()
    refseq = [str(r.seq).upper() for r in SeqIO.parse(FORMATS / "protein_refseq2.gb", "genbank")]

    def rand(n: int, letters: str = "ACGT") -> str:
        return "".join(rng.choice(letters) for _ in range(n))

    dna_pairs = []
    for length in (40, 90, 150, 300, 600):
        start = rng.randrange(0, len(puc_seq) - length)
        window = puc_seq[start : start + length]
        dna_pairs.append((f"puc19[{start}:{start + length}] vs mutated copy", window, mutate(rng, window, "dna", 0.06, 3)))
    ori_a = puc_seq[1200:1800]
    ori_b = pbr_seq[2400:3100]
    dna_pairs.append(("pUC19 vs pBR322 near the shared origin", ori_a, ori_b))
    dna_pairs.append(("random unrelated 120 / 200", rand(120), rand(200)))
    dna_pairs.append(("random unrelated 60 / 60", rand(60), rand(60)))
    reference = puc_seq[0:1200]
    read = mutate(rng, reference[400:700], "dna", 0.02, 2)
    dna_pairs.append(("read of 300 bp inside a 1200 bp reference", reference, read))
    dna_pairs.append(("read overhanging the reference start", puc_seq[100:500], rand(40) + puc_seq[100:300]))
    dna_pairs.append(("poly-A with a gap", "A" * 30 + "G" + "A" * 30, "A" * 55))
    dna_pairs.append(("tiny", "ACGT", "AGT"))
    dna_pairs.append(("one empty-ish", "ACGTACGTAC", "A"))

    protein_pairs = [
        ("human alpha vs beta globin", globins["HBA_HUMAN"], globins["HBB_HUMAN"]),
        ("human vs horse alpha globin", globins["HBA_HUMAN"], globins["HBA_HORSE"]),
        ("human myoglobin vs sperm whale myoglobin", globins["MYG_HUMAN"], globins["MYG_PHYMC"]),
        ("human alpha globin vs myoglobin", globins["HBA_HUMAN"], globins["MYG_HUMAN"]),
        ("EGFP vs mutated EGFP", egfp_protein, mutate(rng, egfp_protein, "protein", 0.1, 4)),
        ("1MRR_A fragment vs mutated copy", mrr[:200], mutate(rng, mrr[:200], "protein", 0.15, 3)),
        ("random unrelated proteins", rand(90, "ACDEFGHIKLMNPQRSTVWY"), rand(120, "ACDEFGHIKLMNPQRSTVWY")),
        ("refseq protein fragment vs 1MRR_A fragment", refseq[0][:150], mrr[100:260]),
        ("tiny protein", "MKV", "MV"),
    ]

    cases = []
    for alphabet, pairs, score_sets in (("dna", dna_pairs, DNA_SCORES), ("protein", protein_pairs, PROTEIN_SCORES)):
        for label, a, b in pairs:
            for scores in score_sets:
                for mode in ("global", "local", "overlap"):
                    aligner = make_aligner(mode, scores, alphabet)
                    alignments = aligner.align(a, b)
                    try:
                        count = len(alignments)
                    except OverflowError:
                        count = None
                    case = {
                        "label": label,
                        "alphabet": alphabet,
                        "mode": mode,
                        "scores": scores,
                        "a": a,
                        "b": b,
                        "score": float(aligner.score(a, b)),
                        "optimalCount": count,
                    }
                    if count == 1:
                        row_a, row_b, ranges = gapped_rows(alignments[0], a, b)
                        case["unique"] = {"alignedA": row_a, "alignedB": row_b, "range": ranges}
                    cases.append(case)
    return cases


def pick_edits(rng: random.Random, seq: str, alphabet: str, count: int) -> list[dict]:
    """Substitutions, insertions and deletions at least 40 residues apart, placed where an indel cannot slide."""
    letters = "ACGT" if alphabet == "dna" else "ACDEFGHIKLMNPQRSTVWY"
    edits: list[dict] = []
    cursor = 30
    kinds = ["substitution", "insertion", "deletion"]
    while len(edits) < count and cursor < len(seq) - 40:
        kind = kinds[len(edits) % 3]
        pos = cursor + rng.randrange(0, 20)
        if kind == "substitution":
            alt = rng.choice([c for c in letters if c != seq[pos]])
            edits.append({"kind": kind, "refStart": pos, "refEnd": pos + 1, "ref": seq[pos], "alt": alt})
            cursor = pos + 40
        elif kind == "insertion":
            ins = "".join(rng.choice(letters) for _ in range(rng.randint(1, 5)))
            if ins[0] == seq[pos] or ins[-1] == seq[pos - 1]:
                cursor += 1
                continue
            edits.append({"kind": kind, "refStart": pos, "refEnd": pos, "ref": "", "alt": ins})
            cursor = pos + 40
        else:
            size = rng.randint(1, 5)
            if seq[pos] == seq[pos + size] or seq[pos - 1] == seq[pos + size - 1]:
                cursor += 1
                continue
            edits.append({"kind": kind, "refStart": pos, "refEnd": pos + size, "ref": seq[pos : pos + size], "alt": ""})
            cursor = pos + size + 40
    return edits


def apply_edits(seq: str, edits: list[dict]) -> tuple[str, list[dict]]:
    out, shift, last = [], 0, 0
    placed = []
    for edit in edits:
        out.append(seq[last : edit["refStart"]])
        alt_start = edit["refStart"] + shift
        out.append(edit["alt"])
        last = edit["refEnd"]
        placed.append({**edit, "altStart": alt_start, "altEnd": alt_start + len(edit["alt"])})
        shift += len(edit["alt"]) - (edit["refEnd"] - edit["refStart"])
    out.append(seq[last:])
    return "".join(out), placed


def build_variants(rng: random.Random) -> dict:
    from Bio.Seq import Seq

    puc = next(iter(read_fasta(CORE / "puc19.fasta").values()))
    pbr = next(iter(read_fasta(CORE / "pbr322.fasta").values()))
    peg = next(iter(read_fasta(CORE / "pegfp-n1.fasta").values()))
    egfp = str(Seq(peg[678:1398]).translate())
    mrr = str(next(SeqIO.parse(FORMATS / "1MRR_A.gp", "genbank")).seq).upper()
    sources = [
        ("pUC19 bases 0-1500", "dna", puc[:1500], 9),
        ("pBR322 bases 1000-2500", "dna", pbr[1000:2500], 9),
        ("EGFP protein", "protein", egfp, 6),
        ("1MRR_A protein", "protein", mrr, 9),
    ]
    out = {"seed": 20261125, "references": []}
    for name, alphabet, seq, count in sources:
        edits = pick_edits(rng, seq, alphabet, count)
        variant, placed = apply_edits(seq, edits)
        out["references"].append({"name": name, "alphabet": alphabet, "reference": seq, "variant": variant, "edits": placed})
    return out


def globin_identity() -> dict:
    globins = read_fasta(GLOBINS)
    aligner = make_aligner("global", PROTEIN_SCORES[0], "protein")
    out = {}
    names = list(globins)
    for i, x in enumerate(names):
        for y in names[i + 1 :]:
            alignment = aligner.align(globins[x], globins[y])[0]
            counts = alignment.counts()
            out[f"{x}|{y}"] = {
                "identities": int(counts.identities),
                "length": int(alignment.length),
                "score": float(alignment.score),
            }
    return out


def main() -> None:
    fetch_globins()
    OUT_FIXTURES.mkdir(parents=True, exist_ok=True)
    rng = random.Random(20261125)
    variants = build_variants(rng)
    (OUT_FIXTURES / "variants.json").write_text(json.dumps(variants, indent=1) + "\n")
    golden = {
        "biopython": Bio.__version__,
        "cases": build_cases(rng),
        "globins": {"identity": globin_identity()},
    }
    GOLDEN.write_text(json.dumps(golden, separators=(",", ":")) + "\n")
    print(f"{len(golden['cases'])} cases, {GOLDEN.stat().st_size} bytes")


if __name__ == "__main__":
    main()
