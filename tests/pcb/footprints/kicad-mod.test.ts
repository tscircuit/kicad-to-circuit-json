import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("kicad-to-circuit-json converts standalone kicad_mod footprints", () => {
  const kicadModContent = readFileSync(
    "tests/assets/footprints/two-pad.kicad_mod",
    "utf-8",
  )

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("two-pad.kicad_mod", kicadModContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput() as any[]

  expect(converter.ctx?.kicadMod).toBeDefined()
  expect(converter.ctx?.kicadPcb?.footprints).toHaveLength(1)

  const sourceComponents = circuitJson.filter(
    (element) => element.type === "source_component",
  )
  const pcbComponents = circuitJson.filter(
    (element) => element.type === "pcb_component",
  )
  const smtPads = circuitJson.filter((element) => element.type === "pcb_smtpad")
  const pcbPorts = circuitJson.filter((element) => element.type === "pcb_port")

  expect(sourceComponents).toHaveLength(1)
  expect(sourceComponents[0].name).toBe("REF**")
  expect(pcbComponents).toHaveLength(1)
  expect(pcbComponents[0].center).toEqual({ x: 0, y: 0 })
  expect(pcbComponents[0].layer).toBe("top")
  expect(smtPads).toHaveLength(2)
  expect(pcbPorts).toHaveLength(2)
  expect(smtPads.map((pad) => pad.port_hints[0]).sort()).toEqual(["1", "2"])
  expect(smtPads.map((pad) => pad.layer)).toEqual(["top", "top"])
})
