import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { KicadToCircuitJsonConverter } from "../../../lib"

// kicadts rejects (suppress_zeroes yes), then board-level point tokens.
test.failing("imports the air quality sensor KiCad 10 board", () => {
  const kicadPcbContent = readFileSync(
    join(import.meta.dir, "air_quality_sensor.kicad_pcb"),
    "utf-8",
  )
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("air_quality_sensor.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(
    circuitJson.filter((element) => element.type === "pcb_board"),
  ).toHaveLength(1)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(94)
  expect(
    circuitJson.filter((element) => element.type === "pcb_via"),
  ).toHaveLength(250)
  expect(
    circuitJson.filter((element) => element.type === "pcb_trace").length,
  ).toBeGreaterThan(0)
})
