import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadSymbolToCircuitJsonConverter } from "../lib"

test("kicad symbol converter: converts a standalone .kicad_sym symbol library", () => {
  const converter = new KicadSymbolToCircuitJsonConverter()
  converter.addFile(
    "CM5IO.kicad_sym",
    readFileSync("tests/assets/CM5IO.kicad_sym", "utf8"),
  )
  converter.runUntilFinished()

  const output = converter.getOutput()
  const sourceComponents = output.filter(
    (element) => element.type === "source_component",
  )
  const sourcePorts = output.filter((element) => element.type === "source_port")
  const schematicComponents = output.filter(
    (element) => element.type === "schematic_component",
  )
  const schematicPorts = output.filter(
    (element) => element.type === "schematic_port",
  )

  expect(sourceComponents.length).toBe(36)
  expect(sourcePorts.length).toBe(487)
  expect(schematicComponents.length).toBe(36)
  expect(schematicPorts.length).toBe(487)
  expect(converter.pipeline?.map((stage) => stage.constructor.name)).toEqual([
    "InitializeSymbolLibraryContextStage",
    "CollectSymbolLibrarySymbolsStage",
  ])
  expect(converter.getWarnings()).toEqual([])
  expect(converter.getStats()).toEqual({ components: 36, pads: 487 })
})

test("kicad symbol converter: rejects missing .kicad_sym input", () => {
  const converter = new KicadSymbolToCircuitJsonConverter()

  expect(() => converter.runUntilFinished()).toThrow(
    "No .kicad_sym file was added to the converter",
  )
})
