import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

test("pcb footprint inference classifies SW references as simple_switch", () => {
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

  const switchComponent = sourceComponents.find(
    (sourceComponent) => sourceComponent.name === "SW1",
  )

  expect(switchComponent).toBeDefined()
  expect(switchComponent?.ftype).toBe("simple_switch")
})

test("pcb footprint inference classifies S references with switch footprints as simple_switch", () => {
  const kicadPcbContent = readFileSync(
    "tests/repros/repro02-arduino-uno/arduino-uno.source.kicad_pcb",
    "utf-8",
  )

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-uno.source.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )

  const switchComponent = sourceComponents.find(
    (sourceComponent) => sourceComponent.name === "S1",
  )

  expect(switchComponent).toBeDefined()
  expect(switchComponent?.ftype).toBe("simple_switch")
})
