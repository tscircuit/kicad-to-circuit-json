import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

test("pcb footprint inference classifies fiducials as simple_fiducial", () => {
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

  for (const name of ["FID1", "FID2", "FID3", "FID4"]) {
    const component = sourceComponents.find(
      (sourceComponent) => sourceComponent.name === name,
    )
    expect(component).toBeDefined()
    expect(component.ftype).toBe("simple_fiducial")
  }
})
