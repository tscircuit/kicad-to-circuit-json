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
  const schematicSymbols = output.filter(
    (element) => element.type === "schematic_symbol",
  )
  const schematicPorts = output.filter(
    (element) => element.type === "schematic_port",
  )
  const schematicPrimitives = output.filter(
    (element) =>
      element.type === "schematic_line" ||
      element.type === "schematic_rect" ||
      element.type === "schematic_circle" ||
      element.type === "schematic_arc" ||
      element.type === "schematic_path" ||
      element.type === "schematic_text",
  )

  expect(sourceComponents.length).toBe(36)
  expect(sourcePorts.length).toBe(487)
  expect(schematicComponents.length).toBe(36)
  expect(schematicSymbols.length).toBe(36)
  expect(schematicPorts.length).toBe(487)
  expect(
    schematicComponents.every((component) => component.schematic_symbol_id),
  ).toBe(true)
  expect(
    schematicPrimitives.every((primitive) => primitive.schematic_symbol_id),
  ).toBe(true)
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

test("kicad symbol converter: parses overlined pin-name parts", () => {
  const converter = new KicadSymbolToCircuitJsonConverter()
  const symbol = readFileSync("tests/assets/CM5IO.kicad_sym", "utf8").replace(
    '(name "VCC"',
    '(name "A~{BC}D"',
  )
  converter.addFile("CM5IO.kicad_sym", symbol)
  converter.runUntilFinished()

  const sourcePort = converter
    .getOutput()
    .find(
      (element) => element.type === "source_port" && element.name === "ABCD",
    )
  const schematicPort = converter
    .getOutput()
    .find(
      (element) =>
        element.type === "schematic_port" &&
        element.display_pin_label === "ABCD",
    ) as
    | {
        display_pin_label_text_parts?: Array<{
          text: string
          is_overlined?: boolean
        }>
      }
    | undefined

  expect(sourcePort).toBeDefined()
  expect(schematicPort?.display_pin_label_text_parts).toEqual([
    { text: "A" },
    { text: "BC", is_overlined: true },
    { text: "D" },
  ])
})
