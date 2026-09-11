# KiCad import invariant repros — known-bad baseline

These characterization snapshots record five existing defects. Passing tests in this baseline mean the defects are reproduced consistently; they do not mean the importer is correct. The next stacked PR fixes the importer and changes these same snapshot files from red DEFECT to green PASS.

The three small KiCad inputs in `fixtures/` are shared by both stack layers. `evidence.ts` runs the real converters and reads the emitted values and references. `render-evidence.ts` turns that evidence into reviewable SVG/PNG cards. The roundrect card draws the actual imported geometry at the same scale as the KiCad specification. The other cards are explicitly data/schema diagnostics, not fabricated screenshots of the KiCad UI.

| Existing defect | Snapshot |
|---|---|
| Roundrect corner radius is 0.60 mm instead of 1.20 mm | ![Bad radius](__snapshots__/roundrect-radius.png) |
| Fabrication text receives empty/duplicate primary IDs | ![Bad IDs](__snapshots__/fabrication-text-ids.png) |
| Standalone footprint has a dangling source-port reference | ![Missing standalone terminal](__snapshots__/standalone-source-port.png) |
| A no-net PCB pin has a dangling source-port reference | ![Missing no-net terminal](__snapshots__/no-net-source-port.png) |
| Default schematic text emits an invalid anchor enum | ![Invalid anchor](__snapshots__/schematic-text-anchor.png) |

Run:

```sh
bun test tests/repros/fuzz-import-invariants/import-invariants.test.ts
```

Regenerate intentionally:

```sh
UPDATE_IMPORT_REPRO_SNAPSHOTS=1 bun test tests/repros/fuzz-import-invariants/import-invariants.test.ts
```

Tests compare exact generated SVG and JSON evidence. Committed PNG previews have dimension and integrity-hash checks; they are generated together with SVG/evidence on explicit updates. This avoids platform font rasterization differences becoming pixel-test failures. PNGs are reviewer artifacts, not independent pixel-diff oracles.
