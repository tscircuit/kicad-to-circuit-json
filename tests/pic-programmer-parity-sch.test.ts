import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../lib"
import { takeKicadSnapshot } from "./fixtures/take-kicad-snapshot"
import { takeCircuitJsonSnapshot } from "./fixtures/take-circuit-json-snapshot"
import { stackCircuitJsonKicadPngs } from "./fixtures/stackCircuitJsonKicadPngs"
import "./fixtures/png-matcher"

test("kicad-to-circuit-json: pic_programmer schematic", async () => {
  // Load the KiCad schematic file
  const kicadSchPath =
    "kicad-demos/demos/pic_programmer/pic_programmer.kicad_sch"
  const kicadSchContent = readFileSync(kicadSchPath, "utf-8")

  // Convert to Circuit JSON
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("pic_programmer.kicad_sch", kicadSchContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()

  // Verify we got some output
  expect(circuitJson).toBeDefined()
  expect(circuitJson.length).toBeGreaterThan(0)

  // Write Circuit JSON to file for inspection
  const fs = await import("node:fs/promises")
  await fs.writeFile(
    "tests/__snapshots__/pic_programmer-schematic-circuit-json.json",
    JSON.stringify(circuitJson, null, 2),
  )

  // Take snapshots
  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: kicadSchPath,
    kicadFileType: "sch",
  })

  const kicadPng = kicadSnapshot.generatedFileContent["pic_programmer.png"]!

  const circuitJsonPng = await takeCircuitJsonSnapshot({
    circuitJson: circuitJson as any,
    outputType: "schematic",
  })

  // Also export the circuit JSON as SVG for inspection
  const { convertCircuitJsonToSchematicSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToSchematicSvg(circuitJson as any)

  await fs.writeFile(
    "tests/__snapshots__/pic_programmer-schematic-circuit-json.svg",
    circuitJsonSvg,
  )

  // Stack them vertically with labels (Circuit JSON on top, KiCad on bottom)
  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)

  // Save as snapshot for visual comparison
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "pic_programmer-schematic",
  )
})
