# GENE_OS architecture

GENE_OS is a static web app. All analysis runs in the user's browser, so the site needs no server.
The functional requirements are in [SPEC.md](SPEC.md). The V1.2.0 page that set the visual style is in
[reference/v1.2.0-index.html](reference/v1.2.0-index.html).

## Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict | Many algorithms and file formats; types catch coordinate and shape errors. |
| Build | Vite | Static output that a Tauri wrapper can load later without change. |
| UI | Preact + `@preact/signals` | React API at a small size; signals update large sequence views without re-rendering the tree. |
| Tests | Vitest, Testing Library | One runner for engine and UI tests. |
| Lint/format | Biome | One fast tool. |
| Reference results | Biopython 1.88, primer3-py 2.4 | Established tools. A script writes their results to JSON goldens that the tests read. CI needs no Python. |

## Data shape

The core types are in [`src/engine/types.ts`](../src/engine/types.ts). Two shapes were considered:

| | A: plain records + pure functions (chosen) | B: sequence classes with methods and caches |
|---|---|---|
| State owner | One store in the UI layer | Each object owns its caches |
| Worker boundary | Records clone as-is | Needs serialise/rehydrate code |
| Project file | The records are the file | Needs a mapping layer |
| Testing | Input record → output value, compared to goldens | Needs object setup |
| Undo/redo | Snapshot of immutable records | Needs change tracking inside objects |

Rules that the types encode:

- Coordinates are 0-based and half-open. Only the UI shows 1-based positions.
- A segment always has `start < end`. A feature across the origin of a circular sequence has two segments.
- Auto-detected features carry `origin: 'detected'` and are recomputed on load; they are not user data.
- Enzymes store cut offsets relative to the recognition site. One function turns a site match into a `CutSite`
  for either strand, so no caller computes overhangs.

## Modules

```
src/
  engine/      Pure analysis. No DOM, no network. Safe to run in a Web Worker.
    types.ts       Shared domain types
    alphabet.ts    IUPAC tables, cleaning, reverse complement, alphabet detection
    location.ts    Span/Location helpers that handle circular wrap
    translate.ts   Genetic codes, frame translation
    composition.ts Base/residue counts, GC, skew, molecular weight, sliding-window series for charts
    protein.ts     pI, net charge, extinction coefficient, instability index, GRAVY, hydropathy profile
    orf.ts         ORF scan on both strands and all frames
    search.ts      Substring, IUPAC motif and regex search on both strands
    features.ts    Detection of known elements from the feature catalog
    restriction.ts Site scan, single/double digest, fragments
    gel.ts         Ladders, migration model, ladder suggestion
    primers.ts     Tm (nearest-neighbor, basic), GC, hairpin/dimer, 3' stability, primer design
    pcr.ts         Primer binding and amplicon simulation, linear and circular
  data/        Catalogs: enzymes.json (generated from REBASE via Biopython), features.json, ladders.json, presets
  formats/     Readers and writers: FASTA, GenBank, EMBL, SnapGene, AB1, raw, format detection, project file
  state/       Signals store, undo/redo, session persistence (IndexedDB)
  ui/          Preact components, themes, i18n, audio, backgrounds
scripts/oracle/  Python scripts that build catalogs and golden test values
tests/oracle/    Golden JSON written by the scripts
```

`engine/` and `formats/` never import from `ui/` or `state/`.

## Phases

1. Scaffold, engine core, file formats, app shell, Summary tab, Sequence tab (map + viewer + restriction).
2. Primers, PCR, digest and gel UI; ORF and protein tabs; search; manual annotation; undo/redo.
3. Alignment (pairwise and MSA), cloning methods, charts.
4. Project file UI, session restore, PDF comparison report, all exports, database search.
5. Optional Tauri wrapper for a Windows installer.
