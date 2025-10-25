import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../lib"
import { takeKicadSnapshot } from "./fixtures/take-kicad-snapshot"
import { takeCircuitJsonSnapshot } from "./fixtures/take-circuit-json-snapshot"
import { stackCircuitJsonKicadPngs } from "./fixtures/stackCircuitJsonKicadPngs"
import "./fixtures/png-matcher"

test("kicad-to-circuit-json: pic_programmer PCB", async () => {
  // Load the KiCad PCB file
  const kicadPcbPath = "kicad-demos/demos/pic_programmer/pic_programmer.kicad_pcb"
  const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

  // Convert to Circuit JSON
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("pic_programmer.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const warnings = converter.getWarnings()
  const stats = converter.getStats()

  // Log diagnostics
  console.log("Conversion stats:", stats)
  if (warnings.length > 0) {
    console.log("Warnings:", warnings)
  }

  // Verify we got some output
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

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

  // Stack them vertically with labels (Circuit JSON on top, KiCad on bottom)
  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)

  // Save as snapshot for visual comparison
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "pic_programmer-pcb"
  )
})
