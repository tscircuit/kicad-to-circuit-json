import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

test("kicad-to-circuit-json preserves metadata from a real board", () => {
  const kicadPcbContent = readFileSync(
    "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb",
    "utf-8",
  )

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("corne-keyboard.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput() as any[]
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const pcbComponents = circuitJson.filter(
    (element) => element.type === "pcb_component",
  )

  const u1 = sourceComponents.find((component) => component.name === "U1")
  expect(u1).toBeDefined()
  expect(u1.supplier_part_numbers).toEqual({ jlcpcb: ["C2040"] })

  const zd1 = sourceComponents.find((component) => component.name === "ZD1")
  expect(zd1).toBeDefined()
  expect(zd1.supplier_part_numbers).toEqual({ jlcpcb: ["C145179"] })

  const u1PcbComponent = pcbComponents.find(
    (component) => component.source_component_id === u1.source_component_id,
  )
  expect(u1PcbComponent?.metadata?.kicad_footprint).toBeUndefined()

  const bt3 = sourceComponents.find((component) => component.name === "BT3")
  const bt3PcbComponent = pcbComponents.find(
    (component) => component.source_component_id === bt3.source_component_id,
  )
  expect(bt3PcbComponent?.metadata?.kicad_footprint?.attributes).toEqual({
    exclude_from_pos_files: true,
    exclude_from_bom: true,
  })

  expect(
    pcbComponents.filter(
      (component) =>
        component.metadata?.kicad_footprint?.attributes?.exclude_from_bom,
    ),
  ).toHaveLength(14)
  expect(
    pcbComponents.filter(
      (component) =>
        component.metadata?.kicad_footprint?.attributes?.exclude_from_pos_files,
    ),
  ).toHaveLength(14)
}, 10_000)
