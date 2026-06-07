import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadFootprintToCircuitJsonConverter } from "../../../lib"
import { snapshotCircuitJsonPcbSvg } from "../../fixtures/svg-snapshot-test-utils"

test("KicadFootprintToCircuitJsonConverter converts standalone kicad_mod footprints", () => {
  const kicadModContent = readFileSync(
    "tests/assets/footprints/SOT-343_SC-70-4.kicad_mod.kicad_mod",
    "utf-8",
  )

  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile("SOT-343_SC-70-4.kicad_mod.kicad_mod", kicadModContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput() as any[]

  expect(converter.ctx?.kicadMod).toBeDefined()
  expect(converter.ctx?.kicadPcb).toBeUndefined()

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
  expect(smtPads).toHaveLength(4)
  expect(pcbPorts).toHaveLength(4)
  expect(smtPads.map((pad) => pad.port_hints[0]).sort()).toEqual([
    "1",
    "2",
    "3",
    "4",
  ])
  expect(smtPads.map((pad) => pad.layer)).toEqual(["top", "top", "top", "top"])

  snapshotCircuitJsonPcbSvg({
    circuitJson: circuitJson as any,
    testPath: import.meta.path,
    snapshotName: "SOT-343_SC-70-4-circuit-json",
  })
})
