import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("kicad-to-circuit-json repro: Arduino Nano PCB", async () => {
  const kicadPcbPath = "tests/repros/arduino-nano/arduino-nano.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-nano.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  const pcbBoards = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_board",
  )
  const pcbComponents = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_component",
  )
  const pcbSilkscreenText = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_silkscreen_text",
  )
  const pcbTraces = (circuitJson as any[]).filter(
    (el) => el.type === "pcb_trace",
  )

  expect(pcbBoards).toHaveLength(1)
  expect(pcbComponents.length).toBeGreaterThan(0)
  expect(pcbSilkscreenText.length).toBeGreaterThan(0)
  expect(pcbTraces.length).toBeGreaterThan(0)

  const fs = await import("node:fs/promises")
  await fs.mkdir("tests/repros/arduino-nano/__snapshots__", {
    recursive: true,
  })
  await fs.writeFile(
    "tests/repros/arduino-nano/__snapshots__/arduino-nano-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
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
  await fs.writeFile(
    "tests/repros/arduino-nano/__snapshots__/arduino-nano-circuit-json.svg",
    circuitJsonSvg,
  )

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "arduino-nano-pcb",
  )
})
