# KiCad imports: actual renderer comparisons

These images use **KiCad CLI SVG output on the left** and **`circuit-to-svg` rendering of the imported Circuit JSON on the right**. There is no hand-drawn replacement for circuit geometry. Engine-name headers and assertion captions are added outside the actual render panels. Every defect JSON snapshot has a matching comparison image; a coverage test enforces this.

This fix layer uses identical fixtures and KiCad reference images from the baseline PR, updates the actual Circuit JSON renders, and asserts the corrected invariants.

## Rounded-pad radius

4 × 3 mm pad, ratio 0.4: expected radius 1.20 mm; baseline gives 0.60 mm (50% too small).

![KiCad versus Circuit JSON: Rounded-pad radius](__snapshots__/real-renders/roundrect-radius.comparison.png)

## Fabrication text IDs

Both fabrication labels are rendered with F.Fab enabled. The baseline assigns two empty IDs; the fix assigns two unique IDs. The ID defect itself does not change text geometry.

![KiCad versus Circuit JSON: Fabrication text IDs](__snapshots__/real-renders/fabrication-text-ids.comparison.png)

## Standalone terminal

The actual standalone footprint converter is used on the Circuit JSON side. The baseline physical pad points at a missing logical terminal. Fixing its reference does not itself change copper pixels; this shared fixture also exposes the radius defect.

![KiCad versus Circuit JSON: Standalone terminal](__snapshots__/real-renders/standalone-source-port.comparison.png)

## Unconnected terminal

A real no-net board pad still needs a logical terminal. The baseline reference is dangling; the corrected one resolves, with zero invented nets or traces. This data defect has no visible copper difference.

![KiCad versus Circuit JSON: Unconnected terminal](__snapshots__/real-renders/no-net-source-port.comparison.png)

## Schematic text alignment

Native KiCad schematic export is compared with the schematic renderer. The baseline center_center anchor is invalid and yields undefined SVG alignment, moving text right of its intended center. The fixed center anchor centers it. Font width/color differences remain.

![KiCad versus Circuit JSON: Schematic text alignment](__snapshots__/real-renders/schematic-text-anchor.comparison.png)

## Rounded-pad fixture

The four 5 × 3 mm pads use KiCad radius ratios 0.15, 0.25, 0.4 and 0.5. The baseline importer halves their corner radii; the bottom-right pad should be a pill. This makes the geometry loss directly visible in both real renderers.

![KiCad versus Circuit JSON — rounded pads](__snapshots__/real-renders/rounded-pads.comparison.png)

## Existing QFN-60 footprint

`fixtures/qfn60.kicad_pcb` wraps the repository's `tests/assets/QFN-60-1EP_7x7mm_P0.4mm_EP3.4x3.4mm.kicad_mod` in a minimal board. Geometry is retained; library-only version/generator metadata is removed, and board placement/identity and a bounding outline are added for plotting. This is a real footprint with 60 peripheral pins and an exposed pad.

![KiCad versus Circuit JSON — QFN-60](__snapshots__/real-renders/qfn60.comparison.png)

Font shape/size and some silkscreen details differ between engines independently of the roundrect correction. These snapshots expose those differences; they do not claim full pixel parity.

## Reproduction and provenance

```sh
# Run the evidence and renderer regression tests using committed KiCad references.
bun test tests/repros/fuzz-import-invariants

# Generate both sides from the actual engines; requires kicad-cli.
UPDATE_IMPORT_REPRO_SNAPSHOTS=1 UPDATE_KICAD_REFERENCES=1 \
  bun test tests/repros/fuzz-import-invariants

# Update only the Circuit JSON output after an importer change.
UPDATE_IMPORT_REPRO_SNAPSHOTS=1 \
  bun test tests/repros/fuzz-import-invariants
```

Raw KiCad SVGs, raw Circuit JSON SVGs, individual PNGs, composed PNGs and full Circuit JSON are committed next to the comparison images. `*.provenance.json` records input hashes, KiCad/renderer versions and output hashes. PCB exports use `F.Cu,F.SilkS,Edge.Cuts`, plus `F.Fab` for the fabrication case; the Circuit JSON renderer uses matching front-side visibility and the board's physical bounds. Rasterization and proportional resizing use Sharp. Standalone footprints are wrapped in a temporary board for native export; the importer still receives the original .kicad_mod. Only a plotting outline and required board metadata are added. The no-net native export similarly adds a plotting outline. The schematic native preview uses a 72 × 64.8 mm viewport centered at (105, 148.5), matching the renderer viewport through the importer's 15:1 schematic conversion. Raw native SVG remains unchanged; text geometry is never cropped or independently fitted. No copper paths are redrawn or corrected in the presentation code.

Tests compare the newly rendered Circuit JSON SVG and full imported JSON with the golden outputs, check fixture/reference provenance and validate image hashes. KiCad references are regenerated explicitly, because different KiCad versions can change plot serialization. The PNGs are real-render previews, not a cross-platform pixel-equivalence oracle.

The five ID/reference/schema/geometry evidence JSON files assert the corrected invariants in this fix layer. IDs and missing logical references are not reliably visible in a PCB render; their tests retain data assertions alongside real render comparisons, with explicit captions for nonvisual failures.
