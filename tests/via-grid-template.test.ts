import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../lib"
import { takeKicadSnapshot } from "./fixtures/take-kicad-snapshot"
import { takeCircuitJsonSnapshot } from "./fixtures/take-circuit-json-snapshot"
import { stackCircuitJsonKicadPngs } from "./fixtures/stackCircuitJsonKicadPngs"
import "./fixtures/png-matcher"

test("kicad-to-circuit-json: via-grid board PCB", async () => {
  // Load the KiCad PCB file
  const kicadPcbPath = "tests/assets/via_grid_template.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  // Convert to Circuit JSON
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("via_grid_template.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  // Verify we got some output
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  // Write Circuit JSON to file for inspection
  const fs = await import("node:fs/promises")
  await fs.writeFile(
    "tests/__snapshots__/via_grid_template-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  // Take snapshots
  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
  })

  const kicadPng = Object.values(kicadSnapshot.generatedFileContent)[0]!

  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: circuitJson as any,
    outputType: "pcb",
  })

  // Also export the circuit JSON as SVG for inspection
  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any)
  await fs.writeFile(
    "tests/__snapshots__/via_grid_template-circuit-json.svg",
    circuitJsonSvg,
  )

  // Stack them vertically with labels (Circuit JSON on top, KiCad on bottom)
  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)

  // Save as snapshot for visual comparison
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "via_grid_template-pcb",
  )
})
