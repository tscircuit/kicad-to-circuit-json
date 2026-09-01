import { expect, test } from "bun:test"
import { KicadSch, SchematicSymbol, SymbolProperty } from "kicadts"
import { KicadToCircuitJsonConverter } from "../lib"

test("schematic components reference their inserted source components", () => {
  const schematic = new KicadSch({
    version: 20231120,
    generator: "kicad_eeschema",
    uuid: "00000000-0000-0000-0000-000000000001",
    symbols: [
      new SchematicSymbol({
        libraryId: "Device:R",
        at: { x: 100, y: 100 },
        uuid: "00000000-0000-0000-0000-000000000002",
        properties: [
          new SymbolProperty({ key: "Reference", value: "R1" }),
          new SymbolProperty({ key: "Value", value: "10k" }),
        ],
      }),
    ],
  })
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("source-component-link.kicad_sch", schematic.getString())
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const sourceComponent = circuitJson.find(
    (element) => element.type === "source_component",
  )
  const schematicComponent = circuitJson.find(
    (element) => element.type === "schematic_component",
  )

  expect(sourceComponent).toBeDefined()
  expect(schematicComponent).toBeDefined()
  expect(schematicComponent?.source_component_id).toBe(
    sourceComponent?.source_component_id,
  )
})
