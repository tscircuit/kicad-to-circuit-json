# KiCad import fuzz suite

This suite exercises all **36 Circuit JSON types emitted by the reviewed importer**, through 60 mode/type contracts (PCB, standalone footprint, symbol library and schematic). The generated cases have independent geometry/text/connectivity expectations, not just crash checks. Coverage is representative, not an exhaustive proof of every KiCad feature or variant.

## Run

```sh
bun install --frozen-lockfile
bun run test:fuzz
FUZZ_RUNS=1000 FUZZ_SEED=20260911 bun run test:fuzz
FUZZ_KICAD=1 FUZZ_KICAD_RUNS=10 bun run test:fuzz
bunx tsc --noEmit
```

`FUZZ_RUNS` defaults to 100 per structured property. The seven original pad-family properties, four mode properties, three independent pad-geometry properties and one connectivity property generate 15 × FUZZ_RUNS cases, plus fixed boundary examples. Corpus mutations default to five per fixture (`FUZZ_CORPUS_RUNS`); malformed input mutations default to ten per mode (`FUZZ_ROBUSTNESS_RUNS`). GenCAD differential testing is opt-in (`FUZZ_KICAD=1`) and fails if the CLI is missing; it defaults to five inputs (`FUZZ_KICAD_RUNS`). Set the flag explicitly in any CI job intended to require KiCad parity checks.

## Implemented checks

| Test file | Contract |
|---|---|
| `all-elements.fuzz.test.ts` | All 36 types, exact generated type inventory and counts, schema validity, finite values, unique IDs, nested/list references, component ownership, per-type geometry/text/link oracles, deterministic fresh import and PCB/footprint origin invariance. |
| `kicad-footprint.fuzz.test.ts` | Seven pad families; dimensions, position, side, circular drill geometry, angle normalization, modern/legacy equivalence, failure shrinking. |
| `pad-geometry.fuzz.test.ts` | Independent component/pad angles; roundrect corner radii, trapezoid envelope diagnostics, asymmetric custom triangle geometry plus anchor retention. |
| `connectivity.fuzz.test.ts` | Up to 20 generated pins over three nets plus no-net; exact terminal partitions; net-code and UUID renumbering; reversed pad order; source ports for disconnected pins. |
| `corpus.fuzz.test.ts` | Quoted-string-aware whitespace mutations of two official footprint fixtures and the 36-symbol CM5IO library, with schema validation and output parity. |
| `malformed.fuzz.test.ts` | Truncation, token deletion/insertion and nesting mutations, each in its own Bun process. Accepted results must validate; ordinary Error/SyntaxError are controlled rejection; TypeError, RangeError, assertion failure, process death and timeout fail. |
| `kicad-differential.fuzz.test.ts` | Generated boards are loaded by KiCad and exported to GenCAD; independent exported terminal partitions must match Circuit JSON and the expected nonempty model. |
| `import-regressions.test.ts` | Duplicate physical pad numbers, fabrication-text identity, explicit board-level ownership sentinel contract. |

The schemas are pinned to `circuit-json@0.0.446`; fast-check is pinned to 4.10.0. The lockfile pins transitive dependencies as well. Numeric geometry uses a small tolerance, with modulo-aware angle comparison. Polygon comparison ignores winding/start vertex but checks each expected vertex; circle paths verify radius at every emitted sample.

`coverage-manifest.json` retains the proposal's broader variant ideas as `planned_generator`/`planned_property`. The `modes` map is the enforced implemented inventory. Runtime hits in `work/fuzz-results/element-coverage.json` are counts of passing model cases that emitted each mode/type, not branch or line coverage. CI fails if a selected mode has an unhit required type or if a statically emitted type lacks a manifest entry. Running one mode with `-t` validates only that selected mode's hit counts, enabling replay.

## Reproduce failures

Failing properties shrink their models and save input plus seed, path and model under `work/fuzz-failures/<campaign>/`. Use the same commit, lockfile and exact test selection:

```sh
FUZZ_SEED=20260911 FUZZ_PATH='path-from-failure.json' bun test tests/fuzz/all-elements.fuzz.test.ts -t 'fuzz all elements: pcb$'
```

Select the matching file/test for other campaigns. Multi-family runs must be narrowed to the failing family before using a shrink path. Direct fixed-example failures name the assertion in the test itself. Failure inputs, coverage, the resolved lockfile and commit/runtime metadata should be archived when configuring an artifact-upload job. Files are overwritten by later failures in the same campaign; archive them before another run. A previous failure file is not evidence that the current run failed.

## CI and resource limits

The existing repository test workflow runs `bun test`, which discovers this suite alongside the other tests. This stack adds no workflow files or nightly schedule. Set `FUZZ_KICAD=1` to require GenCAD checks, or use `bun run test:fuzz:kicad`. Local verification used Bun 1.3.14 and KiCad 10.0.6; the existing CI workflow uses its configured Bun version and KiCad 10.0.0 container.

Malformed workers have a two-second SIGKILL deadline and 1 MiB output limit. Generated mutation length/nesting are bounded. This is process/time/output isolation, **not a per-process memory quota**; use a memory-limited container for larger hostile-input campaigns. The suite does not install an OS sandbox. GenCAD calls have a ten-second timeout and bounded output.

## Fixes found while implementing

1. Fabrication text supplied an empty primary ID, preventing automatic ID allocation. Removed explicit empty IDs at footprint and board emission sites.
2. Default schematic text used `center_center`, which the schema rejects. Emit `center` for fully centered text.
3. Standalone footprints emitted PCB-port links without creating source ports. Create/deduplicate logical terminals in the standalone path.
4. Main PCB import skipped source-port creation for no-net pads. Create the terminal before excluding it from net/trace membership.
5. Rounded pad corner radii were divided by two. Use the ratio times the shorter side, and correct the existing regression expectation. KiCad's own [documented example](https://gitlab.com/kicad/code/kicad/-/work_items/24751) demonstrates 0.3 × 0.3333 = 0.1 mm.

The pinned schema requires a component ID on board-level fabrication text, while the importer uses `""` for unowned graphics. A narrowly scoped regression explicitly permits this sentinel for that element only. General generated inputs still use strict reference resolution; this is not a global dangling-reference exemption.

## Coverage limits

All 36 emitted types have representative executable contracts. This does not cover every shape/layer/version combination. Deep custom polygon-hole topology, hierarchical multi-sheet connectivity, symbol inheritance/multiple-unit behavior, blind/buried via spans, arbitrary curved board outlines, richer corpus AST mutations and exporter round-trip fidelity remain expansion areas. Existing focused custom-contour regressions are also run during validation. GenCAD differential tests verify logical connectivity, not copper-region or pixel parity. The complete upstream demo/visual test suite is outside this focused run.
