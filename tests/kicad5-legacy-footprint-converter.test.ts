import { expect, test } from "bun:test"
import { KicadFootprintToCircuitJsonConverter } from "../lib/KicadFootprintToCircuitJsonConverter"

test("kicad5 upgrader: standalone legacy module footprint converts through the footprint converter", () => {
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    "LegacyFootprint.kicad_mod",
    `(module LegacyFootprint (layer F.Cu)
      (fp_text reference REF** (at 0 -1.5) (layer F.SilkS)
        (effects (font (size 1 1) (thickness 0.15)))
      )
      (fp_text value LegacyFootprint (at 0 1.5) (layer F.Fab)
        (effects (font (size 1 1) (thickness 0.15)))
      )
      (pad 1 smd rect (at 0 0) (size 1 1) (layers F.Cu F.Paste F.Mask))
    )`,
  )

  converter.runUntilFinished()

  const output = converter.getOutput() as any[]
  expect(output.find((el) => el.type === "source_component")).toMatchObject({
    name: "REF**",
  })
  expect(output.filter((el) => el.type === "pcb_smtpad")).toHaveLength(1)
  expect(converter.getWarnings()).toEqual([])
})
