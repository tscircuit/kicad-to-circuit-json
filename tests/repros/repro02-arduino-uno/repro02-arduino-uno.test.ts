import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("kicad-to-circuit-json repro02: Arduino Uno PCB", async () => {
  const kicadPcbPath =
    "tests/repros/repro02-arduino-uno/arduino-uno.source.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-uno.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  const fs = await import("node:fs/promises")
  await fs.mkdir("tests/repros/repro02-arduino-uno/__snapshots__", {
    recursive: true,
  })
  await fs.writeFile(
    "tests/repros/repro02-arduino-uno/__snapshots__/repro02-arduino-uno-circuit-json.json",
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
    "tests/repros/repro02-arduino-uno/__snapshots__/repro02-arduino-uno-circuit-json.svg",
    circuitJsonSvg,
  )

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "repro02-arduino-uno-pcb",
  )
})
