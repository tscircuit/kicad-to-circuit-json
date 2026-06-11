import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("kicad-to-circuit-json repro: Arduino Micro PCB", async () => {
  const kicadPcbPath = "tests/assets/Arduino Micro.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-micro.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson.length).toBeGreaterThan(0)
  expect(circuitJson.some((el: any) => el.type === "pcb_board")).toBe(true)
  expect(circuitJson.some((el: any) => el.type === "pcb_component")).toBe(true)
  expect(circuitJson.some((el: any) => el.type === "pcb_trace")).toBe(true)

  await mkdir("tests/repros/arduino-micro/__snapshots__", {
    recursive: true,
  })
  await writeFile(
    "tests/repros/arduino-micro/__snapshots__/arduino-micro-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
    pcbSnapshotBounds: "circuit-json",
  })

  const kicadPng = Object.values(kicadSnapshot.generatedFileContent)[0]!
  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: circuitJson as any,
    outputType: "pcb",
  })

  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  await writeFile(
    "tests/repros/arduino-micro/__snapshots__/arduino-micro-circuit-json.svg",
    circuitJsonSvg,
  )

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "arduino-micro-pcb",
  )
})
