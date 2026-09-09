import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

test("Easyduino schematic reproduces KiCad overline markup rendering", async () => {
  const schematicPath = new URL(
    "../../assets/Easyduino_ESP32.kicad_sch",
    import.meta.url,
  )
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "Easyduino_ESP32.kicad_sch",
    readFileSync(schematicPath, "utf-8"),
  )
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(circuitJson.length).toBeGreaterThan(0)

  const fs = await import("node:fs/promises")
  const snapshotDirectory = new URL("./__snapshots__/", import.meta.url)
  await fs.mkdir(snapshotDirectory, { recursive: true })
  await fs.writeFile(
    new URL("easyduino-overline-circuit-json.json", snapshotDirectory),
    JSON.stringify(circuitJson, null, 2),
  )

  const kicadSnapshot = await takeKicadSnapshot({
    kicadFilePath: fileURLToPath(schematicPath),
    kicadFileType: "sch",
    generatePng: false,
  })
  const kicadSvg = Object.values(kicadSnapshot.generatedFileContent)[0]
  if (!kicadSvg) throw new Error("Expected KiCad schematic snapshot")

  // Render once, then use this exact SVG for both committed and stacked output.
  const { convertCircuitJsonToSchematicSvg } = await import("circuit-to-svg")
  const circuitJsonSvg = convertCircuitJsonToSchematicSvg(circuitJson as any, {
    width: 700,
    height: 800,
  }).replaceAll("sans-serif", "Arial, sans-serif")
  await fs.writeFile(
    new URL("easyduino-overline-circuit-json.svg", snapshotDirectory),
    circuitJsonSvg,
  )
  // Rasterize both vector renderings at the same density so GitHub previews
  // remain sharp while preserving each SVG's geometry and aspect ratio.
  const snapshotDensity = 144
  const [circuitJsonPng, kicadPng] = await Promise.all([
    sharp(Buffer.from(circuitJsonSvg), { density: snapshotDensity })
      .png()
      .toBuffer(),
    sharp(kicadSvg, { density: snapshotDensity }).png().toBuffer(),
  ])

  const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
  await expect(stackedPng).toMatchPngSnapshot(
    import.meta.path,
    "easyduino-overline",
  )
}, 30_000)
