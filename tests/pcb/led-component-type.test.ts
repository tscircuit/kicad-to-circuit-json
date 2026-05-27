import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

test("pcb footprint inference classifies LED footprints as simple_led", () => {
  const kicadPcbContent = readFileSync(
    "tests/repros/arduino-nano/arduino-nano.kicad_pcb",
    "utf-8",
  )

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-nano.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )

  for (const name of ["D2", "D3", "D4", "D5"]) {
    const component = sourceComponents.find(
      (sourceComponent) => sourceComponent.name === name,
    )
    expect(component).toBeDefined()
    expect(component.ftype).toBe("simple_led")
  }

  const d1 = sourceComponents.find(
    (sourceComponent) => sourceComponent.name === "D1",
  )
  expect(d1).toBeDefined()
  expect(d1.ftype).toBe("simple_diode")
})
