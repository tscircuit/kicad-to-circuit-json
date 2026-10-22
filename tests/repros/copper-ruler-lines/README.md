# Copper ruler strokes disappear during import

`Gauge_50mm_Type2_CopperTop.kicad_mod` is an unmodified public KiCad library
footprint from [KiCad/kicad-footprints](https://github.com/KiCad/kicad-footprints/blob/7ebfa6b23cc292a56f751b7b5f4a0e12eeef69dd/Calibration_Scale.pretty/Gauge_50mm_Type2_CopperTop.kicad_mod).
It is distributed under the KiCad libraries' CC-BY-SA 4.0 license with the
electronic-design exception; see `KICAD-LIBRARY-LICENSE.md`.

`copper-ruler.kicad_pcb` embeds the same footprint in a 62 x 68 mm rectangular
board. The only footprint edits are changing the root token from `module` to
`footprint`, placing it at (8, 54), assigning a UUID, and changing `REF**` to
`G1`. None of the 41 copper strokes or their 0.381 mm widths are changed.

## Failure

Both `KicadToCircuitJsonConverter` and
`KicadFootprintToCircuitJsonConverter` finish importing this fixture, retain the
component and annotation text, and return no warnings. Neither emits any copper
geometry. All 41 `fp_line` objects on `F.Cu`, including the ruler baselines and
measurement ticks, disappear.

`createFootprintLine` in
`lib/stages/pcb/CollectFootprintsStage/process-graphics.ts` returns immediately
when the mapped layer is not an annotation layer. Copper footprint lines
therefore never reach an output primitive.

## Reproduce

With KiCad 10's `kicad-cli` on PATH:

```sh
bun install
bun test tests/repros/copper-ruler-lines/copper-ruler-lines.test.ts
```

The regular fixture test checks that both imports complete and all 41 copper
strokes are parsed. Two `test.failing` cases assert that the board and standalone
imports preserve copper. Conversion runs outside those cases, so a parser
exception cannot satisfy an expected failure. Remove `.failing` to see the two
assertions fail with `Expected: > 0; Received: 0`.

The regular image test compares native `kicad-cli` F.Cu SVG output with the
converted Circuit JSON copper. Both panels cover the same 62 x 68 mm viewport.
The left panel has the ruler; the right panel is empty. Silkscreen and fabrication
annotations are excluded to isolate copper loss. This PR changes no importer
behavior.
