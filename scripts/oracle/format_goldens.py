"""Golden values for the GENE_OS sequence file readers and writers, computed with Biopython's Bio.SeqIO.

Usage (from the repository root):

    .venv/bin/python -I scripts/oracle/format_goldens.py
        Reads every file in tests/fixtures/formats/ with Bio.SeqIO and writes tests/oracle/formats.json.

    .venv/bin/python -I scripts/oracle/format_goldens.py --check-writes DIR
        Reads back the files that the GENE_OS writers produced in DIR (see src/formats/writer-export.test.ts)
        and compares them with the goldens of the fixture they came from. Exits 1 on any mismatch.

The format of a fixture comes from its extension, as Bio.SeqIO needs it named.
"""

import hashlib
import json
import sys
import warnings
from pathlib import Path

import Bio
from Bio import SeqIO
from Bio.SeqFeature import AfterPosition, BeforePosition, CompoundLocation, ExactPosition

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures" / "formats"
GOLDEN = ROOT / "tests" / "oracle" / "formats.json"

FORMAT_BY_EXTENSION = {
    ".gb": "genbank",
    ".gbk": "genbank",
    ".gp": "genbank",
    ".seq": "genbank",
    ".embl": "embl",
    ".dna": "snapgene",
    ".ab1": "abi",
    ".fasta": "fasta",
    ".nu": "fasta",
    ".pro": "fasta",
    ".fa": "fasta",
}

# Sequences longer than this are stored as a SHA-256 digest only.
INLINE_SEQUENCE_LIMIT = 2000

NUCLEOTIDE_LETTERS = set("ACGTURYKMSWBDHVN-.*")


def sha256(text):
    return hashlib.sha256(text.encode("ascii")).hexdigest()


def alphabet_of(record):
    """GENE_OS alphabet: the molecule type when the file states one, else the letters (FASTA)."""
    mol = record.annotations.get("molecule_type")
    seq = str(record.seq).upper()
    if mol is not None and "protein" in mol.lower():
        return "protein"
    if mol is None and not set(seq) <= NUCLEOTIDE_LETTERS:
        return "protein"
    return "rna" if "U" in seq and "T" not in seq else "dna"


def fuzz(position):
    if isinstance(position, ExactPosition):
        return None
    if isinstance(position, BeforePosition):
        return "<"
    if isinstance(position, AfterPosition):
        return ">"
    return "other"


def location_json(location):
    parts = location.parts
    return {
        "operator": location.operator if isinstance(location, CompoundLocation) else None,
        "parts": [
            {
                "start": int(part.start),
                "end": int(part.end),
                "strand": part.strand,
                "ref": part.ref,
                "startFuzzy": fuzz(part.start),
                "endFuzzy": fuzz(part.end),
            }
            for part in parts
        ],
    }


def feature_json(feature):
    return {
        "type": feature.type,
        **location_json(feature.location),
        "qualifiers": {key: [str(v) for v in values] for key, values in feature.qualifiers.items()},
    }


def channel_json(values):
    values = list(values)
    return {
        "length": len(values),
        "sum": sum(values),
        "sha256": sha256(",".join(str(v) for v in values)),
    }


def trace_json(record):
    raw = record.annotations["abif_raw"]
    order = raw["FWO_1"].decode("ascii")
    channels = {base: channel_json(raw[f"DATA{9 + i}"]) for i, base in enumerate(order)}
    return {
        "baseOrder": order,
        "channels": channels,
        "peakPositions": list(raw["PLOC2"]),
        "quality": record.letter_annotations.get("phred_quality"),
    }


def record_json(record, fmt):
    if not record.seq.defined:
        return {"id": record.id, "undefinedSequence": True, "length": len(record.seq)}
    seq = str(record.seq).upper()
    out = {
        "id": record.id,
        "name": record.name,
        "description": record.description,
        "topology": record.annotations.get("topology"),
        "moleculeType": record.annotations.get("molecule_type"),
        "alphabet": alphabet_of(record),
        "length": len(seq),
        "sha256": sha256(seq),
        "features": [feature_json(f) for f in record.features],
    }
    if len(seq) <= INLINE_SEQUENCE_LIMIT:
        out["seq"] = seq
    if fmt == "abi":
        out["trace"] = trace_json(record)
    return out


def read_fixture(path):
    fmt = FORMAT_BY_EXTENSION[path.suffix]
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            with open(path, "rb" if fmt in ("snapgene", "abi") else "r") as handle:
                records = [record_json(r, fmt) for r in SeqIO.parse(handle, fmt)]
            error = None
        except ValueError as exc:
            records, error = [], f"{type(exc).__name__}: {exc}"
    return {
        "file": path.name,
        "format": fmt,
        "error": error,
        "warnings": sorted({str(w.message) for w in caught if "unclosed file" not in str(w.message)}),
        "records": records,
    }


def write_goldens():
    fixtures = [read_fixture(p) for p in sorted(FIXTURES.iterdir()) if FORMAT_BY_EXTENSION.get(p.suffix)]
    GOLDEN.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN.write_text(
        json.dumps({"generator": "scripts/oracle/format_goldens.py", "biopython": Bio.__version__, "fixtures": fixtures}, indent=1)
        + "\n"
    )
    print(f"wrote {GOLDEN.relative_to(ROOT)}: {len(fixtures)} fixtures")


# --- writer read-back check ---------------------------------------------------------------------------------

WRITTEN_FORMATS = {".fasta": "fasta", ".gb": "genbank", ".embl": "embl", ".dna": "snapgene"}


def kept_parts(feature, length):
    """Parts GENE_OS keeps on reading: not on another accession, not the site between the last and first base."""
    return [p for p in feature["parts"] if p["ref"] is None and not (p["start"] == p["end"] == length)]


def comparable_feature(feature, fmt, length):
    """What a written format carries.

    Inexact positions (one-of, within) are written as plain numbers. SnapGene has no partial ends and no
    zero-length sites (a between-bases site is written as its two flanking bases), stores the feature name
    outside the qualifiers, and Biopython's SnapGene reader lists the halves of a reverse-strand
    origin-spanning feature in top-strand order, so SnapGene parts compare as a sorted list.
    """
    insdc = fmt in ("genbank", "embl")
    qualifiers = dict(feature["qualifiers"])
    if not insdc:
        qualifiers.pop("label", None)
        qualifiers.pop("name", None)
    parts = []
    for p in kept_parts(feature, length):
        start, end = p["start"], p["end"]
        if not insdc and start == end:
            start, end = start - 1, end + 1
        parts.append(
            (
                start,
                end,
                p["strand"] or 1,
                p["startFuzzy"] if insdc and p["startFuzzy"] != "other" else None,
                p["endFuzzy"] if insdc and p["endFuzzy"] != "other" else None,
            )
        )
    return {"type": feature["type"], "parts": parts if insdc else sorted(parts), "qualifiers": qualifiers}


def compare_written(original, written, fmt, label):
    problems = []
    if written["sha256"] != original["sha256"]:
        problems.append("sequence differs")
    if fmt == "fasta":
        return problems
    if (written["topology"] or "linear") != (original["topology"] or "linear"):
        problems.append(f"topology {written['topology']} != {original['topology']}")
    length = original["length"]
    expected = [comparable_feature(f, fmt, length) for f in original["features"] if kept_parts(f, length)]
    actual = [comparable_feature(f, fmt, length) for f in written["features"]]
    if len(expected) != len(actual):
        problems.append(f"{len(actual)} features, expected {len(expected)}")
    for i, (e, a) in enumerate(zip(expected, actual)):
        if e != a:
            problems.append(f"feature {i}: expected {e} got {a}")
    return [f"{label}: {p}" for p in problems]


def check_writes(directory):
    goldens = {f["file"]: f for f in json.loads(GOLDEN.read_text())["fixtures"]}
    problems, checked = [], 0
    for path in sorted(Path(directory).iterdir()):
        fmt = WRITTEN_FORMATS.get(path.suffix)
        source = path.stem  # "<fixture file name>" (the writer suffix is the extension)
        if fmt is None or source not in goldens:
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with open(path, "rb" if fmt == "snapgene" else "r") as handle:
                written = [record_json(r, fmt) for r in SeqIO.parse(handle, fmt)]
        original = goldens[source]["records"]
        if len(written) != len(original):
            problems.append(f"{path.name}: {len(written)} records, expected {len(original)}")
            continue
        for index, (o, w) in enumerate(zip(original, written)):
            problems += compare_written(o, w, fmt, f"{path.name}#{index}")
        checked += 1
    for problem in problems:
        print(problem)
    print(f"checked {checked} written files, {len(problems)} problems")
    if checked == 0 or problems:
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--check-writes":
        check_writes(sys.argv[2])
    else:
        write_goldens()
