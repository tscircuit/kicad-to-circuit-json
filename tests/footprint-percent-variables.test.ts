import { expect, test } from "bun:test"
import { KicadFootprintToCircuitJsonConverter } from "../lib/KicadFootprintToCircuitJsonConverter"

test("kicad footprint converter replaces %R and %V variables and keeps normal % text", () => {
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    "PercentVariables.kicad_mod",
    `(footprint "Test:PercentVariables" (version 20240108) (generator "test") (layer "F.Cu")
      (property "Reference" "REF**" (at 0 -2 0) (layer "F.SilkS")
        (effects (font (size 1 1) (thickness 0.15)))
      )
      (property "Value" "10k" (at 0 2 0) (layer "F.Fab")
        (effects (font (size 1 1) (thickness 0.15)))
      )
      (fp_text user "%R" (at 0 0 0) (layer "F.Fab")
        (effects (font (size 0.8 0.8) (thickness 0.12)))
      )
      (fp_text user "VAL:%V" (at 0 1 0) (layer "F.Fab")
        (effects (font (size 0.8 0.8) (thickness 0.12)))
      )
      (fp_text user "±1%RH" (at 0 -1 0) (layer "F.SilkS")
        (effects (font (size 0.8 0.8) (thickness 0.12)))
      )
      (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu"))
    )`,
  )
  converter.runUntilFinished()

  const output = converter.getOutput() as any[]
  const fabTexts = output
    .filter((el) => el.type === "pcb_fabrication_note_text")
    .map((el) => el.text)
  const silkTexts = output
    .filter((el) => el.type === "pcb_silkscreen_text")
    .map((el) => el.text)

  expect(fabTexts).toContain("REF**")
  expect(fabTexts).toContain("10k")
  expect(fabTexts).toContain("VAL:10k")
  expect(silkTexts).toContain("REF**")
  expect(silkTexts).toContain("±1%RH")
})
