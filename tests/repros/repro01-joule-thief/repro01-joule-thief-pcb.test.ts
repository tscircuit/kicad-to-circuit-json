import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("kicad-to-circuit-json repro01: joule-thief PCB", async () => {
  const kicadPcbPath = "tests/repros/repro01-joule-thief/joule-thief.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("joule-thief.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  const fs = await import("node:fs/promises")
  await fs.mkdir("tests/repros/repro01-joule-thief/__snapshots__", {
    recursive: true,
  })
  await fs.writeFile(
    "tests/repros/repro01-joule-thief/__snapshots__/repro01-joule-thief-circuit-json.json",
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
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any)
  await fs.writeFile(
    "tests/repros/repro01-joule-thief/__snapshots__/repro01-joule-thief-circuit-json.svg",
    circuitJsonSvg,
  )

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "repro01-joule-thief-pcb",
  )
})
