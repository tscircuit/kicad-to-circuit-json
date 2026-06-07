import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("KicadToCircuitJsonConverter rejects standalone kicad_mod footprints", () => {
  const kicadModContent = readFileSync(
    "tests/assets/footprints/SOT-343_SC-70-4.kicad_mod.kicad_mod",
    "utf-8",
  )

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("SOT-343_SC-70-4.kicad_mod.kicad_mod", kicadModContent)

  expect(() => converter.runUntilFinished()).toThrow(
    "Standalone .kicad_mod conversion is handled by KicadFootprintToCircuitJsonConverter, not KicadToCircuitJsonConverter.",
  )
})
