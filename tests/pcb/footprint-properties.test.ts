import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

test("kicad-to-circuit-json preserves JLCPCB footprint properties", () => {
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
})
