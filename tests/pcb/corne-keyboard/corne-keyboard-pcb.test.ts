import { test, expect } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { createSideBySideSvg } from "../../fixtures/create-side-by-side-svg"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

test("kicad-to-circuit-json: corne-keyboard PCB", async () => {
  // Load the KiCad PCB file
  const kicadPcbPath = "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  // Convert to Circuit JSON
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("corne-keyboard.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  // Verify we got some output
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  // Write Circuit JSON to file for inspection
  const fs = await import("node:fs/promises")
  await fs.writeFile(
    "tests/pcb/corne-keyboard/__snapshots__/corne-keyboard-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  // Render the original KiCad source directly to SVG.
  const sourceSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadPcbPath,
    kicadFileType: "pcb",
    generatePng: false,
  })
  const sourceSvg = Object.values(sourceSnapshot.generatedFileContent)[0]!

  // Also export the circuit JSON as SVG for inspection
  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  await fs.writeFile(
    "tests/pcb/corne-keyboard/__snapshots__/corne-keyboard-circuit-json.svg",
    circuitJsonSvg,
  )

  const sideBySideSvg = createSideBySideSvg(
    sourceSvg.toString("utf8"),
    circuitJsonSvg,
  )
  expect(sideBySideSvg).toContain('data-comparison="source"')
  expect(sideBySideSvg).toContain('data-comparison="converted"')
  await expect(sideBySideSvg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
